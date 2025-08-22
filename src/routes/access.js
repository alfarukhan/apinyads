const express = require('express');
const crypto = require('crypto');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { getNotificationService } = require('../services/core');
const { successResponse, errorResponse } = require('../lib/response-formatters');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const { accessUserSelect, transferUserSelect } = require('../lib/user-selectors');

// ✅ ENTERPRISE: Use centralized authorization utilities
const { requireAccessTicketPermission, requireExists } = require('../lib/auth-utils');

const router = express.Router();


// Generate unique QR code
const generateQRCode = () => {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
};

// @route   GET /api/access
// @desc    Get user's access tickets (auto-hide expired unused access)
// @access  Private
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { status, eventId, includeExpired = 'false' } = req.query;
  const now = new Date();

  let where = {
    userId: req.user.id,
    ...(eventId && { eventId })
  };

  // Enhanced filtering logic
  if (status === 'upcoming') {
    // Upcoming events only
    where.event = { startDate: { gte: now } };
  } else if (status === 'past') {
    // Past events only (but still show used access for history)
    where.event = { startDate: { lt: now } };
    where.isUsed = true; // Only show used access for past events
  } else if (includeExpired !== 'true') {
    // Default: Auto-hide expired unused access
    where.OR = [
      // Show upcoming events (regardless of used status)
      { event: { startDate: { gte: now } } },
      // Show past events only if used (user attended)
      { 
        AND: [
          { event: { startDate: { lt: now } } },
          { isUsed: true }
        ]
      }
    ];
  }

  const accessTickets = await prisma.access.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          location: true,
          startDate: true,
          endDate: true,
          imageUrl: true,
          organizer: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            }
          }
        }
      }
    }
  });

  // Add status indicators for frontend
  const enhancedTickets = accessTickets.map(ticket => {
    const eventStarted = ticket.event.startDate < now;
    const eventEnded = ticket.event.endDate ? ticket.event.endDate < now : eventStarted;
    
    return {
      ...ticket,
      eventStatus: eventStarted ? (eventEnded ? 'completed' : 'ongoing') : 'upcoming',
      accessStatus: ticket.isUsed ? 'used' : (eventEnded ? 'expired' : 'valid')
    };
  });

  // ✅ ENTERPRISE: Use standardized response format with timestamp localization
  const { localizeTimestamps } = require('../utils/time-helpers');
  
  const responseData = { 
    accessTickets: enhancedTickets,
    meta: {
      total: enhancedTickets.length,
      hiddenExpired: includeExpired !== 'true'
    }
  };
  
  // ✅ Apply timestamp localization to convert all dates to strings
  const localizedResponse = localizeTimestamps(responseData);
  
  res.json(successResponse(
    'Access tickets retrieved successfully',
    localizedResponse
  ));
}));

// @route   GET /api/access/:id
// @desc    Get single access ticket with QR code
// @access  Private
router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const accessTicket = await prisma.access.findFirst({
    where: { 
      id, 
      userId: req.user.id 
    },
    include: {
      event: {
        include: {
          organizer: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
            }
          }
        }
      }
    }
  });

  if (!accessTicket) {
    throw new AppError('Access ticket not found', 404);
  }

  // ✅ ENTERPRISE: Use standardized response format with timestamp localization  
  const { localizeTimestamps } = require('../utils/time-helpers');
  
  const responseData = { accessTicket };
  
  // ✅ Apply timestamp localization to convert all dates to strings
  const localizedResponse = localizeTimestamps(responseData);
  
  res.json(successResponse(
    'Access ticket retrieved successfully',
    localizedResponse
  ));
}));

