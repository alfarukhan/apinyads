const express = require('express');
const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { fraudDetectionMiddleware } = require('../middleware/fraud-detection');
const PaymentIntentService = require('../services/secure/PaymentIntentService');
const StockReservationService = require('../services/secure/StockReservationService');
const { 
  idempotencyMiddleware,
  paymentIntentMiddleware,
  duplicatePaymentDetector 
} = require('../middleware/secure-payment');
const { presets: cachePresets } = require('../middleware/cachingMiddleware');
const { getNotificationService } = require('../services/core');
const PaymentService = require('../services/core/PaymentService');
const PlatformConfigService = require('../services/platform-config-service');
const { successResponse, errorResponse } = require('../lib/response-formatters');

// ✅ ENTERPRISE: Use centralized validation schemas
const { bookingCreateSchema } = require('../lib/validation-schemas');

// ✅ ENTERPRISE: Use centralized Midtrans configuration (only needed for signature verification)
const { MIDTRANS_IS_PRODUCTION } = require('../lib/midtrans-config');

const router = express.Router();
// Using shared prisma instance from lib/prisma.js
const platformConfig = PlatformConfigService.getInstance();

// ✅ RATE LIMITING CONFIGURATION
const MAX_DAILY_BOOKINGS = 50; // Regular users limit
const MAX_HOURLY_BOOKINGS = 10; // Regular users hourly limit

// Midtrans configuration from environment variables
// ✅ REMOVED: Using centralized Midtrans configuration

// Verify Midtrans signature for webhook security
function verifyMidtransSignature(notification) {
  try {
    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const signatureKey = notification.signature_key;
    
    // ✅ SECURITY: Always verify signatures, even in development
    // For sandbox, use sandbox server key for verification
    const serverKey = MIDTRANS_IS_PRODUCTION ? 
      process.env.MIDTRANS_SERVER_KEY : 
      process.env.MIDTRANS_SANDBOX_SERVER_KEY || process.env.MIDTRANS_SERVER_KEY;
    
    // ✅ SECURITY: Proper SHA512 verification for all environments
    const hash = crypto.createHash('sha512')
      .update(orderId + statusCode + grossAmount + serverKey)
      .digest('hex');
    
    const isValid = hash === signatureKey;
    
    if (!isValid) {
      console.error('❌ Invalid Midtrans signature detected!');
      console.error(`❌ Expected: ${hash}`);
      console.error(`❌ Received: ${signatureKey}`);
    } else {
      console.log('✅ Midtrans signature verified successfully');
    }
    
    return isValid;
  } catch (error) {
    console.error('❌ Error verifying Midtrans signature:', error);
    return false;
  }
}

// Supported payment methods based on Midtrans Indonesia
const SUPPORTED_PAYMENT_METHODS = [
  // E-Wallet
  'GOPAY',
  'QRIS',
  'SHOPEEPAY', 
  'DANA',
  
  // Virtual Account
  'BCA_VA',
  'MANDIRI_VA',
  'BNI_VA',
  'BRIVA',      // BRI Virtual Account  
  'PERMATA_VA',
  'CIMB_VA',
  'OTHER_VA',   // ATM Bersama, Prima, Alto
  
  // Credit/Debit Cards
  'CREDIT_CARD',
  
  // Over the Counter
  'INDOMARET',
  'ALFAMART',
  
  // Cardless Credit/PayLater
  'AKULAKU',
  'KREDIVO'
];

// Map frontend payment method IDs to Midtrans enabled_payments format
function mapPaymentMethodToMidtrans(paymentMethod) {
  const mapping = {
    // E-Wallet
    'GOPAY': 'gopay',
    'QRIS': 'qris',
    'SHOPEEPAY': 'shopeepay',
    'DANA': 'dana',
    
    // Virtual Account  
    'BCA_VA': 'bca_va',
    'MANDIRI_VA': 'echannel',
    'BNI_VA': 'bni_va',
    'BRIVA': 'bri_va',
    'PERMATA_VA': 'permata_va',
    'CIMB_VA': 'cimb_va',
    'OTHER_VA': 'other_va',
    
    // Credit/Debit Cards
    'CREDIT_CARD': 'credit_card',
    
    // Over the Counter
    'INDOMARET': 'indomaret',
    'ALFAMART': 'alfamart',
    
    // Cardless Credit/PayLater
    'AKULAKU': 'akulaku',
    'KREDIVO': 'kredivo'
  };
  
  return mapping[paymentMethod] || paymentMethod.toLowerCase();
}

// Map payment method IDs to user-friendly readable names
function mapPaymentMethodToReadable(paymentMethod) {
  const mapping = {
    // E-Wallet
    'GOPAY': 'GoPay',
    'QRIS': 'QRIS',
    'SHOPEEPAY': 'ShopeePay',
    'DANA': 'DANA',
    
    // Virtual Account  
    'BCA_VA': 'BCA Virtual Account',
    'MANDIRI_VA': 'Mandiri Virtual Account',
    'BNI_VA': 'BNI Virtual Account',
    'BRIVA': 'BRI Virtual Account',
    'PERMATA_VA': 'Permata Virtual Account',
    'CIMB_VA': 'CIMB Virtual Account',
    'OTHER_VA': 'Virtual Account',
    
    // Credit/Debit Cards
    'CREDIT_CARD': 'Credit/Debit Card',
    
    // Over the Counter
    'INDOMARET': 'Indomaret',
    'ALFAMART': 'Alfamart',
    
    // Cardless Credit/PayLater
    'AKULAKU': 'Akulaku',
    'KREDIVO': 'Kredivo'
  };
  
  return mapping[paymentMethod] || paymentMethod || 'Unknown Payment Method';
}

// ✅ REMOVED: Validation schema moved to centralized lib/validation-schemas.js

// Rate limiting helper - with admin bypass
async function checkRateLimit(userId, userRole = null) {
  // ✅ ADMIN BYPASS: No rate limiting for admins
  if (userRole === 'ADMIN') {
    console.log(`⚡ Admin user ${userId} bypassing rate limits`);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayBookings = await prisma.booking.count({
    where: {
      userId,
      createdAt: { gte: today }
    }
  });
  
  if (todayBookings >= MAX_DAILY_BOOKINGS) {
    throw new AppError(`Daily booking limit exceeded (${MAX_DAILY_BOOKINGS} bookings per day). Please try again tomorrow.`, 429);
  }

  // ✅ HOURLY RATE LIMITING: Additional protection for regular users
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const hourlyBookings = await prisma.booking.count({
    where: {
      userId,
      createdAt: { gte: oneHourAgo }
    }
  });

  if (hourlyBookings >= MAX_HOURLY_BOOKINGS) {
    throw new AppError(`Hourly booking limit exceeded (${MAX_HOURLY_BOOKINGS} bookings per hour). Please slow down.`, 429);
  }
}

// ✅ SECURITY: Use centralized order ID generation for consistency
const { generateBookingOrderId, validateOrderId } = require('../utils/order-id-generator');

// Generate unique booking code (wrapper for compatibility)
const generateBookingCode = () => {
  return generateBookingOrderId();
};

// Generate secure ticket code - ENHANCED SECURITY format
const generateTicketCode = async (accessTierId, sequence) => {
  // Use secure character set (exclude confusing characters)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  
  // Generate 12 random characters for maximum security
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  
  // Format with dashes every 4 characters: XXXX-XXXX-XXXX
  // Example: T4K9-M7L2-P8N5 (15 characters total including dashes)
  // Security: ~2.8 x 10^19 possible combinations
  const formattedCode = code.match(/.{1,4}/g).join('-');
  
  // Ensure uniqueness before returning
  return await ensureUniqueTicketCode(formattedCode);
};

// Generate QR code
const generateQRCode = () => {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
};

// Validate ticket code format
const isValidTicketCodeFormat = (ticketCode) => {
  if (!ticketCode || typeof ticketCode !== 'string') {
    return false;
  }
  
  // New format: XXXX-XXXX-XXXX (15 characters including dashes)
  const newFormatRegex = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
  
  // Legacy format: TKT followed by alphanumeric (16+ characters)
  const legacyFormatRegex = /^TKT[A-Z0-9]+$/;
  
  return newFormatRegex.test(ticketCode) || legacyFormatRegex.test(ticketCode);
};

// Additional security: Check for ticket code collision
const ensureUniqueTicketCode = async (ticketCode, maxRetries = 5) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const existingTicket = await prisma.access.findFirst({
      where: { ticketCode }
    });
    
    if (!existingTicket) {
      return ticketCode; // Code is unique
    }
    
    console.log(`⚠️ Ticket code collision detected: ${ticketCode}, regenerating...`);
    
    // Generate new code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let newCode = '';
    for (let i = 0; i < 12; i++) {
      newCode += chars[Math.floor(Math.random() * chars.length)];
    }
    ticketCode = newCode.match(/.{1,4}/g).join('-');
  }
  
  throw new Error('Unable to generate unique ticket code after maximum retries');
};

