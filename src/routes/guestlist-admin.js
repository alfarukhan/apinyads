const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { successResponse } = require('../lib/response-formatters');
const { prisma } = require('../lib/prisma');
const GuestlistQuotaService = require('../services/core/GuestlistQuotaService');
const GuestlistNotificationService = require('../services/core/GuestlistNotificationService');

const router = express.Router();

/**
 * 🛡️ GUESTLIST ADMIN ROUTES
 * 
 * Secure admin endpoints for guestlist management:
 * - Monitor quota and reservations
 * - Handle emergency situations
 * - View system statistics
 * - Manual intervention tools
 */

// @route   GET /api/admin/guestlist/stats/:eventId
// @desc    Get comprehensive guestlist statistics for an event
// @access  Admin only
router.get('/stats/:eventId', authMiddleware, requireRole(['ADMIN', 'EO']), asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  
  console.log(`🔍 ADMIN: Getting guestlist stats for event ${eventId}`);

  const quotaService = new GuestlistQuotaService();
  const stats = await quotaService.getGuestlistStats(eventId);

  // Get additional admin statistics
  const adminStats = await prisma.guestList.groupBy({
    by: ['status'],
    where: { eventId },
    _count: {
      status: true
    }
  });

  const recentActivity = await prisma.guestList.findMany({
    where: { eventId },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true
        }
      }
    }
  });

  res.json(successResponse({
    quota: stats,
    statusBreakdown: adminStats.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    recentActivity: recentActivity,
    timestamp: new Date().toISOString()
  }));
}));

// @route   GET /api/admin/guestlist/reservations
// @desc    Get all active reservations across all events
// @access  Admin only
router.get('/reservations', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  console.log(`🔍 ADMIN: Getting all active reservations`);

  const quotaService = new GuestlistQuotaService();
  const allReservations = Array.from(quotaService.reservations.values());

  // Enrich with event and user data
  const enrichedReservations = await Promise.all(
    allReservations.map(async (reservation) => {
      const [event, user] = await Promise.all([
        prisma.event.findUnique({
          where: { id: reservation.eventId },
          select: { id: true, title: true, startDate: true }
        }),
        prisma.user.findUnique({
          where: { id: reservation.userId },
          select: { id: true, username: true, email: true, firstName: true }
        })
      ]);

      return {
        ...reservation,
        event: event,
        user: user,
        timeRemaining: Math.max(0, reservation.expiresAt.getTime() - Date.now())
      };
    })
  );

  res.json(successResponse({
    totalReservations: enrichedReservations.length,
    activeReservations: enrichedReservations.filter(r => r.status === 'RESERVED').length,
    expiringSoon: enrichedReservations.filter(r => r.timeRemaining < 2 * 60 * 1000).length, // < 2 minutes
    reservations: enrichedReservations
  }));
}));

// @route   POST /api/admin/guestlist/release-reservation
// @desc    Manually release a reservation (emergency use)
// @access  Admin only
router.post('/release-reservation', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  const { reservationId, reason } = req.body;

  if (!reservationId) {
    throw new AppError('Reservation ID is required', 400);
  }

  console.log(`🛡️ ADMIN: Manually releasing reservation ${reservationId}`);

  const quotaService = new GuestlistQuotaService();
  await quotaService.releaseReservation(reservationId, reason || 'Admin intervention');

  res.json(successResponse({
    message: 'Reservation released successfully',
    reservationId,
    releasedBy: req.user.id,
    reason: reason || 'Admin intervention'
  }));
}));

// @route   POST /api/admin/guestlist/emergency-quota-increase
// @desc    Emergency quota increase for an event
// @access  Admin only
router.post('/emergency-quota-increase', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  const { eventId, newQuota, reason } = req.body;

  if (!eventId || !newQuota || newQuota < 1) {
    throw new AppError('Valid event ID and new quota are required', 400);
  }

  console.log(`🚨 ADMIN EMERGENCY: Increasing quota for event ${eventId} to ${newQuota}`);

  // Update event quota
  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: { 
                guestlistCapacity: newQuota,
      quotaUpdatedAt: new Date(),
      quotaUpdatedBy: req.user.id,
      quotaUpdateReason: reason
    },
    select: {
      id: true,
      title: true,
                guestlistCapacity: true,
      _count: {
        select: {
          guestLists: {
            where: {
              AND: [
                { status: 'APPROVED' },
                { isPaid: true }
              ]
            }
          }
        }
      }
    }
  });

  // Log the action
  await prisma.auditLog.create({
    data: {
      action: 'EMERGENCY_QUOTA_INCREASE',
      userId: req.user.id,
      details: {
        eventId,
        oldQuota: 'unknown', // We don't have the old value here
        newQuota,
        reason,
        timestamp: new Date().toISOString()
      }
    }
  });

  res.json(successResponse({
    message: 'Emergency quota increase completed',
    event: {
      id: updatedEvent.id,
      name: updatedEvent.title,
              newQuota: updatedEvent.guestlistCapacity,
              currentUsage: updatedEvent._count.guestLists
    },
    performedBy: req.user.id,
    reason
  }));
}));

