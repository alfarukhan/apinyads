const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ✅ Socket.IO instance (injected by server)
let io = null;
function setSocketIO(socketInstance) {
  io = socketInstance;
}

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// ✅ ENTERPRISE: Use centralized validation schemas
const validationSchemas = require('../lib/validation-schemas');


// Validation schemas
const transferAccessSchema = Joi.object({
  accessId: Joi.string().required(),
  recipientUsername: Joi.string().min(3).max(50).required(),
  reason: Joi.string().max(500).optional()
});

// Rate limiting helper - Check daily transfer limit (5 per day)
async function checkTransferLimit(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Get or create transfer limit record for today
  const transferLimit = await prisma.userTransferLimit.findUnique({
    where: {
      userId_transferDate: {
        userId,
        transferDate: today
      }
    }
  });
  
  if (transferLimit && transferLimit.transferCount >= 5) {
    throw new AppError('Daily transfer limit exceeded (5 transfers per day)', 429);
  }
  
  return transferLimit;
}

// Update transfer count
async function incrementTransferCount(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  await prisma.userTransferLimit.upsert({
    where: {
      userId_transferDate: {
        userId,
        transferDate: today
      }
    },
    update: {
      transferCount: { increment: 1 }
    },
    create: {
      userId,
      transferDate: today,
      transferCount: 1
    }
  });
}

// @route   POST /api/access-transfers
// @desc    Transfer access to another user
// @access  Private
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = transferAccessSchema.validate(req.body);
  
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { accessId, recipientUsername, reason } = value;

  // Check daily transfer limit first
  await checkTransferLimit(req.user.id);

  const result = await prisma.$transaction(async (tx) => {
    // Get access ticket with event details
    const accessTicket = await tx.access.findFirst({
      where: { 
        id: accessId, 
        userId: req.user.id,
        isUsed: false,
        status: 'CONFIRMED'
      },
      include: { 
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            location: true
          }
        }
      }
    });

    if (!accessTicket) {
      throw new AppError('Access ticket not found, already used, or not confirmed', 404);
    }

    // Enforce one-time transfer for this access
    if (accessTicket.transferCount >= 1) {
      throw new AppError('This access has already been transferred once. Further transfers are not allowed.', 400);
    }

    // Check if event is in the future (at least 24 hours ahead)
    const eventDate = new Date(accessTicket.event.startDate);
    const minTransferTime = new Date();
    minTransferTime.setHours(minTransferTime.getHours() + 24);
    
    if (eventDate < minTransferTime) {
      throw new AppError('Cannot transfer access less than 24 hours before the event', 400);
    }

    // Check if recipient exists
    const recipient = await tx.user.findUnique({
      where: { username: recipientUsername, isActive: true },
      select: { id: true, username: true, firstName: true, lastName: true, email: true }
    });

    if (!recipient) {
      throw new AppError('Recipient user not found or inactive', 404);
    }

    if (recipient.id === req.user.id) {
      throw new AppError('Cannot transfer access to yourself', 400);
    }

    // Check if recipient already has access to this event
    const existingAccess = await tx.access.findFirst({
      where: {
        userId: recipient.id,
        eventId: accessTicket.eventId,
        status: 'CONFIRMED',
        isUsed: false
      }
    });

    if (existingAccess) {
      throw new AppError('Recipient already has access to this event', 400);
    }

    // Generate new QR code for security
    const newQRCode = crypto.randomBytes(32).toString('hex').toUpperCase();
    
    // Transfer the access ticket
    const updatedAccess = await tx.access.update({
      where: { id: accessId },
      data: {
        userId: recipient.id,
        transferCount: { increment: 1 },
        lastTransferAt: new Date(),
        qrCode: newQRCode
      },
      include: {
        event: { select: { id: true, title: true, startDate: true, location: true } },
        user: { select: { id: true, username: true, firstName: true, lastName: true } }
      }
    });

    // Log the transfer
    const transferLog = await tx.accessTransfer.create({
      data: {
        accessId,
        fromUserId: req.user.id,
        toUserId: recipient.id,
        reason,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });

    // Update daily transfer count for sender
    await tx.userTransferLimit.upsert({
      where: { userId_transferDate: { userId: req.user.id, transferDate: new Date(new Date().setHours(0, 0, 0, 0)) } },
      update: { transferCount: { increment: 1 } },
      create: { userId: req.user.id, transferDate: new Date(new Date().setHours(0, 0, 0, 0)), transferCount: 1 }
    });

    // Create or reuse DIRECT chat between sender and recipient
    let chatRoom = await tx.chatRoom.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { id: req.user.id } } },
          { members: { some: { id: recipient.id } } },
          { members: { none: { id: { notIn: [req.user.id, recipient.id] } } } }
        ]
      },
      include: { members: true }
    });

    if (!chatRoom) {
      chatRoom = await tx.chatRoom.create({
        data: {
          type: 'DIRECT',
          members: { connect: [{ id: req.user.id }, { id: recipient.id }] }
        },
        include: { members: true }
      });
    }

    // Send system message to chat
    const systemMessage = await tx.message.create({
      data: {
        id: uuidv4(),
        content: `Access received: @${recipient.username} has received access to ${updatedAccess.event.title}. Enjoy the event!`,
        type: 'SYSTEM',
        senderId: req.user.id,
        chatRoomId: chatRoom.id,
        status: 'SENT',
      }
    });

    // Create notifications for both users
    await tx.notification.create({
      data: {
        userId: recipient.id,
        type: 'SYSTEM',
        title: 'Access Received',
        body: `You received access to ${updatedAccess.event.title} from @${updatedAccess.user.username}`,
        actionData: { accessId, eventId: updatedAccess.eventId, fromUserId: req.user.id, transferId: transferLog.id }
      }
    });

    await tx.notification.create({
      data: {
        userId: req.user.id,
        type: 'SYSTEM',
        title: 'Access Transferred',
        body: `You transferred access to ${updatedAccess.event.title} to @${recipient.username}`,
        actionData: { accessId, eventId: updatedAccess.eventId, toUserId: recipient.id, transferId: transferLog.id }
      }
    });

    return { updatedAccess, transferLog, recipient, chatRoom, systemMessage };
  }, { isolationLevel: 'Serializable' });

  // Real-time and push after transaction
  try {
    // Broadcast chat message if io available
    if (io && result.chatRoom) {
      io.to(result.chatRoom.id).emit('message_received', {
        id: result.systemMessage.id,
        roomId: result.chatRoom.id,
        senderId: req.user.id,
        content: result.systemMessage.content,
        createdAt: new Date().toISOString(),
        status: 'DELIVERED'
      });
    }

    // Push notification to recipient via NotificationService (if available)
    const { getNotificationService } = require('../services/core');
    const notificationService = getNotificationService && getNotificationService();
    if (notificationService && notificationService.sendToUser) {
      await notificationService.sendToUser(result.recipient.id, {
        title: 'Access Received',
        body: `You received access to ${result.updatedAccess.event.title}`,
        type: 'ACCESS_RECEIVED',
        actionData: { accessId: result.updatedAccess.id, eventId: result.updatedAccess.eventId }
      });
    }
  } catch (notifyError) {
    console.warn('⚠️ Post-transaction notifications failed:', notifyError.message);
  }

  res.json({
    success: true,
    message: 'Access transferred successfully',
    data: {
      access: result.updatedAccess,
      recipient: result.recipient,
      transferId: result.transferLog.id,
      chatRoomId: result.chatRoom?.id
    }
  });
}));