// @route   POST /api/access/transfer
// @desc    Transfer access to another user
// @access  Private
router.post('/transfer', authMiddleware, asyncHandler(async (req, res) => {
  const { accessId, recipientUsername } = req.body;

  if (!accessId || !recipientUsername) {
    throw new AppError('Access ID and recipient username are required', 400);
  }

  // Get access ticket
  const accessTicket = await prisma.access.findFirst({
    where: { 
      id: accessId, 
      userId: req.user.id,
      isUsed: false
    },
    include: { event: true }
  });

  if (!accessTicket) {
    throw new AppError('Access ticket not found or already used', 404);
  }

  // Check if access type is guestlist (guestlist access cannot be transferred)
  if (accessTicket.type === 'GUEST_LIST') {
    throw new AppError('Guestlist access cannot be transferred', 400);
  }

  // Check transfer limit
  if (accessTicket.transferCount >= accessTicket.transferLimit) {
    throw new AppError('Transfer limit exceeded for this access ticket', 400);
  }

  // Check if event is in the future
  if (accessTicket.event.date < new Date()) {
    throw new AppError('Cannot transfer access for past events', 400);
  }

  // Find recipient
  const recipient = await prisma.user.findUnique({
    where: { username: recipientUsername, isActive: true },
            select: transferUserSelect
  });

  if (!recipient) {
    throw new AppError('Recipient not found', 404);
  }

  if (recipient.id === req.user.id) {
    throw new AppError('Cannot transfer access to yourself', 400);
  }

  // Check if users are mutually following
  const mutualFollow = await prisma.follow.findFirst({
    where: {
      AND: [
        { followerId: req.user.id, followingId: recipient.id },
        { followerId: recipient.id, followingId: req.user.id }
      ]
    }
  });

  if (!mutualFollow) {
    throw new AppError('You can only transfer access to mutual followers', 400);
  }

  // Transfer access
  const updatedAccess = await prisma.access.update({
    where: { id: accessId },
    data: {
      userId: recipient.id,
      transferCount: { increment: 1 },
      qrCode: generateQRCode(), // Generate new QR code for security
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
        }
      },
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
        }
      }
    }
  });

  // ✅ CENTRALIZED: Send access transferred notification
  try {
    const notificationService = getNotificationService();
    await notificationService.sendAccessTransferred(recipient.id, {
      eventName: accessTicket.event?.title || 'Event',
      eventImage: accessTicket.event?.imageUrl,
      fromUsername: req.user.username,
      accessId,
      eventId: accessTicket.eventId
    });
    console.log(`✅ Access transferred notification sent to user ${recipient.id}`);
  } catch (notifError) {
    console.error('❌ Error sending access transfer notification:', notifError);
    // Don't fail the transfer if notification fails
  }

  res.json({
    success: true,
    message: 'Access transferred successfully',
    data: { accessTicket: updatedAccess }
  });
}));

// @route   POST /api/access/:id/use
// @desc    Mark access as used (for organizers/admins)
// @access  Private
router.post('/:id/use', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const accessTicket = await prisma.access.findUnique({
    where: { id },
    include: { 
      event: {
        select: {
          id: true,
          title: true,
          organizerId: true,
        }
      }
    }
  });

  if (!accessTicket) {
    throw new AppError('Access ticket not found', 404);
  }

  // Check if user has permission to mark as used
  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  if (accessTicket.isUsed) {
    throw new AppError('Access ticket already used', 400);
  }

  if (new Date() > accessTicket.validUntil) {
    throw new AppError('Access ticket has expired', 400);
  }

  const updatedAccess = await prisma.access.update({
    where: { id },
    data: {
      isUsed: true,
      usedAt: new Date(),
    }
  });

  res.json({
    success: true,
    message: 'Access marked as used',
    data: { accessTicket: updatedAccess }
  });
}));

// @route   GET /api/access/qr/:qrCode
// @desc    Validate QR code and get access info
// @access  Private
router.get('/qr/:qrCode', authMiddleware, asyncHandler(async (req, res) => {
  const { qrCode } = req.params;

  const accessTicket = await prisma.access.findUnique({
    where: { qrCode },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          organizerId: true,
        }
      },
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      }
    }
  });

  if (!accessTicket) {
    throw new AppError('Invalid QR code', 404);
  }

  // Check if user has permission to validate
  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  const isValid = !accessTicket.isUsed && new Date() <= accessTicket.validUntil;

  res.json({
    success: true,
    data: {
      accessTicket,
      isValid,
      status: accessTicket.isUsed ? 'used' : 
              new Date() > accessTicket.validUntil ? 'expired' : 'valid'
    }
  });
}));