// @route   GET /api/admin/guestlist/problem-events
// @desc    Get events with potential guestlist problems
// @access  Admin only
router.get('/problem-events', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  console.log(`🔍 ADMIN: Checking for problem events`);

  // Find events with issues
  const problemEvents = await prisma.event.findMany({
    where: {
      AND: [
        { hasGuestlist: true },
        { startDate: { gte: new Date() } }, // Future events only
        {
          OR: [
            // Over quota
            {
              guestLists: {
                some: {
                  AND: [
                    { status: 'APPROVED' },
                    { isPaid: true }
                  ]
                }
              }
            },
            // High pending count
            {
              guestLists: {
                some: {
                  status: 'PENDING'
                }
              }
            }
          ]
        }
      ]
    },
    include: {
      _count: {
        select: {
          guestLists: true
        }
      },
      guestLists: {
        where: {
          status: { in: ['APPROVED', 'PENDING', 'REJECTED'] }
        },
        select: {
          status: true,
          isPaid: true
        }
      }
    }
  });

  // Analyze each event
  const analysedEvents = problemEvents.map(event => {
    const statusCounts = event.guestList.reduce((acc, entry) => {
      acc[entry.status] = (acc[entry.status] || 0) + 1;
      return acc;
    }, {});

    const maxQuota = event.guestlistCapacity || 50;
    const usedSpots = event.guestLists.filter(entry => 
      entry.status === 'APPROVED' && entry.isPaid === true
    ).length;
    const pendingSpots = statusCounts.PENDING || 0;

    const issues = [];
    if (usedSpots > maxQuota) {
      issues.push('OVER_QUOTA');
    }
    if (pendingSpots > 20) {
      issues.push('HIGH_PENDING_COUNT');
    }
    if (usedSpots / maxQuota > 0.9) {
      issues.push('NEAR_CAPACITY');
    }

    return {
      id: event.id,
      name: event.title,
      startDate: event.startDate,
      maxQuota,
      usedSpots,
      pendingSpots,
      utilizationPercent: Math.round((usedSpots / maxQuota) * 100),
      issues,
      severity: issues.includes('OVER_QUOTA') ? 'HIGH' : issues.length > 1 ? 'MEDIUM' : 'LOW'
    };
  }).filter(event => event.issues.length > 0);

  res.json(successResponse({
    totalProblems: analysedEvents.length,
    highSeverity: analysedEvents.filter(e => e.severity === 'HIGH').length,
    mediumSeverity: analysedEvents.filter(e => e.severity === 'MEDIUM').length,
    events: analysedEvents.sort((a, b) => {
      const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    })
  }));
}));

// @route   POST /api/admin/guestlist/test-notification
// @desc    Test guestlist notification system
// @access  Admin only  
router.post('/test-notification', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  const { userId, eventId, notificationType } = req.body;

  if (!userId || !eventId || !notificationType) {
    throw new AppError('User ID, event ID, and notification type are required', 400);
  }

  console.log(`🧪 ADMIN: Testing ${notificationType} notification for user ${userId}, event ${eventId}`);

  const notificationService = new GuestlistNotificationService();

  // Send test notification based on type
  switch (notificationType) {
    case 'SPOT_RESERVED':
      await notificationService.sendSpotReserved(userId, eventId, 'test_reservation_123', 600000);
      break;
    case 'PAYMENT_SUCCESS':
      await notificationService.sendPaymentSuccess(userId, eventId, 'test_payment_123', 'TEST123');
      break;
    case 'PAYMENT_FAILED':
      await notificationService.sendPaymentFailed(userId, eventId, 'test_payment_123', 'Test failure reason');
      break;
    case 'QUOTA_FULL':
      await notificationService.sendQuotaFull(userId, eventId);
      break;
    case 'APPROVAL_RECEIVED':
      await notificationService.sendApprovalReceived(userId, eventId);
      break;
    default:
      throw new AppError('Invalid notification type', 400);
  }

  res.json(successResponse({
    message: 'Test notification sent successfully',
    type: notificationType,
    userId,
    eventId,
    testedBy: req.user.id
  }));
}));

module.exports = router;