// @route   GET /api/access-transfers/my-transfers
// @desc    Get user's transfer history
// @access  Private
router.get('/my-transfers', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type = 'all' } = req.query;
  const offset = (page - 1) * limit;

  let where = {};
  
  if (type === 'sent') {
    where.fromUserId = req.user.id;
  } else if (type === 'received') {
    where.toUserId = req.user.id;
  } else {
    where = {
      OR: [
        { fromUserId: req.user.id },
        { toUserId: req.user.id }
      ]
    };
  }

  const [transfers, total] = await Promise.all([
    prisma.accessTransfer.findMany({
      where,
      skip: offset,
      take: parseInt(limit),
      orderBy: { transferDate: 'desc' },
      include: {
        access: {
          select: {
            id: true,
            ticketCode: true,
            type: true,
            event: {
              select: {
                id: true,
                title: true,
                startDate: true,
                location: true,
                imageUrl: true
              }
            },
            accessTier: {
              select: {
                name: true,
                price: true
              }
            }
          }
        },
        fromUser: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        },
        toUser: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true
          }
        }
      }
    }),
    prisma.accessTransfer.count({ where })
  ]);

  res.json({
    success: true,
    data: transfers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// @route   GET /api/access-transfers/limits
// @desc    Get user's current transfer limits (daily and monthly)
// @access  Private
router.get('/limits', authMiddleware, asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Get daily transfer limit
  const dailyTransferLimit = await prisma.userTransferLimit.findUnique({
    where: {
      userId_transferDate: {
        userId: req.user.id,
        transferDate: today
      }
    }
  });

  // Get monthly transfer count and user quota
  const [monthlyTransferCount, userProfile] = await Promise.all([
    prisma.accessTransfer.count({
      where: {
        fromUserId: req.user.id,
        transferDate: {
          gte: startOfMonth
        }
      }
    }),
    prisma.user.findUnique({
      where: { id: req.user.id },
      select: { transferQuota: true }
    })
  ]);

  const usedTransfersToday = dailyTransferLimit ? dailyTransferLimit.transferCount : 0;
  const maxTransfersPerDay = 5; // Daily limit stays at 5
  const remainingTransfersToday = Math.max(0, maxTransfersPerDay - usedTransfersToday);
  
  const monthlyQuota = userProfile?.transferQuota || 10;
  const remainingTransfersThisMonth = Math.max(0, monthlyQuota - monthlyTransferCount);

  res.json({
    success: true,
    data: {
      // Daily limits
      maxTransfersPerDay: maxTransfersPerDay,
      usedTransfersToday: usedTransfersToday,
      remainingTransfersToday: remainingTransfersToday,
      dailyResetsAt: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      
      // Monthly limits
      monthlyQuota: monthlyQuota,
      usedTransfersThisMonth: monthlyTransferCount,
      remainingTransfersThisMonth: remainingTransfersThisMonth,
      monthlyResetsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
    }
  });
}));