// @route   GET /api/access/all
// @desc    Get all access tickets (for admin/CMS)
// @access  Private (Admin only)
router.get('/all', authMiddleware, asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin required.', 403);
  }

  const { page = 1, limit = 50, status, type, eventId } = req.query;
  const offset = (page - 1) * limit;

  const where = {
    ...(status && { status }),
    ...(type && { type }),
    ...(eventId && { eventId })
  };

  const [accessTickets, total] = await Promise.all([
    prisma.access.findMany({
      where,
      skip: offset,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
          }
        },
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            location: true,
            organizer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              }
            }
          }
        }
      }
    }),
    prisma.access.count({ where })
  ]);

  // ✅ Apply timestamp localization for admin endpoint too
  const { localizeTimestamps } = require('../utils/time-helpers');
  
  const responseData = {
    success: true,
    data: accessTickets,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  };
  
  // ✅ Apply timestamp localization to convert all dates to strings
  const localizedResponse = localizeTimestamps(responseData);
  
  res.json(localizedResponse);
}));

// @route   GET /api/access/event/:eventId
// @desc    Get access types for specific event (for CMS)
// @access  Private
router.get('/event/:eventId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  // Get event to check permissions
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizerId: true }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if user has permission (organizer or admin)
  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  // This would normally fetch from a TicketType table, but since we're transitioning,
  // we'll return access statistics for now
  const accessStats = await prisma.access.groupBy({
    by: ['type', 'ticketType'],
    where: { eventId },
    _count: {
      id: true
    },
    _sum: {
      price: true
    }
  });

  res.json({
    success: true,
    data: accessStats.map(stat => ({
      type: stat.type,
      ticketType: stat.ticketType,
      soldQuantity: stat._count.id,
      totalRevenue: stat._sum.price || 0
    }))
  });
}));

// @route   GET /api/access/event/:eventId/purchasers
// @desc    Get access purchasers for specific event (for CMS)
// @access  Private
router.get('/event/:eventId/purchasers', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  // Get event to check permissions
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizerId: true, title: true }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if user has permission (organizer or admin)
  // ✅ ENTERPRISE: Use centralized authorization utilities
requireEventOwnershipOrAdmin(resource, req.user, 'perform this action');

  const [accessPurchasers, total] = await Promise.all([
    prisma.access.findMany({
      where: { eventId },
      skip: offset,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            username: true,
            avatar: true,
          }
        }
      }
    }),
    prisma.access.count({ where: { eventId } })
  ]);

  res.json({
    success: true,
    data: accessPurchasers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/access/cleanup/stats
// @desc    Get expired access cleanup statistics
// @access  Private (Admin only)
router.get('/cleanup/stats', authMiddleware, asyncHandler(async (req, res) => {
  // Only allow admin access
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  const { getCleanupStats } = require('../jobs/expired-access-cleanup-job');
  const stats = await getCleanupStats();

  res.json(successResponse(
    'Cleanup statistics retrieved successfully',
    { stats }
  ));
}));

// @route   POST /api/access/cleanup/run
// @desc    Manually trigger expired access cleanup
// @access  Private (Admin only)
router.post('/cleanup/run', authMiddleware, asyncHandler(async (req, res) => {
  // Only allow admin access
  if (req.user.role !== 'ADMIN') {
    throw new AppError('Access denied. Admin only.', 403);
  }

  const { cleanupExpiredAccess } = require('../jobs/expired-access-cleanup-job');
  
  console.log(`🧹 Manual cleanup triggered by admin: ${req.user.username}`);
  await cleanupExpiredAccess();

  res.json(successResponse(
    'Expired access cleanup completed successfully',
    { triggeredBy: req.user.username, triggeredAt: new Date().toISOString() } // Keep ISO format for API response
  ));
}));

module.exports = router; 