// @route   POST /api/bookings
// @desc    Create a new booking
// @access  Private
router.post('/', 
  authMiddleware, 
  fraudDetectionMiddleware,
  idempotencyMiddleware,
  duplicatePaymentDetector,
  paymentIntentMiddleware,
  asyncHandler(async (req, res) => {
  // ✅ CRITICAL DEBUG: Log authentication status at start
  console.log('🔍 BOOKING API DEBUG:');
  console.log('  Authorization Header:', req.headers.authorization);
  console.log('  req.user:', req.user);
  console.log('  req.user.id:', req.user?.id);
  
  // ✅ CRITICAL: Ensure user is authenticated
  if (!req.user || !req.user.id) {
    console.error('❌ CRITICAL: User not authenticated in booking route!');
    return res.status(401).json({
      success: false,
      message: 'Authentication required for booking creation.'
    });
  }

  const { error, value } = bookingCreateSchema.validate(req.body);
  
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { accessTierId, quantity, paymentMethod } = value;

  // Log fraud check result for booking creation
  if (req.fraudCheck) {
    console.log('🛡️ Booking fraud check:', {
      userId: req.user.id,
      approved: req.fraudCheck.approved,
      riskScore: req.fraudCheck.riskScore,
      riskLevel: req.fraudCheck.riskLevel,
      action: req.fraudCheck.action,
      flags: req.fraudCheck.flags
    });
  }

  // Rate limiting check (skip for admins)
  await checkRateLimit(req.user.id, req.user.role);

  // ✅ SECURE: Initialize security services
  const paymentIntentService = new PaymentIntentService();
  const stockReservationService = new StockReservationService();
  
  // ✅ SECURE: Access payment intent from middleware
  const paymentIntent = req.paymentIntent;
  console.log(`🔒 SECURE BOOKING: Using payment intent ${paymentIntent.id}`);

  // Start transaction for atomic booking with enhanced security
  const result = await prisma.$transaction(async (tx) => {
    // Get access tier with lock
    const accessTier = await tx.accessTier.findUnique({
      where: { id: accessTierId },
      include: { 
        event: {
          select: {
            id: true,
            title: true,
            taxRate: true,
            taxType: true,
            taxName: true,
            startDate: true,
            location: true,
            imageUrl: true
          }
        }
      }
    });

    if (!accessTier || !accessTier.isActive) {
      throw new AppError('Access tier not found or inactive', 404);
    }

    // Check sale period
    const now = new Date();
    if (accessTier.saleStartDate && now < accessTier.saleStartDate) {
      throw new AppError('Sale has not started yet', 400);
    }
    if (accessTier.saleEndDate && now > accessTier.saleEndDate) {
      throw new AppError('Sale has ended', 400);
    }

    // Check availability with optimistic locking
    const currentAvailable = accessTier.maxQuantity - accessTier.soldQuantity;
    if (currentAvailable < quantity) {
      throw new AppError(`Only ${currentAvailable} tickets available`, 400);
    }

    // SECURITY: Check for duplicate booking (prevent double submission)
    const recentBooking = await tx.booking.findFirst({
      where: {
        userId: req.user.id,
        accessTierId,
        createdAt: {
          gte: new Date(Date.now() - 60000) // Within last minute
        },
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    });

    if (recentBooking) {
      console.log(`🛡️ SECURITY: Blocked duplicate booking attempt by user ${req.user.id} for tier ${accessTierId}`);
      throw new AppError('You have a recent booking for this tier. Please wait before booking again.', 400);
    }

    // SECURITY: Check total access tickets per user per event (max 4 tickets)
    const userAccessCount = await tx.access.count({
      where: {
        userId: req.user.id,
        eventId: accessTier.eventId,
        status: 'CONFIRMED'
      }
    });

    const totalAfterPurchase = userAccessCount + quantity;
    const maxAccessPerEvent = 4;

    if (totalAfterPurchase > maxAccessPerEvent) {
      const remainingQuota = Math.max(0, maxAccessPerEvent - userAccessCount);
      console.log(`🛡️ SECURITY: User ${req.user.id} has ${userAccessCount} access tickets for event ${accessTier.eventId}, trying to buy ${quantity}, max allowed: ${maxAccessPerEvent}`);
      
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxAccessPerEvent} access tickets allowed per event`,
        code: 'QUOTA_EXCEEDED',
        error_code: 'QUOTA_EXCEEDED',
        details: `You have ${userAccessCount} access tickets. Remaining quota: ${remainingQuota}`,
        data: {
          currentCount: userAccessCount,
          maxAllowed: maxAccessPerEvent,
          remainingQuota: remainingQuota,
          requestedQuantity: quantity
        },
        security_version: 'DanceSignal Security v1.0'
      });
    }

    // ✅ SECURE: Create stock reservation with atomic operations
    console.log(`🎫 SECURE STOCK: Creating reservation for ${quantity} tickets`);
    
    const stockReservation = await stockReservationService.reserveStock({
      accessTierId,
      userId: req.user.id,
      quantity,
      paymentIntentId: paymentIntent.id,
      ttl: 30 * 60 * 1000 // 30 minutes TTL
    });
    
    console.log(`✅ SECURE STOCK: Reserved ${quantity} tickets (reservation: ${stockReservation.reservationId})`);
    
    // Get updated tier info
    const updatedTier = await tx.accessTier.findUnique({
      where: { id: accessTierId }
    });

    // Calculate amounts with platform fee and taxes
    const unitPrice = accessTier.price;
    const amountCalculation = await platformConfig.calculateBookingAmount(
      unitPrice, 
      quantity, 
      accessTier.event
    );
    
    const { subtotalAmount, platformFee, taxAmount, totalAmount } = amountCalculation;

    // Create booking
    const booking = await tx.booking.create({
      data: {
        bookingCode: generateBookingCode(),
        userId: req.user.id,
        eventId: accessTier.eventId,
        accessTierId,
        quantity,
        unitPrice,
        subtotalAmount,
        platformFee,
        taxAmount,
        totalAmount,
        paymentMethod,
        expiresAt: new Date(Date.now() + (process.env.BOOKING_EXPIRY_MINUTES || 30) * 60 * 1000),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        // ✅ SECURE: Link to payment intent and add idempotency
        paymentIntentId: paymentIntent.id,
        idempotencyKey: req.idempotencyKey,
        status: 'PENDING'
      },
      include: {
        accessTier: {
          select: {
            name: true,
            price: true
          }
        },
        event: {
          select: {
            title: true,
            startDate: true,
            location: true,
            imageUrl: true
          }
        }
      }
    });

    return { 
      booking, 
      updatedTier, 
      stockReservation,  // ✅ SECURE: Include reservation info
      paymentIntent      // ✅ SECURE: Include payment intent info
    };
  }, {
    isolationLevel: 'Serializable' // Highest isolation level
  });

  // ✅ CENTRALIZED: Use centralized PaymentService for booking payments
  let paymentResult = null;
  if (result.booking.totalAmount > 0) {
    const PaymentService = require('../services/core/PaymentService');
    const paymentService = new PaymentService();

    // ✅ STEP 1: Build payment request for centralized service
    const paymentRequest = {
      type: 'BOOKING',
      userId: req.user.id,
      eventId: result.booking.eventId,
      amount: result.booking.totalAmount,
      currency: 'IDR',
      paymentMethod: paymentMethod,
      
      // User details
      userEmail: req.user.email,
      userFirstName: req.user.firstName,
      userLastName: req.user.lastName,
      userPhone: req.user.phone,
      username: req.user.username,
      
      // Booking-specific data
      bookingId: result.booking.id,
      bookingCode: result.booking.bookingCode,
      accessTierIds: [result.booking.accessTierId], // ✅ FIX: Convert to array format expected by PaymentValidator
      quantities: { [result.booking.accessTierId]: result.booking.quantity },
      
      // Item details for Midtrans
      itemName: `${result.booking.event.title} - ${result.booking.accessTier.name}`,
      category: 'Event Ticket',
      itemDetails: [
        // Main ticket item
        {
          id: result.booking.accessTierId,
          price: Math.round(result.booking.unitPrice),
          quantity: result.booking.quantity,
          name: `${result.booking.event.title} - ${result.booking.accessTier.name}`,
          category: 'Event Ticket'
        },
        // Platform fee (if applicable)
        ...(result.booking.platformFee && result.booking.platformFee > 0 ? [{
          id: 'platform_fee',
          price: Math.round(result.booking.platformFee),
          quantity: 1,
          name: 'Platform Fee',
          category: 'Fee'
        }] : []),
        // Tax amount (if applicable)
        ...(result.booking.taxAmount && result.booking.taxAmount > 0 ? [{
          id: 'tax_amount',
          price: Math.round(result.booking.taxAmount),
          quantity: 1,
          name: 'Tax',
          category: 'Tax'
        }] : [])
      ]
    };

    try {
      // ✅ SECURE: Update payment intent to PROCESSING
      await paymentIntentService.updatePaymentIntentStatus(
        paymentIntent.id,
        'PROCESSING'
      );
      
      // ✅ STEP 2: Use centralized payment service
      paymentResult = await paymentService.createPayment(paymentRequest);
      
      // ✅ STEP 3: Update booking with payment ID (use centralized payment ID)
      await prisma.booking.update({
        where: { id: result.booking.id },
        data: { paymentId: paymentResult.data.paymentId }
      });

      console.log(`✅ Centralized booking payment created: ${paymentResult.data.paymentId} for booking ${result.booking.bookingCode}`);
      
      // ✅ SECURE: Update payment intent to COMPLETED (payment creation successful)
      await paymentIntentService.updatePaymentIntentStatus(
        paymentIntent.id,
        'COMPLETED',
        paymentResult.data.paymentId
      );
      
      console.log(`✅ SECURE: Payment intent ${paymentIntent.id} marked as COMPLETED`);

    } catch (paymentError) {
      console.error('❌ Centralized payment service error:', paymentError);
      
      // ✅ SECURE: Rollback stock reservation and payment intent on payment failure
      try {
        await stockReservationService.cancelReservation(
          stockReservation.reservationId,
          'Payment creation failed'
        );
        
        await paymentIntentService.updatePaymentIntentStatus(
          paymentIntent.id,
          'FAILED'
        );
        
        console.log(`🔄 SECURE ROLLBACK: Released reservation ${stockReservation.reservationId}`);
      } catch (rollbackError) {
        console.error('❌ SECURE ROLLBACK ERROR:', rollbackError);
      }
      
      // ✅ STEP 5: Cancel booking
      await prisma.booking.update({
        where: { id: result.booking.id },
        data: { status: 'CANCELLED' }
      });
      
      // ✅ CENTRALIZED: Error handling through PaymentService
      if (paymentError.isOperational) {
        throw paymentError;
      } else {
        throw new AppError('Payment processing failed. Please try again.', 500);
      }
    }
  }

  // Send payment created notification
  try {
    // ✅ DEBUG: Log user authentication status
    console.log(`🔍 DEBUG - req.user:`, req.user);
    console.log(`🔍 DEBUG - req.user.id:`, req.user?.id);
    console.log(`🔍 DEBUG - typeof req.user.id:`, typeof req.user?.id);
    
    if (!req.user?.id) {
      throw new Error(`❌ CRITICAL: req.user.id is ${req.user?.id}. Auth middleware failed!`);
    }
    
    console.log(`📤 Sending payment created notification to user ${req.user.id} for booking ${result.booking.bookingCode}`);
    const notificationService = getNotificationService();
    await notificationService.sendPaymentCreated(req.user.id, {
      eventName: result.booking.event?.title || result.booking.accessTier?.name || 'Event',
      eventImage: result.booking.event?.imageUrl,
      bookingCode: result.booking.bookingCode,
      eventId: result.booking.eventId,
      totalAmount: result.booking.totalAmount,
      quantity: result.booking.quantity
    });
    console.log(`📱 Payment created notification sent successfully`);
  } catch (notifError) {
    console.error('❌ Error sending payment created notification:', notifError.message || notifError);
    // Don't fail the booking if notification fails
  }

  // ✅ ENTERPRISE: Use standardized response format
  res.status(201).json(successResponse(
    'Booking created successfully',
    {
      booking: {
        id: result.booking.id,
        bookingCode: result.booking.bookingCode,
        quantity: result.booking.quantity,
        totalAmount: result.booking.totalAmount,
        status: result.booking.status,
        paymentStatus: 'PENDING', // Explicitly show payment is pending
        expiresAt: result.booking.expiresAt,
        accessTier: result.booking.accessTier,
        event: result.booking.event
      },
      payment: paymentResult?.data || null // ✅ Use PaymentService response directly - already has midtransRedirectUrl
    }
  ));
}));

// @route   POST /api/bookings/:bookingCode/payment-processing
// @desc    Mark payment as processing and send notification
// @access  Private
router.post('/:bookingCode/payment-processing', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;

  // Find the booking
  const booking = await prisma.booking.findFirst({
    where: {
      bookingCode,
      userId: req.user.id,
      status: 'PENDING'
    },
    include: {
      event: {
        select: {
          title: true,
          imageUrl: true
        }
      },
      accessTier: {
        select: {
          name: true
        }
      }
    }
  });

  if (!booking) {
    throw new AppError('Booking not found or not accessible', 404);
  }

  // Check if booking is still valid (not expired)
  if (new Date() > booking.expiresAt) {
    throw new AppError('Booking has expired', 400);
  }

  // Send payment processing notification
  try {
    console.log(`📤 Sending payment processing notification for booking ${bookingCode}`);
    const notificationService = getNotificationService();
    await notificationService.sendPaymentProcessing(req.user.id, {
      eventName: booking.event?.title || booking.accessTier?.name || 'Event',
      eventImage: booking.event?.imageUrl,
      bookingCode: booking.bookingCode,
      eventId: booking.eventId,
      totalAmount: booking.totalAmount,
      quantity: booking.quantity
    });
    console.log(`📱 Payment processing notification sent successfully`);
  } catch (notifError) {
    console.error('❌ Error sending payment processing notification:', notifError);
    // Don't fail the request if notification fails
  }

  // ✅ ENTERPRISE: Use standardized response format
  res.json(successResponse(
    'Payment processing notification sent',
    {
      bookingCode: booking.bookingCode,
      status: 'PROCESSING'
    }
  ));
}));

// @route   GET /api/bookings
// @desc    Get user's bookings
// @access  Private
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;

  const where = {
    userId: req.user.id,
    ...(status && { status })
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      skip: offset,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        accessTier: {
          select: {
            name: true,
            description: true
          }
        },
        event: {
          select: {
            title: true,
            startDate: true,
            location: true,
            imageUrl: true
          }
        },
        accessTickets: {
          select: {
            id: true,
            ticketCode: true,
            status: true
          }
        }
      }
    }),
    prisma.booking.count({ where })
  ]);

  res.json({
    success: true,
    data: bookings,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/bookings/:bookingId
// @desc    Get specific booking details
// @access  Private
router.get('/:bookingId', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  const booking = await prisma.booking.findFirst({
    where: { 
      id: bookingId,
      userId: req.user.id 
    },
    include: {
      accessTier: true,
      event: true,
      accessTickets: true
    }
  });

  if (!booking) {
    throw new AppError('Booking not found', 404);
  }

  res.json({
    success: true,
    data: booking
  });
}));

// @route   POST /api/bookings/:bookingId/cancel
// @desc    Cancel a booking
// @access  Private


// Helper function to handle guestlist payment webhooks
async function handleGuestlistPaymentWebhook(orderId, transactionStatus, fraudStatus, req, res) {
  console.log('🎫 Processing guestlist payment webhook:', { orderId, transactionStatus, fraudStatus });

  const result = await prisma.$transaction(async (tx) => {
    // Find guestlist entry by payment ID
    let guestListEntry = await tx.guestList.findFirst({
      where: { paymentId: orderId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            startDate: true,
            location: true
          }
        }
      }
    });

    // Fallback: Find by guestListId if exact paymentId not found (for retry payments)
    if (!guestListEntry && orderId.startsWith('GL-')) {
      const parts = orderId.split('-');
      if (parts.length >= 2) {
        const guestListId = parts[1];
        console.log(`🔍 Fallback: Looking for guestlist entry by ID: ${guestListId}`);
        
        guestListEntry = await tx.guestList.findFirst({
          where: { 
            id: guestListId,
            status: 'APPROVED', // Only process approved entries
            isPaid: false // Only process unpaid entries
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                email: true
              }
            },
            event: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
                startDate: true,
                location: true
              }
            }
          }
        });
        
        if (guestListEntry) {
          console.log(`✅ Found guestlist entry via fallback: ${guestListEntry.id}`);
        }
      }
    }

    if (!guestListEntry) {
      throw new AppError('Guestlist entry not found for payment ID: ' + orderId, 404);
    }

    let isPaid = guestListEntry.isPaid;
    let paidAt = guestListEntry.paidAt;

    // Import PaymentVerificationService for enhanced validation
    const PaymentService = require('../services/core/PaymentService');
    
    // Update payment status based on Midtrans response with enhanced validation
    if (['capture', 'settlement'].includes(transactionStatus) && (!fraudStatus || fraudStatus === 'accept')) {
      isPaid = true;
      paidAt = new Date();
      console.log(`✅ Guestlist payment confirmed for ${orderId}: status=${transactionStatus}, fraud=${fraudStatus || 'null'}`);
    } else if (transactionStatus === 'cancel' || transactionStatus === 'expire' || transactionStatus === 'deny') {
      isPaid = false;
      paidAt = null;
      console.log(`❌ Guestlist payment failed for ${orderId}: status=${transactionStatus}`);
    }

    // Update guestlist entry
    const updatedEntry = await tx.guestList.update({
      where: { id: guestListEntry.id },
      data: {
        isPaid,
        paidAt
      }
    });

    // If payment successful, generate access ticket
    if (isPaid) {
      // Generate access ticket for guestlist
      const ticketCode = `GL${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${ticketCode}`;

      // For guestlist, we need to find or create a virtual access tier
      // Let's try to find the cheapest tier or create a virtual one
      let guestlistTier = await tx.accessTier.findFirst({
        where: { 
          eventId: guestListEntry.eventId,
          isActive: true
        },
        orderBy: { price: 'asc' }
      });

      // If no tiers found, we can't create access ticket
      // This should not happen in normal flow, but let's handle it
      if (!guestlistTier) {
        console.log('⚠️ No access tier found for guestlist ticket creation');
        // Skip access ticket creation for now - user still gets guestlist entry
      } else {
        await tx.access.create({
          data: {
            userId: guestListEntry.userId,
            eventId: guestListEntry.eventId,
            accessTierId: guestlistTier.id, // Use found tier
            type: 'GUEST_LIST', // ✅ FIX: Proper guestlist type (not RSVP)
            ticketCode,
            qrCode,
            status: 'CONFIRMED',
            currency: 'IDR',
            price: guestListEntry.platformFee || 0,
            validUntil: guestListEntry.event.startDate,
            venueDetails: guestListEntry.event.location
          }
        });
        console.log(`✅ Guestlist access ticket created: ${ticketCode}`);
      }

      // Send success notification
      try {
        console.log(`📤 Sending guestlist payment success notification to user ${guestListEntry.userId}`);
        const notificationService = getNotificationService();
    const success = await notificationService.sendToUser(guestListEntry.userId, {
          type: 'GUESTLIST_PAYMENT_SUCCESS',
          title: '🎉 Guestlist Payment Successful!',
          body: `Your guestlist access for "${guestListEntry.event.title}" is confirmed. Your ticket is ready!`,
          imageUrl: guestListEntry.event.imageUrl,
          actionData: {
            eventId: guestListEntry.eventId,
            guestListId: guestListEntry.id,
            action: 'VIEW_TICKET'
          }
        });
        console.log(`📱 Guestlist payment success notification result: ${success ? 'SUCCESS' : 'FAILED'}`);
      } catch (notifError) {
        console.error('❌ Error sending guestlist payment success notification:', notifError);
      }
    }

    // Update payment history - find by ticketType for guestlist payments
    await tx.paymentHistory.updateMany({
      where: {
        userId: guestListEntry.userId,
        eventId: guestListEntry.eventId,
        ticketType: 'Guestlist Access', // Match the ticketType we set when creating
        status: 'PENDING'
      },
      data: {
        status: isPaid ? 'SUCCESS' : 'FAILED'
      }
    });

    return { updatedEntry, isPaid };
  });

  console.log('🔔 Guestlist webhook processing completed:', {
    orderId,
    isPaid: result.isPaid,
    guestListId: result.updatedEntry.id
  });

  res.json({
    success: true,
    message: 'Guestlist webhook processed successfully',
    data: { 
      orderId,
      isPaid: result.isPaid
    }
  });
}

// @route   POST /api/bookings/webhook
// @desc    DEPRECATED: Use centralized webhook at /webhooks/midtrans instead
// @access  Public (but verified)
// ❌ DEPRECATED: This endpoint is replaced by centralized webhook system
router.post('/webhook', asyncHandler(async (req, res) => {
  console.log('⚠️ DEPRECATED: /api/bookings/webhook called - redirecting to centralized webhook');
  
  // Redirect to centralized webhook
  res.status(301).json({
    success: false,
    message: 'This webhook endpoint is deprecated. Please use /webhooks/midtrans instead.',
    deprecated: true,
    redirect: '/webhooks/midtrans',
    timestamp: new Date().toISOString()
  });
  
  return; // Exit early - OLD CODE BELOW IS DISABLED
  /*
  const notification = req.body;
  const webhookStartTime = Date.now();
  
  // Set start time for monitoring
  req.webhookStartTime = webhookStartTime;
  
  // Enhanced webhook logging for better monitoring
  console.log('🔔 Midtrans webhook received:', {
    order_id: notification.order_id,
    transaction_status: notification.transaction_status,
    fraud_status: notification.fraud_status,
    payment_type: notification.payment_type,
    gross_amount: notification.gross_amount,
    signature_key: notification.signature_key ? 'present' : 'missing',
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent')
  });
  
  // Log webhook payload for debugging (careful with sensitive data)
  if (process.env.NODE_ENV !== 'production') {
    console.log('🔍 Full webhook payload (dev only):', JSON.stringify(notification, null, 2));
  }

  // Verify Midtrans signature for security
  const isSignatureValid = verifyMidtransSignature(notification);
  if (!isSignatureValid) {
    console.log('❌ Invalid Midtrans signature, ignoring webhook');
    return res.status(401).json({
      success: false,
      message: 'Invalid signature'
    });
  }
  
  const orderId = notification.order_id;
  const transactionStatus = notification.transaction_status;
  const fraudStatus = notification.fraud_status;

  console.log('✅ Midtrans webhook signature verified');

  // Log fraud detection result
  if (req.fraudCheck) {
    console.log('🛡️ Webhook fraud check:', {
      approved: req.fraudCheck.approved,
      riskScore: req.fraudCheck.riskScore,
      riskLevel: req.fraudCheck.riskLevel,
      action: req.fraudCheck.action,
      flags: req.fraudCheck.flags
    });
  }

  // Check if this is a guestlist payment (payment ID starts with "GL-")
  const isGuestlistPayment = orderId.startsWith('GL-');
  
  if (isGuestlistPayment) {
    // Handle guestlist payment separately
    return await handleGuestlistPaymentWebhook(orderId, transactionStatus, fraudStatus, req, res);
  }

  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { bookingCode: orderId },
      include: { 
        accessTier: true,
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true
          }
        }
      }
    });

    if (!booking) {
      throw new AppError('Booking not found for order ID: ' + orderId, 404);
    }

    let newStatus = booking.status;
    let newPaymentStatus = booking.paymentStatus;

    // Import PaymentVerificationService for enhanced validation
    const PaymentService = require('../services/core/PaymentService');
    
    // Update status based on Midtrans response with enhanced validation
    if (['capture', 'settlement'].includes(transactionStatus) && (!fraudStatus || fraudStatus === 'accept')) {
      newStatus = 'CONFIRMED';
      newPaymentStatus = 'SUCCESS';
      console.log(`✅ Payment confirmed for booking ${orderId}: status=${transactionStatus}, fraud=${fraudStatus || 'null'}`);
    } else if (transactionStatus === 'pending') {
      newStatus = 'PROCESSING';
      newPaymentStatus = 'PENDING';
    } else if (transactionStatus === 'cancel' || transactionStatus === 'expire' || transactionStatus === 'deny') {
      newStatus = 'CANCELLED';
      newPaymentStatus = transactionStatus === 'expire' ? 'EXPIRED' : 'FAILED';
      
      // Return stock to tier
      await tx.accessTier.update({
        where: { id: booking.accessTierId },
        data: {
          soldQuantity: { decrement: booking.quantity },
          availableQuantity: { increment: booking.quantity }
        }
      });
    }

    // Update booking
    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: newStatus,
        paymentStatus: newPaymentStatus,
        paidAt: newPaymentStatus === 'SUCCESS' ? new Date() : null
      }
    });

    // Send push notification based on payment status
    if (newPaymentStatus === 'SUCCESS') {
      // Send payment success notification
      try {
        console.log(`📤 Sending payment success notification to user ${booking.userId} for booking ${booking.bookingCode}`);
        const notificationService = getNotificationService();
    const success = await notificationService.sendPaymentSuccess(booking.userId, {
          eventName: booking.accessTier?.name || booking.event?.title || 'Event',
          eventImage: booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId
        });
        console.log(`📱 Payment success notification result: ${success ? 'SUCCESS' : 'FAILED'}`);
      } catch (notifError) {
        console.error('❌ Error sending payment success notification:', notifError);
      }
    } else if (newPaymentStatus === 'FAILED' || newPaymentStatus === 'EXPIRED') {
      // Send payment failed notification
      try {
        const notificationService = getNotificationService();
        await notificationService.sendPaymentFailed(booking.userId, {
          eventName: booking.accessTier?.name || 'Event',
          eventImage: booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId
        });
      } catch (notifError) {
        console.error('❌ Error sending payment failed notification:', notifError);
      }
    }

    // Generate access tickets if payment successful
    if (newStatus === 'CONFIRMED' && newPaymentStatus === 'SUCCESS') {
      const tickets = [];
      
      try {
        // Get access tier for validation
        const accessTier = await tx.accessTier.findUnique({
          where: { id: booking.accessTierId },
          include: { event: true }
        });

        if (!accessTier) {
          throw new Error(`Access tier ${booking.accessTierId} not found`);
        }

        // Generate tickets with proper error handling
        for (let i = 0; i < booking.quantity; i++) {
          const ticketCode = await generateTicketCode(booking.accessTierId, booking.id + i);
          const qrCode = generateQRCode();
          
          const ticket = await tx.access.create({
            data: {
              type: 'TICKET',
              ticketCode,
              qrCode,
              status: 'CONFIRMED',
              currency: booking.currency,
              price: booking.unitPrice,
              // ✅ FIX: Ticket valid sampai event END + 7 hari buffer, bukan berdasarkan waktu beli
validUntil: (() => {
  if (accessTier.event?.endDate) {
    // Ticket valid sampai 7 hari setelah event selesai
    return new Date(new Date(accessTier.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (accessTier.event?.startDate) {
    // Fallback: Event start + 1 hari (asumsi event 1 hari)
    return new Date(new Date(accessTier.event.startDate).getTime() + 24 * 60 * 60 * 1000);
  } else {
    // Fallback: 30 hari dari sekarang (untuk event tanpa tanggal)
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
})(),
              userId: booking.userId,
              eventId: booking.eventId,
              accessTierId: booking.accessTierId,
              bookingId: booking.id,
              ipAddress: booking.ipAddress,
              userAgent: booking.userAgent
            }
          });
          
          tickets.push(ticket);
        }

        // Send tickets ready notification (enhanced)
        try {
          console.log(`📤 Sending tickets ready notification to user ${booking.userId} for ${tickets.length} tickets`);
          const notificationService = getNotificationService();
        await notificationService.sendTicketsReady(booking.userId, {
            eventName: accessTier.event?.title || booking.accessTier?.name || 'Event',
            eventImage: accessTier.event?.imageUrl,
            bookingCode: booking.bookingCode,
            eventId: booking.eventId,
            ticketCount: tickets.length,
            accessId: tickets[0]?.id
          });
          console.log(`📱 Tickets ready notification sent successfully`);
        } catch (notifError) {
          console.error('❌ Error sending tickets ready notification:', notifError);
        }

        console.log(`✅ Generated ${tickets.length} access tickets for booking ${booking.bookingCode}`);
        
        // Update existing payment history record to SUCCESS or create new one if not exists
        try {
          console.log(`📋 Updating payment history record for webhook payment ${booking.bookingCode}`);
          
          // Try to update existing pending payment history first
          const existingPaymentHistory = await tx.paymentHistory.findFirst({
            where: {
              bookingCode: booking.bookingCode,
              status: 'PENDING'
            }
          });

          if (existingPaymentHistory) {
            // Update existing pending record to success
            await tx.paymentHistory.update({
              where: { id: existingPaymentHistory.id },
              data: {
                status: 'SUCCESS',
                transactionDate: new Date(),
                paymentMethod: existingPaymentHistory.paymentMethod || 'MIDTRANS_WEBHOOK'
              }
            });
            console.log(`✅ Updated existing payment history record to SUCCESS`);
          } else {
            // Create new record if no pending record exists (for backward compatibility)
            await tx.paymentHistory.create({
              data: {
                transactionId: booking.paymentId,
                userId: booking.userId,
                eventId: booking.eventId,
                eventName: accessTier.event?.title || booking.accessTier?.name || 'Event',
                amount: booking.totalAmount, // Already in rupiah
                subtotalAmount: booking.subtotalAmount || null,
                platformFee: booking.platformFee || null,
                taxAmount: booking.taxAmount || null,
                currency: booking.currency,
                status: 'SUCCESS',
                paymentMethod: 'MIDTRANS_WEBHOOK',
                transactionDate: new Date(),
                ticketType: booking.accessTier?.name || 'General Admission',
                imageUrl: accessTier.event?.imageUrl,
                bookingCode: booking.bookingCode,
                paymentUrl: null,
              }
            });
            console.log(`✅ Created new payment history record for SUCCESS`);
          }
          console.log(`✅ Payment history record created for webhook ${booking.bookingCode}`);
        } catch (historyError) {
          console.error('❌ Error creating payment history record in webhook:', historyError);
        }
        
      } catch (ticketError) {
        console.error('❌ Error generating access tickets:', ticketError);
        console.error('❌ Full error details:', {
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          accessTierId: booking.accessTierId,
          userId: booking.userId,
          error: ticketError.message,
          stack: ticketError.stack
        });
        
        // Create error notification for user
        await tx.notification.create({
          data: {
            userId: booking.userId,
            type: 'SYSTEM',
            title: 'Access Generation Issue',
            message: 'Your payment was successful but there was an issue generating your access tickets. Our team will resolve this shortly.',
            data: {
              bookingId: booking.id,
              error: 'TICKET_GENERATION_FAILED',
              timestamp: new Date().toISOString()
            }
          }
        });
        
        // Log for manual intervention
        console.error(`❌ CRITICAL: Manual intervention required for booking ${booking.bookingCode}`);
        console.error('❌ Support team should manually generate tickets for this user');
      }
      
      return { updatedBooking, tickets };
    }

    return { updatedBooking, tickets: [] };
  });

  // Enhanced completion logging for monitoring and debugging
  console.log('✅ Webhook processing completed successfully:', {
    orderId,
    userId: result.updatedBooking.userId,
    oldStatus: booking.status,
    newStatus: result.updatedBooking.status,
    oldPaymentStatus: booking.paymentStatus,
    newPaymentStatus: result.updatedBooking.paymentStatus,
    ticketsGenerated: result.tickets ? result.tickets.length : 0,
    timestamp: new Date().toISOString(),
    transactionStatus,
    fraudStatus,
    paymentType: notification.payment_type,
    grossAmount: notification.gross_amount
  });
  
  // Alert if no tickets were generated for successful payment
  if (result.updatedBooking.paymentStatus === 'SUCCESS' && result.updatedBooking.status === 'CONFIRMED' && (!result.tickets || result.tickets.length === 0)) {
    console.log('🚨 [ALERT] Payment successful but no tickets generated! Manual intervention may be required.');
    console.log('🚨 [ALERT] Booking details:', {
      bookingCode: orderId,
      userId: result.updatedBooking.userId,
      eventId: result.updatedBooking.eventId,
      quantity: result.updatedBooking.quantity
    });
  }

  res.json({
    success: true,
    message: 'Webhook processed successfully',
    data: {
      orderId,
      status: result.updatedBooking.status,
      paymentStatus: result.updatedBooking.paymentStatus,
      ticketsGenerated: result.tickets ? result.tickets.length : 0
    }
  });
  */
})); // END DEPRECATED OLD WEBHOOK

// @route   POST /api/bookings/regenerate-ticket-codes
// @desc    Regenerate all long ticket codes with new short format
// @access  Private (Admin)
router.post('/regenerate-ticket-codes', authMiddleware, asyncHandler(async (req, res) => {
  // Only admin can run this
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  console.log('🔧 Regenerating long ticket codes...');
  
  const result = await prisma.$transaction(async (tx) => {
    // Find all tickets with long ticket codes (>20 characters)
    const longTickets = await tx.access.findMany({
      where: {
        ticketCode: {
          not: null
        }
      },
      include: {
        booking: true
      }
    });

    // Filter tickets that are too long
    const ticketsToFix = longTickets.filter(ticket => 
      ticket.ticketCode && ticket.ticketCode.length > 20
    );

    console.log(`🔍 Found ${ticketsToFix.length} tickets with long codes`);
    
    const updatedTickets = [];
    
    for (let i = 0; i < ticketsToFix.length; i++) {
      const ticket = ticketsToFix[i];
      
      try {
        // Generate new short ticket code
        const newTicketCode = await generateTicketCode(ticket.accessTierId, i + 1);
        
        // Update ticket with new short code
        const updatedTicket = await tx.access.update({
          where: { id: ticket.id },
          data: { ticketCode: newTicketCode }
        });

        console.log(`✅ Updated ticket ${ticket.ticketCode} → ${newTicketCode}`);
        updatedTickets.push({
          ticketId: ticket.id,
          oldCode: ticket.ticketCode,
          newCode: newTicketCode,
          eventId: ticket.eventId
        });

      } catch (error) {
        console.error(`❌ Error updating ticket ${ticket.id}:`, error);
      }
    }

    return updatedTickets;
  });

  res.json({
    success: true,
    message: `Regenerated ${result.length} ticket codes`,
    data: { updatedTickets: result }
  });
}));

// @route   POST /api/bookings/fix-stuck-payments
// @desc    Fix stuck payments that were successful but didn't generate tickets
// @access  Private (Admin)
router.post('/fix-stuck-payments', authMiddleware, asyncHandler(async (req, res) => {
  // Only admin can run this
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  console.log('🔧 Fixing stuck payments...');
  
  const result = await prisma.$transaction(async (tx) => {
    // Find bookings that are stuck (no access tickets but payment might be successful)
    const stuckBookings = await tx.booking.findMany({
      where: {
        status: 'PENDING',
        paymentStatus: 'PENDING',
        access: {
          none: {} // No access tickets generated
        }
      },
      include: {
        accessTier: {
          include: { event: true }
        },
        access: true
      }
    });

    console.log(`🔍 Found ${stuckBookings.length} potentially stuck bookings`);
    
    const fixedBookings = [];
    
    for (const booking of stuckBookings) {
      try {
        // For demo/testing, simulate successful payment
        // In production, you'd check with Midtrans API first
        console.log(`🛠️ Processing booking ${booking.bookingCode}...`);
        
        // Update booking status
        const updatedBooking = await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CONFIRMED',
            paymentStatus: 'SUCCESS',
            paidAt: new Date()
          },
          include: {
            accessTier: { include: { event: true } }
          }
        });

        // Generate access tickets
        const tickets = [];
        for (let i = 0; i < booking.quantity; i++) {
          const ticketCode = await generateTicketCode(booking.accessTierId, booking.id + i);
          const qrCode = generateQRCode();
          
          const ticket = await tx.access.create({
            data: {
              type: 'TICKET',
              ticketCode,
              qrCode,
              status: 'CONFIRMED',
              currency: booking.currency,
              price: booking.unitPrice,
              validUntil: new Date(booking.accessTier.event?.startDate || Date.now() + 90 * 24 * 60 * 60 * 1000),
              userId: booking.userId,
              eventId: booking.eventId,
              accessTierId: booking.accessTierId,
              bookingId: booking.id,
              ipAddress: booking.ipAddress,
              userAgent: booking.userAgent
            }
          });
          
          tickets.push(ticket);
        }

        console.log(`✅ Fixed booking ${booking.bookingCode} - Generated ${tickets.length} tickets`);
        fixedBookings.push({
          bookingCode: booking.bookingCode,
          eventName: booking.accessTier.event?.title,
          ticketsGenerated: tickets.length
        });

      } catch (error) {
        console.error(`❌ Error fixing booking ${booking.bookingCode}:`, error);
      }
    }

    return fixedBookings;
  });

  res.json({
    success: true,
    message: `Fixed ${result.length} stuck payments`,
    data: { fixedBookings: result }
  });
}));

// @route   POST /api/bookings/webhook/test
// @desc    Test webhook endpoint for debugging
// @access  Private (Admin only in production)
router.post('/webhook/test', asyncHandler(async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('Test endpoint not available in production', 403);
  }

  const { bookingCode, transactionStatus = 'settlement', fraudStatus = 'accept' } = req.body;

  if (!bookingCode) {
    throw new AppError('bookingCode is required for testing', 400);
  }

  console.log(`🧪 Testing webhook for booking: ${bookingCode}`);

  // Simulate Midtrans notification using environment configuration
  const testNotification = {
    order_id: bookingCode,
    transaction_status: transactionStatus,
    fraud_status: fraudStatus,
    payment_type: TEST_PAYMENT_TYPE,
    gross_amount: TEST_PAYMENT_AMOUNT,
    status_code: '200',
    signature_key: 'test_signature'
  };

  // Process using the same logic as webhook
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { bookingCode },
      include: { accessTier: true }
    });

    if (!booking) {
      throw new AppError('Booking not found for code: ' + bookingCode, 404);
    }

    let newStatus = booking.status;
    let newPaymentStatus = booking.paymentStatus;

    // Update status based on test parameters
    if (transactionStatus === 'settlement') {
      newStatus = 'CONFIRMED';
      newPaymentStatus = 'SUCCESS';
    } else if (transactionStatus === 'pending') {
      newStatus = 'PROCESSING';
      newPaymentStatus = 'PENDING';
    } else if (transactionStatus === 'cancel' || transactionStatus === 'expire') {
      newStatus = 'CANCELLED';
      newPaymentStatus = transactionStatus === 'expire' ? 'EXPIRED' : 'FAILED';
    }

    // Update booking
    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: newStatus,
        paymentStatus: newPaymentStatus,
        paidAt: newPaymentStatus === 'SUCCESS' ? new Date() : null
      }
    });

    // Generate tickets if payment successful
    let tickets = [];
    if (newStatus === 'CONFIRMED' && newPaymentStatus === 'SUCCESS') {
      const accessTier = await tx.accessTier.findUnique({
        where: { id: booking.accessTierId },
        include: { event: true }
      });

      for (let i = 0; i < booking.quantity; i++) {
        const ticketCode = await generateTicketCode(booking.accessTierId, booking.id + i);
        const qrCode = generateQRCode();
        
        const ticket = await tx.access.create({
          data: {
            type: 'TICKET',
            ticketCode,
            qrCode,
            status: 'CONFIRMED',
            currency: booking.currency,
            price: booking.unitPrice,
            // ✅ FIX: Ticket valid sampai event END + 7 hari buffer, bukan berdasarkan waktu beli
validUntil: (() => {
  if (accessTier.event?.endDate) {
    // Ticket valid sampai 7 hari setelah event selesai
    return new Date(new Date(accessTier.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (accessTier.event?.startDate) {
    // Fallback: Event start + 1 hari (asumsi event 1 hari)
    return new Date(new Date(accessTier.event.startDate).getTime() + 24 * 60 * 60 * 1000);
  } else {
    // Fallback: 30 hari dari sekarang (untuk event tanpa tanggal)
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
})(),
            userId: booking.userId,
            eventId: booking.eventId,
            accessTierId: booking.accessTierId,
            bookingId: booking.id,
            ipAddress: req?.ip || '127.0.0.1',
            userAgent: req?.get('User-Agent') || 'Test Agent'
          }
        });
        
        tickets.push(ticket);
      }

      console.log(`🧪 Test: Generated ${tickets.length} tickets for booking ${bookingCode}`);
    }

    return { updatedBooking, tickets };
  });

  res.json({
    success: true,
    message: 'Test webhook processed successfully',
    data: {
      bookingCode,
      status: result.updatedBooking.status,
      paymentStatus: result.updatedBooking.paymentStatus,
      ticketsGenerated: result.tickets.length,
      testNotification
    }
  });
}));

// @route   GET /api/bookings/:bookingCode/payment-url
// @desc    Get payment URL for pending booking
// @access  Private
router.get('/:bookingCode/payment-url', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;
  
  console.log(`🔗 Getting payment URL for booking: ${bookingCode}`);
  
  try {
    // Get booking with payment details
    const booking = await prisma.booking.findUnique({
      where: { bookingCode },
      select: { 
        id: true, 
        userId: true, 
        status: true, 
        paymentStatus: true,
        paymentId: true,
        totalAmount: true,
        expiresAt: true
      }
    });
    
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }
    
    // Verify user owns the booking
    if (booking.userId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }
    
    // Check if booking is still pending and has paymentId (Midtrans token)
    if (booking.status !== 'PENDING' || booking.paymentStatus !== 'PENDING') {
      throw new AppError('Booking is no longer pending payment', 400);
    }
    
    if (!booking.paymentId) {
      throw new AppError('Payment URL not available - no payment token found', 400);
    }

    // Check if booking has expired
    if (new Date() > new Date(booking.expiresAt)) {
      throw new AppError('Booking has expired. Please create a new booking.', 410);
    }

    // Check Midtrans payment status to validate token is still valid
    let midtransStatus = null;
    try {
      const PaymentVerificationService = require('../services/core/PaymentVerificationService');
      midtransStatus = await PaymentVerificationService.checkPaymentStatusViaAPI(bookingCode);
      console.log(`🔍 Midtrans status check for payment URL:`, midtransStatus);

      // If payment is already completed, expired, or failed at Midtrans
      if (midtransStatus?.transaction_status) {
        const status = midtransStatus.transaction_status.toLowerCase();
        if (['settlement', 'capture'].includes(status)) {
          throw new AppError('Payment has already been completed', 400);
        }
        if (['expire', 'cancel', 'deny', 'failure'].includes(status)) {
          throw new AppError('Payment session has expired or failed. Please create a new booking.', 410);
        }
      }
    } catch (midtransError) {
      console.warn('⚠️ Could not verify Midtrans status for payment URL:', midtransError.message);
      // Continue with payment URL generation if Midtrans check fails
    }
    
    // Try to get existing payment URL from payment history first
    const paymentHistory = await prisma.paymentHistory.findFirst({
      where: {
        bookingCode,
        status: 'PENDING'
      },
      select: {
        id: true,
        paymentUrl: true
      }
    });
    
    let paymentUrl;
    
    if (paymentHistory?.paymentUrl && paymentHistory.paymentUrl.includes('midtrans.com')) {
      // Use stored payment URL from payment history if it's valid
      paymentUrl = paymentHistory.paymentUrl;
      console.log(`✅ Using stored payment URL from history: ${paymentUrl}`);
    } else {
      // Generate Snap URL using existing snap token
      console.log(`🔄 Generating Snap URL for token: ${booking.paymentId}`);
      
      // Use Midtrans Snap redirect URL format
      const snapBaseUrl = MIDTRANS_IS_PRODUCTION 
        ? 'https://app.midtrans.com'
        : 'https://app.sandbox.midtrans.com';
      
      paymentUrl = `${snapBaseUrl}/snap/v1/transactions/${booking.paymentId}`;
      console.log(`🔗 Generated Snap URL: ${paymentUrl}`);
      
      // Update payment history with the URL for future use
      if (paymentHistory?.id) {
        try {
          await prisma.paymentHistory.update({
            where: { id: paymentHistory.id },
            data: { paymentUrl }
          });
          console.log(`💾 Updated payment history with URL`);
        } catch (updateError) {
          console.warn('⚠️ Could not update payment history with URL:', updateError.message);
          // Don't fail the request if history update fails
        }
      }
    }
    
    res.json({
      success: true,
      message: 'Payment URL retrieved successfully',
      data: {
        bookingCode,
        paymentUrl,
        paymentId: booking.paymentId,
        amount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        expiresAt: booking.expiresAt,
        midtransStatus: midtransStatus?.transaction_status || null
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting payment URL:', error);
    throw error;
  }
}));

// @route   GET /api/bookings/:bookingCode/payment-status
// @desc    DEPRECATED: Use universal payment endpoint at /api/payments/status/:bookingCode
// @access  Private
// ❌ DEPRECATED: This endpoint is replaced by universal payment system
router.get('/:bookingCode/payment-status', 
  authMiddleware, 
  asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;
  
  console.log(`⚠️ DEPRECATED: /api/bookings/${bookingCode}/payment-status called - redirecting to universal endpoint`);
  
  // Redirect to universal payment endpoint
  res.status(301).json({
    success: false,
    message: 'This booking payment endpoint is deprecated. Please use the universal payment endpoint instead.',
    deprecated: true,
    redirect: `/api/payments/status/${bookingCode}`,
    timestamp: new Date().toISOString()
  });
  
  return; // Exit early - OLD CODE BELOW IS DISABLED
  /*
  
  // ✅ CENTRALIZED: Use centralized payment service
  const PaymentService = require('../services/core/PaymentService');
  const paymentService = new PaymentService();
  
  console.log(`🔍 Checking booking payment status via centralized service: ${bookingCode}`);
  
  try {
    // ✅ STEP 1: Get booking to verify ownership and get payment details
    const booking = await prisma.booking.findUnique({
      where: { bookingCode },
              select: { 
        id: true, 
        userId: true, 
        status: true, 
        paymentStatus: true,
        paymentId: true,
        totalAmount: true,
        eventId: true,
        createdAt: true
      }
    });
    
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }
    
    // ✅ STEP 2: Verify user owns the booking
    if (booking.userId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }
    
    // ✅ STEP 3: Use centralized payment status check with auto-verification fallback
    // If payment is still PENDING and webhook might have been missed, auto-verify with Midtrans API
    let statusResult = await paymentService.checkPaymentStatus(bookingCode, req.user.id);
    
    // 🚨 EMERGENCY AUTO-VERIFICATION: Fix stuck payments immediately
    console.log(`🔍 Current status check for ${bookingCode}:`, {
      statusResultData: statusResult.data,
      bookingPaymentStatus: booking.paymentStatus,
      bookingStatus: booking.status,
      hasPaymentId: !!booking.paymentId
    });
    
    // Check if payment stuck (PENDING but should be checked)
    const paymentStuck = (booking.paymentStatus === 'PENDING' || 
                         statusResult.data?.status === 'PENDING' ||
                         statusResult.data?.transaction_status === 'pending') && booking.paymentId;
    
    if (paymentStuck) {
      const bookingAge = Date.now() - new Date(booking.createdAt || 0).getTime();
      const isOldEnough = bookingAge > 30 * 1000; // 30 seconds old (faster emergency check)
      
      console.log(`🚨 Payment stuck detected for ${bookingCode}:`, {
        bookingAge: Math.round(bookingAge/1000) + 's',
        isOldEnough,
        willAutoVerify: isOldEnough
      });
      
      if (isOldEnough) {
        console.log(`🔄 EMERGENCY auto-verification for ${bookingCode} (${Math.round(bookingAge/1000)}s old)`);
        
        try {
          // Emergency verification using multiple methods
          let midtransStatus = null;
          
          // ✅ CENTRALIZED: Use only PaymentVerificationService (no duplicate methods)
          try {
            const PaymentVerificationService = require('../services/core/PaymentVerificationService');
            const verificationService = new PaymentVerificationService();
            midtransStatus = await verificationService.checkPaymentStatusViaAPI(bookingCode);
            console.log(`🔍 Centralized PaymentVerificationService result:`, midtransStatus);
          } catch (verificationError) {
            console.log(`⚠️ PaymentVerificationService failed:`, verificationError.message);
            midtransStatus = null;
          }
          
          if (midtransStatus) {
            // ✅ FIXED: Check if payment is actually successful
            // Midtrans uses 'capture' and 'settlement' as success status, NOT 'success'
            const isNowSuccessful = midtransStatus?.transaction_status === 'settlement' ||
                                   midtransStatus?.transaction_status === 'capture';
            
            console.log(`🔍 Transaction status check:`, {
              transactionStatus: midtransStatus?.transaction_status,
              isNowSuccessful,
              currentBookingStatus: booking.paymentStatus
            });
            
            if (isNowSuccessful && booking.paymentStatus !== 'SUCCESS') {
              console.log(`✅ EMERGENCY FIX: Updating ${bookingCode} to SUCCESS - payment actually completed!`);
              
              // Immediately update booking status
              await prisma.booking.update({
                where: { bookingCode },
                data: {
                  paymentStatus: 'SUCCESS',
                  status: 'CONFIRMED',
                  paidAt: new Date()
                }
              });
              
              // Re-check status to get updated data
              statusResult = await paymentService.checkPaymentStatus(bookingCode, req.user.id);
              
              console.log(`🎉 EMERGENCY FIX successful for ${bookingCode}! Status updated.`);
            } else if (!isNowSuccessful) {
              console.log(`⏳ Payment ${bookingCode} still pending at Midtrans:`, midtransStatus?.transaction_status);
            }
          }
        } catch (autoVerifyError) {
          console.error(`❌ Emergency auto-verification failed for ${bookingCode}:`, autoVerifyError.message);
          // Continue with original status - don't fail the request
        }
      }
    }
    
    // ✅ STEP 4: Return FLUTTER-COMPATIBLE response format
    res.json({
      success: true,
      message: 'Payment status retrieved via centralized service',
      data: {
        // ✅ FLUTTER COMPATIBILITY: Keep old field names
        bookingCode: bookingCode,
        booking_status: booking.status,
        payment_status: statusResult.data.status, // Backend internal status
        
        // ✅ FLUTTER REQUIRED: transaction_status field for Flutter detection  
        // Must be Midtrans format (capture/settlement), NOT database format (SUCCESS)
        transaction_status: statusResult.data.midtransStatus?.transaction_status || 
                           (statusResult.data.status === 'SUCCESS' ? 'settlement' : 
                            statusResult.data.status === 'PENDING' ? 'pending' : 
                            statusResult.data.status === 'FAILED' ? 'failure' : 'pending'),
        
        // ✅ FRONTEND FIX: Add 'status' field that Flutter actually looks for
        // Use Midtrans format, not database format
        status: statusResult.data.midtransStatus?.transaction_status || 
               (statusResult.data.status === 'SUCCESS' ? 'settlement' : 
                statusResult.data.status === 'PENDING' ? 'pending' : 
                statusResult.data.status === 'FAILED' ? 'failure' : 'pending'),
        
        total_amount: booking.totalAmount,
        
        // Payment data
        paymentId: booking.paymentId,
        isPaid: statusResult.data.isPaid,
        paidAt: statusResult.data.paidAt,
        
        // Midtrans status (complete data) - Flutter checks this
        midtransStatus: statusResult.data.midtransStatus || null,
        
        // Service metadata
        centralizedService: {
          used: true,
          correlationId: statusResult.data.correlationId || 'unknown',
          timestamp: new Date().toISOString(),
          message: 'Backend centralized, Flutter compatible response',
          autoVerificationEnabled: true
        },
        
        // ✅ MANUAL VERIFICATION HELPER: If payment still pending, provide manual verification endpoint
        manualVerification: statusResult.data.status === 'PENDING' && booking.paymentId ? {
          available: true,
          quickVerifyEndpoint: `/api/bookings/${bookingCode}/quick-verify`,
          fullVerifyEndpoint: `/api/bookings/${bookingCode}/verify-payment`,
          message: 'If payment completed but status not updated, tap to verify manually',
          instructions: 'Use quick-verify for faster results'
        } : null
      }
    });
    
  } catch (error) {
    console.error(`❌ Centralized booking payment status check failed for ${bookingCode}:`, error);
    
    // ✅ CENTRALIZED: Error handling through PaymentService
    if (error.isOperational) {
      throw error;
    } else {
      throw new AppError('Failed to check payment status', 500);
    }
  }
  */
})); // END DEPRECATED BOOKING PAYMENT-STATUS

// @route   POST /api/bookings/:paymentId/confirm-snap
// @desc    UNIVERSAL: Confirm payment using Snap status and generate tickets (Booking + Guestlist)
// @access  Private
router.post('/:paymentId/confirm-snap', authMiddleware, asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  
  console.log(`💰 UNIVERSAL: Confirming Snap payment for: ${paymentId}`);
  
  try {
    // ✅ STEP 1: Auto-detect payment type
    const paymentType = paymentId.startsWith('GL') ? 'GUESTLIST' : 'BOOKING';
    console.log(`🎯 Detected payment type: ${paymentType} for ${paymentId}`);
    
    // ✅ STEP 2: Use centralized PaymentService
    const paymentService = new PaymentService();
    const statusResult = await paymentService.checkPaymentStatus(paymentId, req.user.id);
    
    if (!statusResult.success) {
      throw new AppError('Failed to check payment status', 500);
    }
    
    // Extract Midtrans status from centralized service result
    const snapStatus = statusResult.data.midtransStatus || {
      transaction_status: statusResult.data.status,
      order_id: paymentId
    };
    
    console.log(`📊 Snap status check for confirmation:`, {
      type: paymentType,
      transaction_status: snapStatus.transaction_status,
      fraud_status: snapStatus.fraud_status,
      order_id: snapStatus.order_id
    });
    
    const transactionStatus = snapStatus.transaction_status;
    const fraudStatus = snapStatus.fraud_status;
    
    // Validate payment is successful
    if ((transactionStatus !== 'capture' && transactionStatus !== 'settlement') ||
        (fraudStatus && fraudStatus !== 'accept')) {
      throw new AppError(`Payment not successful. Status: ${transactionStatus}, Fraud: ${fraudStatus}`, 400);
    }
    
    // ✅ STEP 3: Handle based on payment type (using fixed V2 logic)
    if (paymentType === 'GUESTLIST') {
      // Handle guestlist payment confirmation using fixed V2 logic
      const result = await confirmGuestlistPaymentV2(paymentId, req.user.id, snapStatus);
      return res.json({
        success: true,
        message: 'Guestlist payment confirmed successfully! Your access is ready.',
        data: result
      });
    } else {
      // Handle booking payment confirmation (existing logic)
      const result = await confirmBookingPayment(paymentId, req.user.id, snapStatus);
      return res.json({
        success: true,
        message: 'Booking payment confirmed successfully! Your tickets are ready.',
        data: result
      });
    }
    
  } catch (error) {
    console.error(`❌ Error confirming Snap payment:`, error);
    throw error;
  }
}));

// ✅ HELPER: Confirm booking payment (existing logic extracted)
async function confirmBookingPayment(bookingCode, userId, snapStatus) {
  try {
    const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { bookingCode },
      include: { 
        accessTier: true,
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true
          }
        }
      }
    });

    if (!booking) {
      throw new AppError('Booking not found', 404);
    }
      
    // Verify user owns the booking
    if (booking.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

      // Check if already confirmed
      if (booking.status === 'CONFIRMED' && booking.paymentStatus === 'SUCCESS') {
        // Get existing tickets
        const existingTickets = await tx.access.findMany({
          where: { bookingId: booking.id }
        });
        
        return {
          updatedBooking: booking,
          tickets: existingTickets,
          alreadyConfirmed: true
        };
      }

      // Update booking status
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'SUCCESS',
          paidAt: new Date()
        }
      });

      // Generate access tickets
      const tickets = [];
      
      try {
        // Get access tier for validation
        const accessTier = await tx.accessTier.findUnique({
          where: { id: booking.accessTierId },
          include: { event: true }
        });

        if (!accessTier) {
          throw new Error(`Access tier ${booking.accessTierId} not found`);
        }

        // Generate tickets with proper error handling
        for (let i = 0; i < booking.quantity; i++) {
          const ticketCode = await generateTicketCode(booking.accessTierId, booking.id + i);
          const qrCode = generateQRCode();
          
          const ticket = await tx.access.create({
            data: {
              type: 'TICKET',
              ticketCode,
              qrCode,
              status: 'CONFIRMED',
              price: booking.unitPrice,
              currency: booking.currency,
              venueDetails: `Access for ${accessTier.name} tier at ${accessTier.event?.eventName}`,
              // ✅ FIX: Ticket valid sampai event END + 7 hari buffer, bukan berdasarkan waktu beli
              validUntil: (() => {
                if (accessTier.event?.endDate) {
                  // Ticket valid sampai 7 hari setelah event selesai
                  return new Date(new Date(accessTier.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
                } else if (accessTier.event?.startDate) {
                  // Fallback: Event start + 1 hari (asumsi event 1 hari)
                  return new Date(new Date(accessTier.event.startDate).getTime() + 24 * 60 * 60 * 1000);
                } else {
                  // Fallback: 30 hari dari sekarang (untuk event tanpa tanggal)
                  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                }
              })(),
              userId: booking.userId,
              eventId: accessTier.eventId,
              accessTierId: booking.accessTierId,
              bookingId: booking.id,
            },
          });
          tickets.push(ticket);
        }

        console.log(`✅ Generated ${tickets.length} access tickets for booking ${bookingCode}`);
        
        // Update existing payment history record to SUCCESS or create new one if not exists
        try {
          console.log(`📋 Updating payment history record for Snap confirmation ${bookingCode}`);
          
          // Try to update existing pending payment history first
          const existingPaymentHistory = await tx.paymentHistory.findFirst({
            where: {
              bookingCode: booking.bookingCode,
              status: 'PENDING'
            }
          });

          if (existingPaymentHistory) {
            // Update existing pending record to success
            await tx.paymentHistory.update({
              where: { id: existingPaymentHistory.id },
              data: {
                status: 'SUCCESS',
                transactionDate: new Date(),
                paymentMethod: existingPaymentHistory.paymentMethod || 'MIDTRANS_SNAP',
                paymentUrl: null, // Clear payment URL after successful payment
              }
            });
            console.log(`✅ Updated existing payment history record to SUCCESS`);
          } else {
            // Create new record if no pending record exists (for backward compatibility)
            await tx.paymentHistory.create({
              data: {
                transactionId: booking.paymentId,
                userId: booking.userId,
                eventId: booking.eventId,
                eventName: accessTier.event?.title || accessTier?.name || 'Event',
                amount: booking.totalAmount, // Already in rupiah
                subtotalAmount: booking.subtotalAmount || null,
                platformFee: booking.platformFee || null,
                taxAmount: booking.taxAmount || null,
                currency: booking.currency,
                status: 'SUCCESS',
                paymentMethod: 'MIDTRANS_SNAP',
                transactionDate: new Date(),
                ticketType: accessTier?.name || 'General Admission',
                imageUrl: accessTier.event?.imageUrl,
                bookingCode: booking.bookingCode,
                paymentUrl: null, // No need for URL after successful payment
              }
            });
            console.log(`✅ Created new payment history record for SUCCESS`);
          }
        } catch (historyError) {
          console.error('❌ Error creating payment history record:', historyError);
          // Don't throw error - payment history is not critical for payment flow
        }
        
        // Send notifications IMMEDIATELY after successful payment confirmation
        try {
          console.log(`📤 IMMEDIATE: Sending payment success notification for confirmed payment to user ${booking.userId}`);
          const notificationService = getNotificationService();
          
          // Enhanced logging for notification debugging
          console.log(`🔍 NOTIFICATION DEBUG:`, {
            userId: booking.userId,
            bookingCode: booking.bookingCode,
            eventName: accessTier?.name || booking.event?.title,
            eventId: booking.eventId,
            ticketCount: tickets.length,
            timestamp: new Date().toISOString()
          });
          
          // Send payment success notification immediately
          console.log(`📤 IMMEDIATE: Attempting payment success notification...`);
          const notifSuccess = await notificationService.sendPaymentSuccess(booking.userId, {
            eventName: accessTier?.name || booking.event?.title || 'Event',
            eventImage: booking.event?.imageUrl,
            bookingCode: booking.bookingCode,
            eventId: booking.eventId,
            amount: booking.totalAmount,
            paymentMethod: 'MIDTRANS_SNAP'
          });
          
          console.log(`📱 IMMEDIATE payment success notification DETAILED result:`, {
            success: notifSuccess,
            userId: booking.userId,
            bookingCode: booking.bookingCode,
            timestamp: new Date().toISOString()
          });

          // Send ticket generated notification immediately  
          console.log(`📤 IMMEDIATE: Attempting ticket generated notification...`);
          const ticketNotifSuccess = await notificationService.sendAccessTicketGenerated(booking.userId, {
            eventName: accessTier.event?.title || 'Event',
            eventImage: accessTier.event?.imageUrl,
            accessId: tickets[0]?.id,
            eventId: booking.eventId,
            ticketCount: tickets.length
          });
          
          console.log(`📱 IMMEDIATE ticket generated notification DETAILED result:`, {
            success: ticketNotifSuccess,
            userId: booking.userId,
            accessId: tickets[0]?.id,
            ticketCount: tickets.length,
            timestamp: new Date().toISOString()
          });
          
          // Mark that notifications were sent immediately to avoid duplicates from webhook
          console.log(`✅ IMMEDIATE notifications processing completed for payment ${booking.bookingCode}`);
          console.log(`📊 NOTIFICATION SUMMARY:`, {
            paymentNotification: notifSuccess ? 'SUCCESS' : 'FAILED',
            ticketNotification: ticketNotifSuccess ? 'SUCCESS' : 'FAILED',
            webhookWillSkip: notifSuccess && ticketNotifSuccess
          });
          
        } catch (notifError) {
          console.error(`❌ CRITICAL: IMMEDIATE payment confirmation notifications FAILED:`, {
            error: notifError.message || notifError,
            stack: notifError.stack,
            userId: booking.userId,
            bookingCode: booking.bookingCode,
            timestamp: new Date().toISOString()
          });
          // Don't throw error - notifications are not critical for payment flow
          console.log(`⚠️ IMMEDIATE notification failed - webhook will attempt to send notifications as backup`);
        }
        
      } catch (ticketError) {
        console.error('❌ Error generating tickets:', ticketError);
        throw new Error(`Failed to generate access tickets: ${ticketError.message}`);
      }

      return {
        updatedBooking,
        tickets,
        alreadyConfirmed: false
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error in confirmBookingPayment:', error);
    throw error;
  }
}

// ❌ DEPRECATED: Confirm guestlist payment (generate access ticket) - HAD PRISMA VALIDATION ERRORS
// This function is kept for reference but should not be used. Use confirmGuestlistPaymentV2 instead.
async function confirmGuestlistPayment(paymentId, userId, snapStatus) {
  try {
    const result = await prisma.$transaction(async (tx) => {
    const guestListEntry = await tx.guestList.findFirst({
      where: { 
        paymentId: paymentId,
        userId: userId
      },
      include: { 
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            startDate: true,
            endDate: true
          }
        }
      }
    });

    if (!guestListEntry) {
      throw new AppError('Guestlist entry not found', 404);
    }

    // Check if already confirmed
    if (guestListEntry.isPaid && guestListEntry.status === 'APPROVED') {
      // Get existing access ticket
      const existingTicket = await tx.access.findFirst({
        where: { 
          userId: userId,
          eventId: guestListEntry.eventId,
          type: 'GUESTLIST'
        }
      });
      
      return {
        updatedGuestList: guestListEntry,
        ticket: existingTicket,
        alreadyConfirmed: true
      };
    }

    // Update guestlist status
    const updatedGuestList = await tx.guestList.update({
      where: { id: guestListEntry.id },
      data: {
        status: 'CONFIRMED',
        isPaid: true,
        paidAt: new Date()
      }
    });

    // Generate access ticket for guestlist
    const ticketCode = await generateTicketCode(null, guestListEntry.id); // No accessTier for guestlist
    const qrCode = generateQRCode();
    
    const ticket = await tx.access.create({
      data: {
        type: 'GUEST_LIST',
        ticketCode,
        qrCode,
        status: 'CONFIRMED',
        price: guestListEntry.platformFee || 0,
        currency: 'IDR',
        venueDetails: `Guestlist access for ${guestListEntry.event?.title}`,
        validUntil: (() => {
          if (guestListEntry.event?.endDate) {
            return new Date(new Date(guestListEntry.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
          } else if (guestListEntry.event?.startDate) {
            return new Date(new Date(guestListEntry.event.startDate).getTime() + 24 * 60 * 60 * 1000);
          } else {
            return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          }
        })(),
        userId: userId,
        eventId: guestListEntry.eventId,
        accessTierId: null, // ✅ GUESTLIST: No access tier (special access)
        bookingId: null,    // Not a booking
      },
    });

    console.log(`✅ Generated guestlist access ticket for payment ${paymentId}`);

    // Send notifications immediately (same pattern as booking)
    try {
      const notificationService = getNotificationService();
      
      // Payment success notification
      await notificationService.sendPaymentSuccess(userId, {
        eventName: guestListEntry.event?.title || 'Event',
        eventImage: guestListEntry.event?.imageUrl,
        paymentId: paymentId,
        eventId: guestListEntry.eventId,
        paymentType: 'GUESTLIST'
      });

      // Access ready notification
      await notificationService.sendAccessReady(userId, {
        eventName: guestListEntry.event?.title || 'Event',
        ticketCode: ticket.ticketCode,
        eventId: guestListEntry.eventId,
        accessType: 'GUESTLIST'
      });

      console.log(`✅ IMMEDIATE guestlist notifications sent for payment ${paymentId}`);
    } catch (notifError) {
      console.error(`❌ Error sending guestlist notifications:`, notifError);
      // Don't throw - notifications are not critical
    }

    return {
      updatedGuestList,
      ticket,
      alreadyConfirmed: false
    };
  });

  return result;
  } catch (error) {
    console.error('❌ Error in confirmGuestlistPayment:', error);
    throw error;
  }
}

// ✅ HELPER: Confirm guestlist payment (V2 - Fixed version)
async function confirmGuestlistPaymentV2(paymentId, userId, snapStatus) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const guestListEntry = await tx.guestList.findFirst({
        where: { 
          paymentId: paymentId,
          userId: userId
        },
        include: { 
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
              endDate: true
            }
          }
        }
      });

      if (!guestListEntry) {
        throw new AppError('Guestlist entry not found', 404);
      }

      // Check if already confirmed (payment already processed)
      if (guestListEntry.isPaid && guestListEntry.status === 'APPROVED') {
        console.log(`✅ Guestlist payment already confirmed: ${paymentId}`);
        
        // ✅ ENSURE PAYMENT HISTORY IS ALSO UPDATED (in case it was missed before)
        await tx.paymentHistory.updateMany({
          where: { 
            transactionId: paymentId,
            status: { not: 'SUCCESS' }
          },
          data: {
            status: 'SUCCESS',
            transactionDate: new Date()
          }
        });
        
        // Get existing access ticket
        const existingTicket = await tx.access.findFirst({
          where: { 
            userId: userId,
            eventId: guestListEntry.eventId,
            type: 'GUEST_LIST'
          }
        });
        
        return {
          updatedGuestList: guestListEntry,
          ticket: existingTicket,
          alreadyConfirmed: true
        };
      }

      // Update guestlist payment status (payment confirms guestlist approval)
      const updatedGuestList = await tx.guestList.update({
        where: { id: guestListEntry.id },
        data: {
          status: 'APPROVED', // Payment confirmation automatically approves guestlist
          isPaid: true,
          paidAt: new Date(),
          approvedAt: new Date(),
          approvedBy: 'PAYMENT_CONFIRMED'
        }
      });

      console.log(`✅ Updated guestlist status to APPROVED (payment confirmed) for ${paymentId}`);

      // Generate access ticket for guestlist using V2 functions
      const ticketCode = await generateTicketCodeV2(null, guestListEntry.id);
      const qrCode = generateQRCodeV2();
      
      console.log(`✅ Generated ticket codes for guestlist ${paymentId}: ${ticketCode}`);
      
      const ticket = await tx.access.create({
        data: {
          type: 'GUEST_LIST',
          ticketCode,
          qrCode,
          status: 'CONFIRMED',
          price: guestListEntry.platformFee || 0,
          currency: 'IDR',
          venueDetails: `Guestlist access for ${guestListEntry.event?.title}`,
          validUntil: (() => {
            if (guestListEntry.event?.endDate) {
              return new Date(new Date(guestListEntry.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
            } else if (guestListEntry.event?.startDate) {
              return new Date(new Date(guestListEntry.event.startDate).getTime() + 24 * 60 * 60 * 1000);
            } else {
              return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            }
          })(),
          userId: userId,
          eventId: guestListEntry.eventId,
          accessTierId: null, // No access tier for guestlist
          bookingId: null,    // Not a booking
        },
      });

      console.log(`✅ Generated guestlist access ticket for payment ${paymentId}`);

      // ✅ UPDATE PAYMENT HISTORY STATUS TO SUCCESS
      await tx.paymentHistory.update({
        where: { transactionId: paymentId },
        data: {
          status: 'SUCCESS',
          transactionDate: new Date()
        }
      });

      console.log(`✅ Updated payment history status to SUCCESS for ${paymentId}`);

      // Send notifications immediately
      try {
        const notificationService = getNotificationService();
        
        // Payment success notification
        await notificationService.sendPaymentSuccess(userId, {
          eventName: guestListEntry.event?.title || 'Event',
          eventImage: guestListEntry.event?.imageUrl,
          paymentId: paymentId,
          eventId: guestListEntry.eventId,
          paymentType: 'GUESTLIST'
        });

        // Access ready notification
        await notificationService.sendAccessReady(userId, {
          eventName: guestListEntry.event?.title || 'Event',
          ticketCode: ticket.ticketCode,
          eventId: guestListEntry.eventId,
          accessType: 'GUESTLIST'
        });

        console.log(`✅ IMMEDIATE guestlist notifications sent for payment ${paymentId}`);
      } catch (notifError) {
        console.error(`❌ Error sending guestlist notifications:`, notifError);
        // Don't throw - notifications are not critical
      }

      return {
        updatedGuestList,
        ticket,
        alreadyConfirmed: false
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error in confirmGuestlistPaymentV2:', {
      error: error.message,
      stack: error.stack,
      meta: error.meta,
      code: error.code,
      paymentId,
      userId
    });
    throw error;
  }
}

// ✅ HELPER: Generate ticket code (V2 - Simplified)
async function generateTicketCodeV2(accessTierId, sequence) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  
  const formattedCode = code.match(/.{1,4}/g).join('-');
  
  // Check uniqueness
  const existingTicket = await prisma.access.findFirst({
    where: { ticketCode: formattedCode }
  });
  
  if (existingTicket) {
    // Retry once
    return await generateTicketCodeV2(accessTierId, sequence);
  }
  
  return formattedCode;
}

// ✅ HELPER: Generate QR code (V2)
function generateQRCodeV2() {
  return crypto.randomBytes(32).toString('hex').toUpperCase();
}

// @route   POST /api/bookings/:bookingCode/cancel
// @desc    Cancel pending booking and release stock
// @access  Private
router.post('/:bookingCode/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;
  
  console.log(`🚫 Cancelling booking: ${bookingCode} for user: ${req.user.id}`);
  
  try {
    // Start transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Get booking with related data
      const booking = await tx.booking.findUnique({
        where: { bookingCode },
        include: {
          accessTier: true,
          event: {
            select: {
              title: true,
              imageUrl: true
            }
          }
        }
      });
      
      if (!booking) {
        throw new AppError('Booking not found', 404);
      }
      
      // Verify user owns the booking
      if (booking.userId !== req.user.id) {
        throw new AppError('Access denied', 403);
      }
      
      // Check if booking can be cancelled (only pending bookings)
      if (booking.status !== 'PENDING') {
        throw new AppError(`Cannot cancel booking with status: ${booking.status}`, 400);
      }
      
      if (booking.paymentStatus === 'SUCCESS') {
        throw new AppError('Cannot cancel a successful payment', 400);
      }
      
      // Update booking status to CANCELLED
      const cancelledBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED'
        }
      });
      
      // Release reserved stock back to the access tier
      await tx.accessTier.update({
        where: { id: booking.accessTierId },
        data: {
          soldQuantity: { decrement: booking.quantity },
          availableQuantity: { increment: booking.quantity }
        }
      });
      
      console.log(`♻️  Released ${booking.quantity} tickets back to stock for booking ${bookingCode}`);
      
      // Update payment history record to CANCELLED
      try {
        const existingPaymentHistory = await tx.paymentHistory.findFirst({
          where: {
            bookingCode: booking.bookingCode,
            status: 'PENDING'
          }
        });

        if (existingPaymentHistory) {
          await tx.paymentHistory.update({
            where: { id: existingPaymentHistory.id },
            data: {
              status: 'CANCELLED',
              transactionDate: new Date()
            }
          });
          console.log(`✅ Updated payment history record to CANCELLED`);
        }
      } catch (historyError) {
        console.error('❌ Error updating payment history:', historyError);
        // Don't fail the cancellation if history update fails
      }
      
      return { booking: cancelledBooking };
    });
    
    // Send cancellation notification
    try {
      console.log(`📤 Sending booking cancellation notification to user ${req.user.id}`);
      const notificationService = getNotificationService();
    await notificationService.sendToUser(req.user.id, {
        title: 'Payment Cancelled',
        body: `Your booking for ${result.booking.event?.title || 'the event'} has been cancelled. Stock has been released.`,
        data: {
          type: 'BOOKING_CANCELLED',
          bookingCode: result.booking.bookingCode,
          eventName: result.booking.event?.title || 'Event',
          amount: result.booking.totalAmount,
          currency: result.booking.currency || 'IDR'
        }
      });
      console.log(`📱 Cancellation notification sent successfully`);
    } catch (notifError) {
      console.error('❌ Error sending cancellation notification:', notifError);
      // Don't fail the cancellation if notification fails
    }
    
    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        bookingCode: result.booking.bookingCode,
        status: result.booking.status,
        paymentStatus: result.booking.paymentStatus,
        refundInfo: 'Stock has been released. No charges will apply.'
      }
    });
    
  } catch (error) {
    console.error('❌ Error cancelling booking:', error);
    throw error;
  }
}));

// @route   POST /api/bookings/:bookingCode/quick-verify
// @desc    Quick manual verification for stuck payments (simplified version)
// @access  Private
router.post('/:bookingCode/quick-verify', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;

  console.log(`⚡ Quick verification requested for ${bookingCode} by user ${req.user.id}`);

  // Get booking with minimal data needed
  const booking = await prisma.booking.findFirst({
    where: { 
      bookingCode,
      userId: req.user.id,
      paymentStatus: 'PENDING' // Only verify pending payments
    },
    select: {
      id: true,
      paymentId: true,
      totalAmount: true,
      status: true,
      paymentStatus: true
    }
  });

  if (!booking) {
    throw new AppError('Booking not found or already processed', 404);
  }

  if (!booking.paymentId) {
    throw new AppError('No payment ID found for this booking', 400);
  }

  try {
    // ✅ FIX: Use paymentId instead of bookingCode for Midtrans lookup
    const PaymentVerificationService = require('../services/core/PaymentVerificationService');
    const verificationService = new PaymentVerificationService();
    const paymentIdToCheck = booking.paymentId || bookingCode;
    
    console.log(`🔍 Quick verify: Checking Midtrans with paymentId: ${paymentIdToCheck}`);
    const midtransStatus = await verificationService.checkPaymentStatusViaAPI(paymentIdToCheck);
    
    console.log(`⚡ Quick verification result for ${bookingCode}:`, midtransStatus);
    
    const isSuccessful = midtransStatus?.transaction_status === 'settlement' ||
                        midtransStatus?.transaction_status === 'capture';
    
    if (isSuccessful) {
      // Update booking to SUCCESS
      const updatedBooking = await prisma.booking.update({
        where: { bookingCode },
        data: {
          paymentStatus: 'SUCCESS',
          status: 'CONFIRMED',
          paidAt: new Date()
        }
      });
      
      console.log(`✅ Quick verification successful! Updated ${bookingCode} to SUCCESS`);
      
      res.json({
        success: true,
        message: 'Payment verified and updated successfully!',
        data: {
          bookingCode,
          paymentStatus: 'SUCCESS',
          status: 'CONFIRMED',
          wasStuck: true,
          fixedByQuickVerify: true,
          midtransStatus: midtransStatus?.transaction_status
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Payment not yet completed at Midtrans',
        data: {
          bookingCode,
          paymentStatus: 'PENDING',
          midtransStatus: midtransStatus?.transaction_status,
          needsUserAction: true,
          message: 'Please complete payment in the payment app'
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Quick verification failed for ${bookingCode}:`, error);
    throw new AppError('Verification failed. Please try again later.', 500);
  }
}));

// @route   POST /api/bookings/:bookingCode/verify-payment
// @desc    Manual payment verification (backup for missed webhooks)
// @access  Private
router.post('/:bookingCode/verify-payment', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;

  console.log(`🔍 Manual payment verification requested for booking: ${bookingCode} by user: ${req.user.id}`);

  // Import the service here to avoid circular dependency issues
  const PaymentService = require('../services/core/PaymentService');

  // Check if user owns this booking
  const booking = await prisma.booking.findFirst({
    where: { 
      bookingCode,
      userId: req.user.id 
    }
  });

  if (!booking) {
    throw new AppError('Booking not found or you do not have access to it', 404);
  }

  // Prevent abuse - limit verification attempts
  const recentVerifications = await prisma.paymentHistory.count({
    where: {
      bookingCode,
      paymentMethod: 'MIDTRANS_API_VERIFIED',
      createdAt: {
        gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
      }
    }
  });

  if (recentVerifications > 2) {
    throw new AppError('Too many verification attempts. Please wait before trying again.', 429);
  }

  try {
    const paymentService = new PaymentService();
    const result = await paymentService.verifyPendingPayments(1, bookingCode);

    if (result.alreadySuccessful) {
      // ✅ ENTERPRISE: Use standardized response format
      return res.json(successResponse(
        'Payment was already verified as successful',
        {
          booking: result.booking,
          alreadyVerified: true
        }
      ));
    }

    if (result.successful && result.statusChanged) {
      // Send payment success notification
      try {
        const notificationService = getNotificationService();
    await notificationService.sendPaymentSuccess(booking.userId, {
          eventName: booking.accessTier?.name || result.booking.event?.title || 'Event',
          eventImage: result.booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId
        });
      } catch (notifError) {
        console.error('❌ Error sending payment success notification:', notifError);
      }

      // ✅ ENTERPRISE: Use standardized response format
      return res.json(successResponse(
        'Payment verified and confirmed successfully! Your tickets have been generated.',
        {
          booking: result.booking,
          ticketsGenerated: result.generatedTickets?.length || 0,
          paymentVerified: true
        }
      ));
    } else {
      // ✅ ENTERPRISE: Use standardized error response format
      return res.json(errorResponse(
        'Payment verification failed. The payment may not be completed yet.',
        [{
          code: 'PAYMENT_NOT_COMPLETED',
          message: 'Payment status indicates transaction is not completed'
        }],
        {
          booking: result.booking,
          paymentStatus: result.paymentStatus,
          paymentVerified: false
        }
      ));
    }
  } catch (error) {
    console.error(`❌ Manual payment verification failed for ${bookingCode}:`, error);
    throw new AppError(`Payment verification failed: ${error.message}`, 500);
  }
}));

