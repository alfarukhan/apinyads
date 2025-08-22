const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, requireRole, optionalAuth } = require('../middleware/auth');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized validation schemas
const { accessTierCreateSchema, accessTierUpdateSchema } = require('../lib/validation-schemas');

// ✅ ENTERPRISE: Use centralized user selectors
const { organizerSelect } = require('../lib/user-selectors');

// ✅ ENTERPRISE: Use centralized authorization utilities
const { requireEventOwnershipOrAdmin, requireAccessTierPermission, requireExists } = require('../lib/auth-utils');

// ✅ PRODUCTION: Enterprise caching for access tiers (critical for booking performance)
const { 
  accessTierCaching, 
  cacheInvalidation 
} = require('../middleware/enterprise-caching');

const router = express.Router();

// ✅ REMOVED: Validation schemas moved to centralized lib/validation-schemas.js

// @route   GET /api/access-tiers/event/:eventId
// @desc    Get all access tiers for an event
// @access  Public (for viewing) / Private (for full data)
router.get('/event/:eventId', 
  optionalAuth, 
  accessTierCaching.byEvent, // ✅ CACHE: Critical caching for booking performance
  asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const { includeStats = false } = req.query;

  // Check if event exists (temporarily bypass isActive filter for debug)
  const event = await prisma.event.findUnique({
    where: { id: eventId }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  console.log(`🎫 Fetching access tiers for event: ${eventId}`);
  
  const accessTiers = await prisma.accessTier.findMany({
    where: { 
      eventId,
      isActive: true
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      maxQuantity: true,
      soldQuantity: true,
      availableQuantity: true,
      benefits: true,
      saleStartDate: true,
      saleEndDate: true,
      sortOrder: true,
      createdAt: true,
      ...(includeStats && {
        _count: {
          select: {
            accessTickets: true,
            bookings: true
          }
        }
      })
    }
  });

  console.log(`🎫 Found ${accessTiers.length} access tiers for event ${eventId}`);

  // Get user quota information if authenticated
  let userQuota = null;
  if (req.user) {
    // Debug: Check all user's access tickets for this event
    const allUserAccess = await prisma.access.findMany({
      where: {
        userId: req.user.id,
        eventId
      },
      select: {
        id: true,
        status: true,
        ticketCode: true,
        createdAt: true
      }
    });

    console.log(`🔍 Debug - All access for user ${req.user.id} in event ${eventId}:`, 
      allUserAccess.map(a => `${a.ticketCode} (${a.status})`)
    );

    // Count CONFIRMED access tickets (fully processed)
    const confirmedAccessCount = await prisma.access.count({
      where: {
        userId: req.user.id,
        eventId,
        status: 'CONFIRMED'
      }
    });

    // Count PENDING bookings (payment in progress) to prevent overselling
    const pendingBookingsCount = await prisma.booking.aggregate({
      where: {
        userId: req.user.id,
        accessTier: { eventId },
        status: 'PENDING',
        createdAt: {
          // Only count recent pending bookings (within 1 hour)
          gte: new Date(Date.now() - 60 * 60 * 1000)
        }
      },
      _sum: { quantity: true }
    });

    const pendingQuantity = pendingBookingsCount._sum.quantity || 0;
    const totalUsed = confirmedAccessCount + pendingQuantity;
    
    const maxAccessPerEvent = 4;
    userQuota = {
      used: confirmedAccessCount, // Show only confirmed tickets to user
      remaining: Math.max(0, maxAccessPerEvent - totalUsed), // But limit by total including pending
      maximum: maxAccessPerEvent,
      canPurchase: totalUsed < maxAccessPerEvent, // Prevent booking if total exceeds limit
      pendingBookings: pendingQuantity // Show pending count for debugging
    };
    
    console.log(`👤 User ${req.user.id} quota for event ${eventId}: ${confirmedAccessCount}+${pendingQuantity}=${totalUsed}/${maxAccessPerEvent} (${allUserAccess.length} total tickets)`);
  }

  // Calculate availability and status for each tier
  const tiersWithStatus = accessTiers.map(tier => {
    const now = new Date();
    const available = tier.maxQuantity - tier.soldQuantity;
    
    let saleStatus = 'active';
    if (tier.saleStartDate && now < tier.saleStartDate) {
      saleStatus = 'not_started';
    } else if (tier.saleEndDate && now > tier.saleEndDate) {
      saleStatus = 'ended';
    } else if (available <= 0) {
      saleStatus = 'sold_out';
    }

    const isAvailable = saleStatus === 'active' && available > 0;
    const isOnSale = isAvailable && tier.isActive;

    return {
      ...tier,
      availableQuantity: available,
      saleStatus,
      isAvailable,
      isOnSale, // Added for frontend compatibility
      // Add price display helpers
      displayPrice: tier.price > 0 
        ? tier.price >= 100000 
          ? `IDR ${Math.round(tier.price / 100000)}K`
          : `IDR ${Math.round(tier.price / 100)}`
        : 'Free',
      isFree: tier.price === 0
    };
  });

  res.json({
    success: true,
    data: {
      accessTiers: tiersWithStatus,
      userQuota
    }
  });
}));

