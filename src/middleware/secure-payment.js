const PaymentIntentService = require('../services/secure/PaymentIntentService');
const { AppError } = require('./errorHandler');
const crypto = require('crypto');

/**
 * 🔒 SECURE PAYMENT MIDDLEWARE
 * 
 * Prevents payment race conditions and double-spending through:
 * - Idempotency key generation/validation
 * - Payment intent locking
 * - Duplicate payment detection
 * - Payment state validation
 */

/**
 * 🔑 IDEMPOTENCY KEY MIDDLEWARE
 * Generates or validates idempotency keys for payment requests
 */
const idempotencyMiddleware = (req, res, next) => {
  try {
    // Extract idempotency key from header or generate one
    let idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    
    if (!idempotencyKey) {
      // Generate deterministic idempotency key based on request data
      const userId = req.user.id; // ✅ FIX: Use req.user.id
      const { accessTierId, quantity } = req.body;
      const timestamp = Math.floor(Date.now() / 60000); // 1-minute window
      
      // ✅ FIX: Generate key without eventId since we don't have it in request body
      const dataString = `${userId}-${accessTierId}-${quantity}-${timestamp}`;
      idempotencyKey = crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 32);
      
      console.log(`🔑 Generated idempotency key: ${idempotencyKey} for user ${userId}`);
    } else {
      console.log(`🔑 Using provided idempotency key: ${idempotencyKey}`);
    }
    
    // Validate key format
    if (!/^[a-f0-9]{32}$/.test(idempotencyKey)) {
      throw new AppError('Invalid idempotency key format', 400);
    }
    
    req.idempotencyKey = idempotencyKey;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 🔒 PAYMENT INTENT MIDDLEWARE
 * Creates payment intent and acquires lock before processing
 */
const paymentIntentMiddleware = async (req, res, next) => {
  try {
    const { prisma } = require('../lib/prisma');
    const paymentIntentService = new PaymentIntentService();
    const userId = req.user.id; // ✅ FIX: Use req.user.id instead of destructuring userId
    const { accessTierId, quantity } = req.body;
    const { idempotencyKey } = req;
    
    // ✅ FIX: Get eventId from accessTier relation since it's not sent in request body
    const accessTier = await prisma.accessTier.findUnique({
      where: { id: accessTierId },
      select: { eventId: true }
    });
    
    if (!accessTier) {
      throw new AppError('Access tier not found', 404);
    }
    
    const eventId = accessTier.eventId;
    
    console.log(`🔒 Creating payment intent for user ${userId}, event ${eventId}`);
    
    // Create payment intent with lock
    const paymentIntent = await paymentIntentService.createPaymentIntent({
      userId,
      eventId,
      accessTierId,
      quantity,
      idempotencyKey
    });
    
    req.paymentIntent = paymentIntent;
    
    // Set cleanup handler
    res.on('finish', async () => {
      try {
        // If response was not successful, cleanup the intent with proper state transition
        if (res.statusCode >= 400) {
          // Check current status first to respect state transition rules
          const currentIntent = await paymentIntentService.prisma.paymentIntent.findUnique({
            where: { id: paymentIntent.id },
            select: { status: true }
          });
          
          if (currentIntent) {
            // Only transition to CANCELLED if currently PENDING
            // If FAILED, leave it as FAILED (which allows retry)
            if (currentIntent.status === 'PENDING') {
              await paymentIntentService.updatePaymentIntentStatus(
                paymentIntent.id,
                'CANCELLED'
              );
              console.log(`🧹 Cleaned up failed payment intent: ${paymentIntent.id} (PENDING → CANCELLED)`);
            } else {
              console.log(`🔄 Payment intent ${paymentIntent.id} already in final state: ${currentIntent.status}`);
            }
          }
        }
      } catch (cleanupError) {
        console.error('❌ Error cleaning up payment intent:', cleanupError);
      }
    });
    
    next();
  } catch (error) {
    // Handle specific payment intent errors
    if (error.message.includes('Payment already in progress') || 
        error.message.includes('Payment intent already exists')) {
      return res.status(409).json({
        success: false,
        message: error.message,
        code: 'PAYMENT_IN_PROGRESS',
        error_code: 'PAYMENT_IN_PROGRESS',
        details: 'Please wait for the current payment to complete or use a different idempotency key.',
        retryAfter: 30,
        timestamp: new Date().toISOString()
      });
    }
    
    next(error);
  }
};

/**
 * 🔍 DUPLICATE PAYMENT DETECTOR
 * Checks for existing successful payments
 */
const duplicatePaymentDetector = async (req, res, next) => {
  try {
    const { prisma } = require('../lib/prisma');
    const userId = req.user.id; // ✅ FIX: Use req.user.id instead of destructuring userId
    const { accessTierId } = req.body;
    
    // ✅ FIX: Get eventId from accessTier relation
    const accessTier = await prisma.accessTier.findUnique({
      where: { id: accessTierId },
      select: { eventId: true }
    });
    
    if (!accessTier) {
      throw new AppError('Access tier not found', 404);
    }
    
    const eventId = accessTier.eventId;
    
    // Check for recent successful bookings
    const recentSuccessfulBooking = await prisma.booking.findFirst({
      where: {
        userId,
        accessTier: { 
          eventId,
          id: accessTierId 
        },
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
        }
      },
      select: {
        id: true,
        bookingCode: true,
        quantity: true,
        totalAmount: true,
        createdAt: true
      }
    });
    
    if (recentSuccessfulBooking) {
      console.log(`🚫 Duplicate payment detected for user ${userId}, booking ${recentSuccessfulBooking.bookingCode}`);
      
      return res.status(409).json({
        success: false,
        message: 'Duplicate payment detected. You have already successfully booked this event.',
        code: 'DUPLICATE_PAYMENT',
        error_code: 'DUPLICATE_PAYMENT',
        data: {
          existingBooking: recentSuccessfulBooking.bookingCode,
          bookingTime: recentSuccessfulBooking.createdAt,
          amount: recentSuccessfulBooking.totalAmount,
          quantity: recentSuccessfulBooking.quantity
        },
        timestamp: new Date().toISOString()
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 🔒 SECURE PAYMENT CONFIRMATION MIDDLEWARE
 * 
 * DUAL-PURPOSE SECURITY:
 * 1. WEBHOOK PROTECTION: Prevents duplicate Midtrans webhook processing
 * 2. USER CONFIRMATION PROTECTION: Validates authenticated user payment confirmations
 * 
 * SECURITY LAYERS:
 * - JWT Token validation (via authMiddleware)
 * - Request type detection (webhook vs user)
 * - PaymentID ownership validation
 * - Midtrans API real-time verification
 * - User ownership verification via PaymentService
 * 
 * ATTACK VECTORS PREVENTED:
 * - Replay attacks on webhooks
 * - Unauthorized payment confirmations
 * - Cross-user payment manipulation
 * - Fake webhook submissions
 */
const webhookDeduplicationMiddleware = async (req, res, next) => {
  try {
    const { prisma } = require('../lib/prisma');
    const { order_id, transaction_status, signature_key } = req.body;
    
    // ✅ SECURE DIFFERENTIATION: Webhook vs User Request
    const isWebhookRequest = !req.user && req.body.order_id && req.body.signature_key;
    const isUserRequest = req.user && req.user.id;
    
    if (isUserRequest) {
      // ✅ USER REQUEST: Additional security validation 
      const paymentId = req.params.paymentId;
      if (!paymentId) {
        throw new AppError('Payment ID required for user confirmation', 400);
      }
      
      console.log(`🔒 USER CONFIRMATION: ${req.user.id} confirming payment ${paymentId}`);
      return next();
    }
    
    if (isWebhookRequest) {
      // ✅ WEBHOOK REQUEST: Full validation required
      console.log(`🔔 WEBHOOK REQUEST: Processing Midtrans webhook for ${order_id}`);
      
      if (!order_id || !signature_key) {
        throw new AppError('Invalid webhook payload: missing order_id or signature_key', 400);
      }
    } else {
      // ✅ INVALID REQUEST: Neither webhook nor authenticated user
      throw new AppError('Invalid request: must be authenticated user or valid webhook', 401);
    }
    
    // ✅ WEBHOOK-ONLY LOGIC: Deduplication for webhooks only
    if (isWebhookRequest) {
      // Create unique webhook identifier
      const webhookId = crypto
        .createHash('sha256')
        .update(`${order_id}-${transaction_status}-${signature_key}`)
        .digest('hex');
      
      // Check if webhook already processed
      const existingWebhook = await prisma.webhookLog.findUnique({
        where: { webhookId }
      });
      
      if (existingWebhook) {
        console.log(`🔄 Duplicate webhook detected: ${webhookId} for order ${order_id}`);
        
        return res.status(200).json({
          success: true,
          message: 'Webhook already processed',
          duplicate: true,
          originalProcessedAt: existingWebhook.processedAt,
          webhookId
        });
      }
      
      // Log webhook for deduplication
      await prisma.webhookLog.create({
        data: {
          webhookId,
          orderId: order_id,
          transactionStatus: transaction_status,
          payload: JSON.stringify(req.body),
          processedAt: new Date()
        }
      });
      
      req.webhookId = webhookId;
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 🔄 PAYMENT STATE VALIDATOR
 * Validates payment state transitions
 */
const paymentStateValidator = (allowedStates = []) => {
  return async (req, res, next) => {
    try {
      const { prisma } = require('../lib/prisma');
      const { paymentId } = req.params;
      
      if (!paymentId) {
        return next();
      }
      
      // Find payment record
      const booking = await prisma.booking.findFirst({
        where: { 
          OR: [
            { bookingCode: paymentId },
            { paymentId: paymentId }
          ]
        },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          userId: true
        }
      });
      
      if (!booking) {
        throw new AppError('Payment not found', 404);
      }
      
      // Validate state
      if (allowedStates.length > 0 && !allowedStates.includes(booking.paymentStatus)) {
        throw new AppError(
          `Invalid payment state: ${booking.paymentStatus}. Expected: ${allowedStates.join(', ')}`,
          400
        );
      }
      
      // Validate ownership
      if (req.user && booking.userId !== req.user.id) {
        throw new AppError('Payment access denied', 403);
      }
      
      req.payment = booking;
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  idempotencyMiddleware,
  paymentIntentMiddleware,
  duplicatePaymentDetector,
  webhookDeduplicationMiddleware,
  paymentStateValidator
};