// @route   POST /api/bookings/admin/recover-payments
// @desc    Admin endpoint to recover missed payments (batch)
// @access  Private (Admin only)
router.post('/admin/recover-payments', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin role required.', 403);
  }

  console.log(`🔄 Admin payment recovery initiated by: ${req.user.username}`);

  const PaymentService = require('../services/core/PaymentService');

  try {
    const recoveryResults = await PaymentVerificationService.recoverMissedPayments();
    
    const recoveredCount = recoveryResults.filter(r => r.recovered).length;
    const totalChecked = recoveryResults.length;

    res.json({
      success: true,
      message: `Payment recovery completed: ${recoveredCount}/${totalChecked} payments recovered`,
      data: {
        totalChecked,
        recoveredCount,
        results: recoveryResults
      }
    });
  } catch (error) {
    console.error('❌ Admin payment recovery failed:', error);
    throw new AppError(`Payment recovery failed: ${error.message}`, 500);
  }
}));

// @route   GET /api/bookings/:bookingCode/payment-details
// @desc    Get comprehensive payment details including Midtrans status
// @access  Private
router.get('/:bookingCode/payment-details', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;

  // Check if user owns this booking
  const booking = await prisma.booking.findFirst({
    where: { 
      bookingCode,
      userId: req.user.id 
    },
    include: {
      accessTier: {
        select: { name: true, price: true }
      },
      event: {
        select: { title: true, imageUrl: true }
      }
    }
  });

  if (!booking) {
    throw new AppError('Booking not found or you do not have access to it', 404);
  }

  let midtransStatus = null;
  
  // If payment is still pending, check current status from Midtrans
  if (booking.paymentStatus !== 'SUCCESS') {
    try {
      const PaymentService = require('../services/core/PaymentService');
      midtransStatus = await PaymentVerificationService.checkPaymentStatusViaAPI(bookingCode);
      
      // Check if payment is now successful but our system missed it
      const isNowSuccessful = PaymentVerificationService.isPaymentSuccessful(
        midtransStatus.transaction_status,
        midtransStatus.fraud_status,
        true
      );

      if (isNowSuccessful && booking.paymentStatus !== 'SUCCESS') {
        midtransStatus._systemMissedPayment = true;
        midtransStatus._suggestVerification = true;
      }
    } catch (error) {
      console.error(`❌ Error checking Midtrans status for ${bookingCode}:`, error);
      midtransStatus = { error: 'Unable to check payment status' };
    }
  }

  // ✅ ENTERPRISE: Use standardized response format
  res.json(successResponse(
    'Payment details retrieved successfully',
    {
      booking: {
        id: booking.id,
        bookingCode: booking.bookingCode,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        totalAmount: booking.totalAmount,
        quantity: booking.quantity,
        createdAt: booking.createdAt,
        paidAt: booking.paidAt,
        accessTier: booking.accessTier,
        event: booking.event
      },
      midtransStatus,
      needsVerification: midtransStatus?._suggestVerification || false
    }
  ));
}));