// @route   POST /api/access-tiers/event/:eventId
// @desc    Create access tier for event
// @access  Private (Event Organizer or Admin)
router.post('/event/:eventId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const { error, value } = accessTierCreateSchema.validate(req.body);
  
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // Check if event exists and user has permission
  const event = await prisma.event.findUnique({
    where: { id: eventId }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  // Check if tier name is unique for this event
  const existingTier = await prisma.accessTier.findFirst({
    where: {
      eventId,
      name: value.name,
      isActive: true
    }
  });

  if (existingTier) {
    throw new AppError('Access tier with this name already exists for this event', 400);
  }

  // Validate sale dates
  if (value.saleStartDate && value.saleEndDate && value.saleStartDate >= value.saleEndDate) {
    throw new AppError('Sale start date must be before sale end date', 400);
  }

  const accessTier = await prisma.accessTier.create({
    data: {
      ...value,
      eventId,
      availableQuantity: value.maxQuantity // Initial available quantity equals max
    }
  });

  // ✅ CACHE: Invalidate related caches after tier creation
  await cacheInvalidation.invalidateEvent(eventId);
  
  res.status(201).json({
    success: true,
    message: 'Access tier created successfully',
    data: accessTier
  });
}));

// @route   PUT /api/access-tiers/:tierId
// @desc    Update access tier
// @access  Private (Event Organizer or Admin)
router.put('/:tierId', authMiddleware, asyncHandler(async (req, res) => {
  const { tierId } = req.params;
  const { error, value } = accessTierUpdateSchema.validate(req.body);
  
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // Check if tier exists and user has permission
  const tier = await prisma.accessTier.findUnique({
    where: { id: tierId },
    include: { event: true }
  });

  if (!tier) {
    throw new AppError('Access tier not found', 404);
  }

  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  // Check if reducing maxQuantity would create negative available quantity
  if (value.maxQuantity && value.maxQuantity < tier.soldQuantity) {
    throw new AppError(`Cannot reduce max quantity below sold quantity (${tier.soldQuantity})`, 400);
  }

  // Use optimistic locking to prevent race conditions
  const updatedTier = await prisma.accessTier.update({
    where: { 
      id: tierId,
      version: tier.version // Optimistic locking
    },
    data: {
      ...value,
      ...(value.maxQuantity && {
        availableQuantity: value.maxQuantity - tier.soldQuantity
      }),
      version: { increment: 1 }
    }
  }).catch(error => {
    if (error.code === 'P2025') {
      throw new AppError('Access tier was modified by another user. Please refresh and try again.', 409);
    }
    throw error;
  });

  // ✅ CACHE: Invalidate related caches after tier update
  await cacheInvalidation.invalidateAccessTier(tierId, updatedTier.eventId);
  
  res.json({
    success: true,
    message: 'Access tier updated successfully',
    data: updatedTier
  });
}));

// @route   DELETE /api/access-tiers/:tierId
// @desc    Delete access tier (soft delete)
// @access  Private (Event Organizer or Admin)
router.delete('/:tierId', authMiddleware, asyncHandler(async (req, res) => {
  const { tierId } = req.params;

  // Check if tier exists and user has permission
  const tier = await prisma.accessTier.findUnique({
    where: { id: tierId },
    include: { 
      event: true,
      _count: {
        select: {
          accessTickets: true,
          bookings: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } }
        }
      }
    }
  });

  if (!tier) {
    throw new AppError('Access tier not found', 404);
  }

  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  // Check if there are active bookings or tickets
  if (tier._count.accessTickets > 0 || tier._count.bookings > 0) {
    throw new AppError('Cannot delete access tier with existing tickets or active bookings', 400);
  }

  // Soft delete
  await prisma.accessTier.update({
    where: { id: tierId },
    data: { isActive: false }
  });

  res.json({
    success: true,
    message: 'Access tier deleted successfully'
  });
}));

