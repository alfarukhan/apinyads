const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { successResponse } = require('../lib/response-formatters');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// @route   POST /api/booking/calculate
// @desc    Calculate booking amount with all fees (SECURE SERVER-SIDE)
// @access  Private
router.post('/calculate', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId, accessTierId, quantity, bookingType = 'BOOKING' } = req.body;

  // 🛡️ SECURITY: All business logic on server
  console.log(`🔒 SECURE CALCULATION: User ${req.user.id} calculating for event ${eventId}`);

  // Validate inputs
  if (!eventId || !quantity || quantity < 1 || quantity > 100) {
    throw new AppError('Invalid booking parameters', 400);
  }

  // Get event and access tier data
  const [event, accessTier] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        isActive: true,
        startDate: true,
        taxRate: true,
        taxType: true,
        taxName: true,
      }
    }),
    accessTierId ? prisma.accessTier.findUnique({
      where: { id: accessTierId },
      select: {
        id: true,
        name: true,
        price: true,
        maxQuantity: true,
        eventId: true,
      }
    }) : null
  ]);

  if (!event || !event.isActive) {
    throw new AppError('Event not found or inactive', 404);
  }

  if (accessTierId && (!accessTier || accessTier.eventId !== eventId)) {
    throw new AppError('Access tier not found for this event', 404);
  }

  // 🔒 SECURE PRICING CALCULATION (SERVER-SIDE ONLY)
  let unitPrice = 0;
  let subtotalAmount = 0;

  try {
    if (bookingType === 'GUESTLIST') {
      // 🎫 GUESTLIST: Free event access, only platform fee
      console.log(`🎫 GUESTLIST CALCULATION: Event ${eventId}, User ${req.user.id}`);
      
      // Validate guestlist eligibility first
      const guestlistEntry = await prisma.guestList.findUnique({
        where: {
          userId_eventId: {
            userId: req.user.id,
            eventId
          }
        }
      });

      if (!guestlistEntry) {
        throw new AppError('You are not on the guest list for this event', 404);
      }

      if (guestlistEntry.status !== 'APPROVED') {
        throw new AppError('Your guestlist request is not approved yet', 400);
      }

      if (guestlistEntry.isPaid) {
        throw new AppError('You have already paid for this guestlist', 400);
      }

      unitPrice = 0;
      subtotalAmount = 0;
      console.log(`✅ GUESTLIST VALIDATION PASSED: Entry ${guestlistEntry.id}`);
      
    } else if (accessTier) {
      // Regular booking with access tier
      unitPrice = accessTier.price;
      subtotalAmount = unitPrice * quantity;
    } else {
      throw new AppError('Access tier required for booking', 400);
    }
  } catch (error) {
    console.error(`❌ SECURE CALCULATION ERROR: ${error.message}`);
    throw new AppError(`Failed to calculate booking amount: ${error.message}`, 400);
  }

  // 🔒 PLATFORM FEE (SERVER-CONTROLLED)
  const platformFeeConfig = await prisma.platformConfig.findFirst({
    where: { key: 'PLATFORM_FEE' },
    select: { value: true, isActive: true }
  });

  const platformFee = platformFeeConfig?.isActive 
    ? parseInt(platformFeeConfig.value) || 25000 
    : 25000; // Default Rp 25,000

  // 🔒 TAX CALCULATION (SERVER-CONTROLLED)  
  let taxAmount = 0;
  const eventTaxRate = event.taxRate || 0;
  const eventTaxType = event.taxType || 'PERCENTAGE';

  if (eventTaxRate > 0 && subtotalAmount > 0) {
    if (eventTaxType === 'PERCENTAGE') {
      taxAmount = Math.round(subtotalAmount * (eventTaxRate / 100));
    } else if (eventTaxType === 'FIXED') {
      taxAmount = Math.round(eventTaxRate);
    }
  }

  // 🔒 TOTAL CALCULATION (SERVER-CONTROLLED)
  const totalAmount = subtotalAmount + platformFee + taxAmount;

  // 🔒 BUSINESS RULES VALIDATION
  if (bookingType !== 'GUESTLIST' && totalAmount < 1000) {
    throw new AppError('Minimum booking amount is Rp 1,000', 400);
  }

  if (totalAmount > 50000000) {
    throw new AppError('Maximum booking amount is Rp 50,000,000', 400);
  }

  // 🎫 GUESTLIST SPECIFIC VALIDATION
  if (bookingType === 'GUESTLIST') {
    console.log(`🎫 GUESTLIST AMOUNT VALIDATION: Total ${totalAmount} (Platform Fee: ${platformFee})`);
    
    if (totalAmount < platformFee) {
      throw new AppError('Invalid guestlist calculation - platform fee missing', 500);
    }
  }

  // 🔒 CAPACITY CHECK (if access tier specified)
  if (accessTier) {
    const existingBookings = await prisma.booking.aggregate({
      where: {
        accessTierId: accessTier.id,
        status: 'CONFIRMED'
      },
      _sum: { quantity: true }
    });

    const currentBookings = existingBookings._sum.quantity || 0;
    if (currentBookings + quantity > accessTier.maxQuantity) {
      throw new AppError('Not enough capacity available', 400);
    }
  }

  // 🔒 AUDIT LOG
  console.log(`✅ SECURE CALCULATION COMPLETED for ${bookingType}:`, {
    userId: req.user.id,
    eventId,
    accessTierId,
    quantity,
    unitPrice,
    subtotalAmount,
    platformFee,
    taxAmount,
    totalAmount,
    timestamp: new Date().toISOString()
  });

  // Return secure calculation result
  res.json(successResponse('Booking calculation completed', {
    calculation: {
      eventId,
      accessTierId,
      quantity,
      bookingType,
      
      // 🔒 PRICING (SERVER-CALCULATED)
      unitPrice,
      subtotalAmount,
      platformFee,
      taxAmount,
      totalAmount,
      currency: 'IDR',
      
      // Tax details
      taxRate: eventTaxRate,
      taxType: eventTaxType,
      taxName: event.taxName || 'Tax',
      
      // Metadata
      calculatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
    }
  }));
}));

// @route   GET /api/booking/platform-fee
// @desc    Get current platform fee configuration
// @access  Public
router.get('/platform-fee', asyncHandler(async (req, res) => {
  const platformFeeConfig = await prisma.platformConfig.findFirst({
    where: { key: 'PLATFORM_FEE' },
    select: { value: true, isActive: true }
  });

  const amount = platformFeeConfig?.isActive 
    ? parseInt(platformFeeConfig.value) || 25000 
    : 25000;

  res.json(successResponse('Platform fee retrieved', {
    platformFee: {
      amount,
      amountFormatted: `Rp ${amount.toLocaleString('id-ID')}`,
      enabled: platformFeeConfig?.isActive ?? true,
      currency: 'IDR'
    }
  }));
}));

module.exports = router;