// @route   POST /api/bookings/guestlist/:orderId/verify-payment
// @desc    Manual guestlist payment verification
// @access  Private
router.post('/guestlist/:orderId/verify-payment', authMiddleware, asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  console.log(`🎫 Manual guestlist payment verification requested for: ${orderId} by user: ${req.user.id}`);

  // Import the service here to avoid circular dependency issues
  const PaymentService = require('../services/core/PaymentService');

  // Check if user owns this guestlist entry
  const guestListEntry = await prisma.guestList.findFirst({
    where: { 
      paymentId: orderId,
      userId: req.user.id 
    }
  });

  if (!guestListEntry) {
    throw new AppError('Guestlist entry not found or you do not have access to it', 404);
  }

  // ✅ SECURITY FIX: Prevent abuse - limit verification attempts (increased limit)
  const recentVerifications = await prisma.paymentHistory.count({
    where: {
      userId: req.user.id,
      eventId: guestListEntry.eventId,
      ticketType: 'Guestlist Access',
      paymentMethod: 'MIDTRANS_API_VERIFIED',
      createdAt: {
        gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
      }
    }
  });

  if (recentVerifications > 5) {
    throw new AppError('Too many verification attempts. Please wait 5 minutes before trying again.', 429);
  }

  try {
    const result = await PaymentVerificationService.verifyGuestlistPaymentStatus(orderId);

    if (result.alreadyPaid) {
      return res.json({
        success: true,
        message: 'Guestlist payment was already verified as successful',
        data: {
          guestListEntry: result.guestListEntry,
          alreadyVerified: true
        }
      });
    }

    if (result.successful && result.statusChanged) {
      // Send guestlist payment success notification
      try {
        const notificationService = getNotificationService();
        await notificationService.sendToUser(guestListEntry.userId, {
          type: 'GUESTLIST_PAYMENT_SUCCESS',
          title: '🎉 Guestlist Payment Successful!',
          body: `Your guestlist access for "${result.guestListEntry.event?.title}" is confirmed. Your ticket is ready!`,
          imageUrl: result.guestListEntry.event?.imageUrl,
          actionData: {
            eventId: guestListEntry.eventId,
            guestListId: guestListEntry.id,
            action: 'VIEW_TICKET'
          }
        });
      } catch (notifError) {
        console.error('❌ Error sending guestlist payment success notification:', notifError);
      }

      return res.json({
        success: true,
        message: 'Guestlist payment verified and confirmed successfully! Your ticket has been generated.',
        data: {
          guestListEntry: result.guestListEntry,
          ticketGenerated: result.generatedTicket ? 1 : 0,
          paymentVerified: true
        }
      });
    } else {
      return res.json({
        success: false,
        message: result.reason || 'Guestlist payment verification failed. The payment may not be completed yet.',
        data: {
          guestListEntry: result.guestListEntry,
          paymentStatus: result.paymentStatus,
          paymentVerified: false
        }
      });
    }
  } catch (error) {
    console.error(`❌ Manual guestlist payment verification failed for ${orderId}:`, error);
    throw new AppError(`Guestlist payment verification failed: ${error.message}`, 500);
  }
}));