// @route   GET /api/access-tiers/:tierId/stats
// @desc    Get detailed statistics for access tier
// @access  Private (Event Organizer or Admin)
router.get('/:tierId/stats', 
  authMiddleware, 
  accessTierCaching.single, // ✅ CACHE: Cache tier stats for performance
  asyncHandler(async (req, res) => {
  const { tierId } = req.params;

  // Check if tier exists and user has permission
  const tier = await prisma.accessTier.findUnique({
    where: { id: tierId },
    include: { event: true }
  });

  if (!tier) {
    throw new AppError('Access tier not found', 404);
  }

  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  // Get detailed statistics
  const [bookingStats, revenueStats, dailySales] = await Promise.all([
    // Booking statistics
    prisma.booking.groupBy({
      by: ['status'],
      where: { accessTierId: tierId },
      _count: { id: true },
      _sum: { totalAmount: true }
    }),
    
    // Revenue statistics
    prisma.accessTier.findUnique({
      where: { id: tierId },
      select: {
        soldQuantity: true,
        maxQuantity: true,
        price: true,
        _count: {
          select: {
            accessTickets: true
          }
        }
      }
    }),
    
    // Daily sales for last 30 days
    prisma.booking.groupBy({
      by: ['createdAt'],
      where: {
        accessTierId: tierId,
        status: 'CONFIRMED',
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      },
      _count: { id: true },
      _sum: { totalAmount: true }
    })
  ]);

  const totalRevenue = tier.soldQuantity * tier.price;
  const conversionRate = bookingStats.reduce((total, stat) => total + stat._count.id, 0);
  const confirmedBookings = bookingStats.find(stat => stat.status === 'CONFIRMED')?._count.id || 0;

  res.json({
    success: true,
    data: {
      tier: {
        id: tier.id,
        name: tier.name,
        price: tier.price,
        maxQuantity: tier.maxQuantity,
        soldQuantity: tier.soldQuantity,
        availableQuantity: tier.maxQuantity - tier.soldQuantity
      },
      revenue: {
        total: totalRevenue,
        perTicket: tier.price
      },
      bookings: {
        total: conversionRate,
        confirmed: confirmedBookings,
        conversionRate: conversionRate > 0 ? (confirmedBookings / conversionRate) * 100 : 0,
        byStatus: bookingStats
      },
      dailySales,
      performance: {
        sellThroughRate: (tier.soldQuantity / tier.maxQuantity) * 100,
        averageDailySales: dailySales.length > 0 ? dailySales.reduce((sum, day) => sum + day._count.id, 0) / 30 : 0
      }
    }
  });
}));

// @route   POST /api/access-tiers/debug-user-quota/:eventId
// @desc    Debug user quota calculation for specific event
// @access  Private
router.get('/debug-user-quota/:eventId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  
  console.log(`🔍 Debug quota for user ${req.user.id} in event ${eventId}`);
  
  // Get all user's access tickets for this event
  const allAccess = await prisma.access.findMany({
    where: {
      userId: req.user.id,
      eventId
    },
    include: {
      booking: {
        select: {
          bookingCode: true,
          status: true,
          paymentStatus: true,
          createdAt: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Count by status
  const statusCounts = {
    CONFIRMED: allAccess.filter(a => a.status === 'CONFIRMED').length,
    PENDING: allAccess.filter(a => a.status === 'PENDING').length,
    CANCELLED: allAccess.filter(a => a.status === 'CANCELLED').length
  };

  // Calculate quota
  const maxAccessPerEvent = 4;
  const userQuota = {
    used: statusCounts.CONFIRMED,
    remaining: Math.max(0, maxAccessPerEvent - statusCounts.CONFIRMED),
    maximum: maxAccessPerEvent,
    canPurchase: statusCounts.CONFIRMED < maxAccessPerEvent
  };

  res.json({
    success: true,
    data: {
      userId: req.user.id,
      eventId,
      quota: userQuota,
      statusCounts,
      tickets: allAccess.map(access => ({
        ticketCode: access.ticketCode,
        status: access.status,
        bookingStatus: access.booking?.status,
        paymentStatus: access.booking?.paymentStatus,
        createdAt: access.createdAt
      }))
    }
  });
}));

// @route   POST /api/access-tiers/fix-ticket-status/:eventId  
// @desc    Fix ticket status for user in specific event
// @access  Private
router.post('/fix-ticket-status/:eventId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  
  console.log(`🛠️ Fixing ticket status for user ${req.user.id} in event ${eventId}`);
  
  const result = await prisma.$transaction(async (tx) => {
    // Find tickets that should be CONFIRMED but are still PENDING
    const pendingTickets = await tx.access.findMany({
      where: {
        userId: req.user.id,
        eventId,
        status: 'PENDING'
      },
      include: {
        booking: true
      }
    });

    console.log(`🔍 Found ${pendingTickets.length} pending tickets`);

    const fixedTickets = [];

    for (const ticket of pendingTickets) {
      // Check if booking is confirmed and payment is successful
      if (ticket.booking?.status === 'CONFIRMED' && 
          ticket.booking?.paymentStatus === 'SUCCESS') {
        
        // Update ticket status to CONFIRMED
        const updatedTicket = await tx.access.update({
          where: { id: ticket.id },
          data: { status: 'CONFIRMED' }
        });

        console.log(`✅ Fixed ticket ${ticket.ticketCode}: PENDING → CONFIRMED`);
        fixedTickets.push({
          ticketCode: ticket.ticketCode,
          oldStatus: 'PENDING',
          newStatus: 'CONFIRMED'
        });
      }
    }

    return fixedTickets;
  });

  res.json({
    success: true,
    message: `Fixed ${result.length} ticket statuses`,
    data: { fixedTickets: result }
  });
}));

module.exports = router;