// @route   POST /api/access-transfers/:transferId/cancel
// @desc    Cancel a transfer (within 5 minutes)
// @access  Private
router.post('/:transferId/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const { transferId } = req.params;

  const result = await prisma.$transaction(async (tx) => {
    const transferLog = await tx.accessTransfer.findUnique({
      where: { id: transferId },
      include: {
        access: {
          include: {
            event: {
              select: { title: true }
            }
          }
        }
      }
    });

    if (!transferLog) {
      throw new AppError('Transfer not found', 404);
    }

    if (transferLog.fromUserId !== req.user.id) {
      throw new AppError('You can only cancel your own transfers', 403);
    }

    // Check if transfer is within 5 minutes (cancellation window)
    const transferTime = new Date(transferLog.transferDate);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    if (transferTime < fiveMinutesAgo) {
      throw new AppError('Transfer cancellation window has expired (5 minutes)', 400);
    }

    // Check if access hasn't been used
    if (transferLog.access.isUsed) {
      throw new AppError('Cannot cancel transfer for used access', 400);
    }

    // Transfer access back to original owner
    const revertedAccess = await tx.access.update({
      where: { id: transferLog.accessId },
      data: {
        userId: transferLog.fromUserId,
        transferCount: { decrement: 1 }
      }
    });

    // Update transfer log to mark as cancelled
    await tx.accessTransfer.update({
      where: { id: transferId },
      data: {
        reason: `CANCELLED: ${transferLog.reason || 'No reason provided'}`
      }
    });

    // Decrease daily transfer count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    await tx.userTransferLimit.update({
      where: {
        userId_transferDate: {
          userId: req.user.id,
          transferDate: today
        }
      },
      data: {
        transferCount: { decrement: 1 }
      }
    });

    // Notify both parties
    await tx.notification.create({
      data: {
        userId: transferLog.toUserId,
        type: 'SYSTEM',
        title: 'Transfer Cancelled',
        message: `Access transfer for ${transferLog.access.event.title} has been cancelled by the sender`,
        data: {
          accessId: transferLog.accessId,
          transferId: transferLog.id
        }
      }
    });

    return revertedAccess;
  });

  res.json({
    success: true,
    message: 'Transfer cancelled successfully',
    data: result
  });
}));

// ✅ GET /api/access-transfers/stats - Get transfer statistics
router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  const { userId } = req.user;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  // Get transfers used this month
  const transfersThisMonth = await prisma.accessTransfer.count({
    where: {
      fromUserId: userId,
      status: 'COMPLETED',
      createdAt: {
        gte: startOfMonth
      }
    }
  });

  // Get user's transfer quota from database
  const userProfile = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      transferQuota: true
    }
  });

  const transferLimit = userProfile?.transferQuota || 10;

  res.json({
    success: true,
    data: {
      transfersUsedThisMonth: transfersThisMonth,
      transferLimit: transferLimit,
      remainingTransfers: Math.max(0, transferLimit - transfersThisMonth)
    }
  });
}));

module.exports = router;
module.exports.setSocketIO = setSocketIO;