// @route   POST /api/bookings/:bookingCode/emergency-fix  
// @desc    EMERGENCY FIX for stuck payments
// @access  Private
router.post('/:bookingCode/emergency-fix', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;
  
  console.log(`🚨 EMERGENCY FIX requested for ${bookingCode} by user ${req.user.id}`);
  
  try {
    // 1. Check current booking status
    const booking = await prisma.booking.findFirst({
      where: { 
        bookingCode,
        userId: req.user.id 
      },
      include: {
        user: { select: { id: true, email: true, fcmTokens: true } },
        event: { select: { title: true, imageUrl: true } }
      }
    });
    
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }
    
    console.log(`🔍 EMERGENCY: Current booking status:`, {
      bookingCode,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      userFCMTokens: booking.user.fcmTokens?.length || 0
    });
    
    // 2. Force check Midtrans API
    let midtransStatus = null;
    try {
      const PaymentVerificationService = require('../services/core/PaymentVerificationService');
      midtransStatus = await PaymentVerificationService.checkPaymentStatusViaAPI(bookingCode);
      console.log(`🔍 EMERGENCY: Midtrans API status:`, midtransStatus);
    } catch (midtransError) {
      console.error(`❌ EMERGENCY: Midtrans check failed:`, midtransError.message);
    }
    
    // 3. Check if payment is actually successful at Midtrans  
    // ✅ FIXED: Midtrans uses 'capture' and 'settlement' as success status, NOT 'success'
    const isSuccessful = midtransStatus?.transaction_status === 'settlement' ||
                        midtransStatus?.transaction_status === 'capture';
    
    console.log(`🔍 EMERGENCY: Payment analysis:`, {
      midtransStatus: midtransStatus?.transaction_status,
      isSuccessfulAtMidtrans: isSuccessful,
      currentPaymentStatus: booking.paymentStatus
    });
    
    // 4. If successful at Midtrans but pending in DB, force update
    if (isSuccessful && booking.paymentStatus !== 'SUCCESS') {
      console.log(`✅ EMERGENCY: Force updating ${bookingCode} to SUCCESS`);
      
      await prisma.booking.update({
        where: { bookingCode },
        data: {
          paymentStatus: 'SUCCESS',
          status: 'CONFIRMED', 
          paidAt: new Date()
        }
      });
      
      // Force send push notification  
      try {
        const NotificationService = require('../services/core/NotificationService');
        const notificationService = getNotificationService();
        
        console.log(`📱 EMERGENCY: Sending push notification to user ${booking.user.id}`);
        
        await notificationService.sendPaymentSuccess(booking.user.id, {
          eventName: booking.event?.title || 'Event',
          eventImage: booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId,
          amount: booking.totalAmount
        });
        
        console.log(`✅ EMERGENCY: Push notification sent`);
      } catch (notifError) {
        console.error(`❌ EMERGENCY: Push notification failed:`, notifError);
      }
      
      res.json({
        success: true,
        message: '🚨 EMERGENCY FIX APPLIED! Payment status updated to SUCCESS',
        data: {
          bookingCode,
          oldStatus: booking.paymentStatus,
          newStatus: 'SUCCESS',
          midtransStatus: midtransStatus?.transaction_status,
          fixedByEmergency: true,
          pushNotificationSent: true
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Payment not successful at Midtrans or already updated',
        data: {
          bookingCode,
          currentStatus: booking.paymentStatus,
          midtransStatus: midtransStatus?.transaction_status,
          needsUserAction: !isSuccessful
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ EMERGENCY FIX failed for ${bookingCode}:`, error);
    throw error;
  }
}));

// @route   POST /api/bookings/:bookingCode/debug-notification
// @desc    Debug notification sending for a specific booking
// @access  Private
router.post('/:bookingCode/debug-notification', authMiddleware, asyncHandler(async (req, res) => {
  const { bookingCode } = req.params;
  
  console.log(`🐛 DEBUG: Manual notification test for ${bookingCode} by user ${req.user.id}`);
  
  try {
    // Get booking details
    const booking = await prisma.booking.findFirst({
      where: { 
        bookingCode,
        userId: req.user.id 
      },
      include: {
        user: { 
          select: { 
            id: true, 
            email: true, 
            fcmTokens: true,
            firstName: true,
            lastName: true 
          } 
        },
        event: { 
          select: { 
            id: true,
            title: true, 
            imageUrl: true 
          } 
        },
        accessTier: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
    
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }
    
    console.log(`🔍 DEBUG: Booking details:`, {
      bookingCode,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      userId: booking.userId,
      userFCMTokens: booking.user.fcmTokens?.length || 0,
      eventName: booking.event?.title || booking.accessTier?.name
    });
    
    // Test notification sending
    const { getNotificationService } = require('../services/core');
    const notificationService = getNotificationService();
    
    console.log(`📤 DEBUG: Attempting to send test payment success notification...`);
    
    const testResult = await notificationService.sendPaymentSuccess(booking.userId, {
      eventName: booking.event?.title || booking.accessTier?.name || 'Test Event',
      eventImage: booking.event?.imageUrl,
      bookingCode: booking.bookingCode,
      eventId: booking.eventId,
      amount: booking.totalAmount,
      paymentMethod: 'DEBUG_TEST'
    });
    
    console.log(`📱 DEBUG: Test notification result:`, testResult);
    
    res.json({
      success: true,
      message: 'Debug notification test completed',
      data: {
        bookingCode,
        userId: booking.userId,
        userHasFCMTokens: (booking.user.fcmTokens?.length || 0) > 0,
        fcmTokenCount: booking.user.fcmTokens?.length || 0,
        notificationResult: testResult,
        bookingStatus: booking.status,
        paymentStatus: booking.paymentStatus,
        eventName: booking.event?.title || booking.accessTier?.name,
        debugTimestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error(`❌ DEBUG: Notification test failed for ${bookingCode}:`, error);
    throw error;
  }
}));

module.exports = router;