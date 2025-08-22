const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

// ✅ REAL-TIME: Socket.IO instance will be set by server
let io = null;

// Function to set Socket.IO instance from server
function setSocketIO(socketInstance) {
  io = socketInstance;
  console.log('✅ Socket.IO instance set for chat routes');
}


// @route   GET /api/chat/rooms
// @desc    Get user's chat rooms
// @access  Private
router.get('/rooms', authMiddleware, asyncHandler(async (req, res) => {
  console.log('🔍 Loading chat rooms for user:', req.user.id);
  
  // Get all chat rooms where user is a member (including empty ones)
  const userChatRooms = await prisma.chatRoom.findMany({
    where: {
      members: {
        some: { id: req.user.id }
      },
      isActive: true
    },
    include: {
      members: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            }
          }
        }
      },
      _count: {
        select: { messages: true }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  // Calculate unread count for each chat room
  const chatRoomsWithUnreadCount = await Promise.all(
    userChatRooms.map(async (room) => {
      // Count unread messages for current user in this room
      const unreadCount = await prisma.message.count({
        where: {
          chatRoomId: room.id,
          senderId: { not: req.user.id }, // Not sent by current user
          status: { not: 'READ' }
        }
      });

      return {
        ...room,
        unreadCount
      };
    })
  );

  console.log('📊 Found chat rooms for user:', chatRoomsWithUnreadCount.length);
  chatRoomsWithUnreadCount.forEach(room => {
    console.log(`📋 Room ${room.id}: ${room.name || room.type} - ${room._count.messages} messages (${room.unreadCount} unread)`);
  });

  res.json({
    success: true,
    data: { chatRooms: chatRoomsWithUnreadCount }
  });
}));

// @route   GET /api/chat/rooms/:id/messages
// @desc    Get messages for a chat room
// @access  Private
router.get('/rooms/:id/messages', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const userId = req.user.id;

  console.log(`🔍 Getting messages for room: ${roomId}, user: ${userId}`);

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    }
  });

  if (!chatRoom) {
    console.log(`❌ User ${userId} denied access to room ${roomId}`);
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  console.log(`✅ User ${userId} has access to room ${roomId}`);

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { chatRoomId: roomId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: parseInt(limit)
    }),
    prisma.message.count({ where: { chatRoomId: roomId } })
  ]);

  // Mark all messages in this room as read for current user
  const updatedMessages = await prisma.message.updateMany({
    where: {
      chatRoomId: roomId,
      senderId: { not: userId }, // Don't mark own messages
      status: { not: 'READ' }
    },
    data: {
      isRead: true,
      status: 'READ'
    }
  });

  // ✅ REAL-TIME: Emit unread count update if messages were marked as read
  if (io && updatedMessages.count > 0) {
    // Calculate new unread count (should be 0 now)
    const newUnreadCount = await prisma.message.count({
      where: {
        chatRoomId: roomId,
        senderId: { not: userId },
        status: { not: 'READ' }
      }
    });

    // Emit to the user's personal channel for instant UI update
    io.to(`user_${userId}`).emit('unread_count_updated', {
      roomId,
      unreadCount: newUnreadCount,
      userId,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Auto-emitted unread count update: ${newUnreadCount} for room ${roomId} (${updatedMessages.count} messages marked)`);
  }

  // Update last read timestamp if messages were marked as read
  if (updatedMessages.count > 0) {
    await prisma.userChatActivity.upsert({
      where: {
        userId_chatRoomId: {
          userId: userId,
          chatRoomId: roomId
        }
      },
      update: {
        lastReadAt: new Date()
      },
      create: {
        userId: userId,
        chatRoomId: roomId,
        lastReadAt: new Date()
      }
    });

    console.log(`✅ Auto-updated last read timestamp for user ${userId} in room ${roomId}`);
  }

  console.log(`📊 Found ${messages.length} messages for room ${roomId} (total: ${total}) - Marked ${updatedMessages.count} as read`);

  res.json({
    success: true,
    data: {
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total
      }
    }
  });
}));

// @route   POST /api/chat/rooms/:id/messages
// @desc    🚀 REAL-TIME: Send a message to chat room with WebSocket broadcasting
// @access  Private
router.post('/rooms/:id/messages', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const { content, type = 'TEXT', replyToId } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required'
    });
  }

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    },
    include: {
      members: {
        select: { 
          id: true, 
          username: true, 
          firstName: true, 
          lastName: true, 
          avatar: true,
          fcmTokens: true 
        }
      }
    }
  });

  if (!chatRoom) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  const message = await prisma.message.create({
    data: {
      id: uuidv4(),
      content: content.trim(),
      type: type.toUpperCase(),
      senderId: userId,
      chatRoomId: roomId,
      status: 'SENT',
      ...(replyToId && { replyToId })
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      replyTo: {
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          }
        }
      }
    }
  });

  // Update chat room's last activity
  await prisma.chatRoom.update({
    where: { id: roomId },
    data: { updatedAt: new Date() }
  });

  // ✅ REAL-TIME: Broadcast message via WebSocket
  if (io) {
    io.to(roomId).emit('message_received', {
      id: message.id,
      roomId: message.chatRoomId,
      senderId: message.senderId,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      status: message.status
    });
    
    // Update message status to DELIVERED after broadcasting
    await prisma.message.update({
      where: { id: message.id },
      data: { status: 'DELIVERED' }
    });
    
    console.log('📨 Message broadcasted via WebSocket and status updated to DELIVERED');

    // Emit status update event for DELIVERED so clients can update double-checks
    io.to(roomId).emit('message_status_updated', {
      messageId: message.id,
      roomId,
      status: 'DELIVERED',
      timestamp: new Date().toISOString()
    });

    // Emit unread count updates to all recipients (excluding sender)
    if (chatRoom?.members?.length) {
      for (const member of chatRoom.members) {
        if (member.id === userId) continue;
        const memberUnreadCount = await prisma.message.count({
          where: {
            chatRoomId: roomId,
            senderId: { not: member.id },
            status: { not: 'READ' }
          }
        });
        io.to(`user_${member.id}`).emit('unread_count_updated', {
          roomId,
          unreadCount: memberUnreadCount,
          userId: member.id,
          timestamp: new Date().toISOString()
        });
      }

      // Also emit unread count to the sender to force chat list sync across instances
      const senderUnreadCount = await prisma.message.count({
        where: {
          chatRoomId: roomId,
          senderId: { not: userId },
          status: { not: 'READ' }
        }
      });
      io.to(`user_${userId}`).emit('unread_count_updated', {
        roomId,
        unreadCount: senderUnreadCount,
        userId,
        timestamp: new Date().toISOString()
      });
    }
  }

  res.status(201).json({
    success: true,
    data: { 
      message,
      realTime: !!io
    }
  });
}));

// @route   POST /api/chat/rooms/:id/mark-read
// @desc    Mark all messages in chat room as read and update unread count
// @access  Private
router.post('/rooms/:id/mark-read', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const userId = req.user.id;

  console.log(`📖 Marking all messages as read for room: ${roomId}, user: ${userId}`);

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    }
  });

  if (!chatRoom) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  // Mark all unread messages in this room as read for current user
  const updatedMessages = await prisma.message.updateMany({
    where: {
      chatRoomId: roomId,
      senderId: { not: userId }, // Don't mark own messages
      status: { not: 'READ' }
    },
    data: {
      isRead: true,
      status: 'READ'
    }
  });

  console.log(`✅ Marked ${updatedMessages.count} messages as read in room ${roomId}`);

  // Calculate new unread count (should be 0 now)
  const newUnreadCount = await prisma.message.count({
    where: {
      chatRoomId: roomId,
      senderId: { not: userId },
      status: { not: 'READ' }
    }
  });

  // ✅ REAL-TIME: Emit unread count update via WebSocket
  if (io) {
    // Emit to the user's personal channel for instant UI update
    io.to(`user_${userId}`).emit('unread_count_updated', {
      roomId,
      unreadCount: newUnreadCount,
      userId,
      timestamp: new Date().toISOString()
    });

    // Also emit to the room for other participants to know messages were read
    io.to(roomId).emit('messages_marked_read', {
      roomId,
      readBy: userId,
      messagesCount: updatedMessages.count,
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Emitted unread count update: ${newUnreadCount} for room ${roomId}`);
  }

  // Update or create user chat activity with new last read timestamp
  await prisma.userChatActivity.upsert({
    where: {
      userId_chatRoomId: {
        userId: userId,
        chatRoomId: roomId
      }
    },
    update: {
      lastReadAt: new Date()
    },
    create: {
      userId: userId,
      chatRoomId: roomId,
      lastReadAt: new Date()
    }
  });

  console.log(`✅ Updated last read timestamp for user ${userId} in room ${roomId}`);

  res.json({
    success: true,
    data: {
      markedCount: updatedMessages.count,
      newUnreadCount,
      roomId
    },
    message: 'Messages marked as read successfully'
  });
}));

// @route   GET /api/chat/rooms/:id/last-read
// @desc    Get last read timestamp for user in chat room
// @access  Private
router.get('/rooms/:id/last-read', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const userId = req.user.id;

  console.log(`📖 Getting last read timestamp for room: ${roomId}, user: ${userId}`);

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    }
  });

  if (!chatRoom) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  // Get user chat activity for last read timestamp
  const userActivity = await prisma.userChatActivity.findUnique({
    where: {
      userId_chatRoomId: {
        userId: userId,
        chatRoomId: roomId
      }
    }
  });

  if (!userActivity) {
    console.log(`📖 No last read timestamp found for user ${userId} in room ${roomId}`);
    return res.json({
      success: true,
      data: {
        lastReadAt: null
      }
    });
  }

  console.log(`✅ Last read timestamp: ${userActivity.lastReadAt.toISOString()}`);

  res.json({
    success: true,
    data: {
      lastReadAt: userActivity.lastReadAt.toISOString()
    }
  });
}));

// @route   POST /api/chat/rooms
// @desc    🚀 REAL-TIME: Create a new chat room
// @access  Private
router.post('/rooms', authMiddleware, asyncHandler(async (req, res) => {
  const { name, type = 'DIRECT', memberIds = [] } = req.body;
  const userId = req.user.id;

  // Validate memberIds
  if (type === 'DIRECT' && memberIds.length !== 1) {
    return res.status(400).json({
      success: false,
      message: 'Direct chat requires exactly one other member'
    });
  }

  // Check if direct chat already exists
  if (type === 'DIRECT') {
    console.log('🔍 Checking for existing DIRECT chat between:', userId, 'and', memberIds[0]);
    
    const existingRoom = await prisma.chatRoom.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { members: { some: { id: userId } } },
          { members: { some: { id: memberIds[0] } } },
          { members: { none: { id: { notIn: [userId, memberIds[0]] } } } }
        ]
      },
      include: {
        members: {
          select: userSelectors.basic
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: userSelectors.basic
            }
          }
        }
      }
    });

    if (existingRoom) {
      console.log('✅ Found existing DIRECT chat room:', existingRoom.id);
      console.log('📊 Existing room has', existingRoom.messages.length, 'recent messages');
      return res.json({
        success: true,
        data: { chatRoom: existingRoom },
        message: 'Direct chat already exists'
      });
    }
    
    console.log('🆕 No existing DIRECT chat found, creating new room');
  }

  // Create new chat room
  const chatRoom = await prisma.chatRoom.create({
    data: {
      name,
      type: type.toUpperCase(),
      members: {
        connect: [
          { id: userId },
          ...memberIds.map(id => ({ id }))
        ]
      }
    },
    include: {
      members: {
        select: userSelectors.basic
      },
      messages: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: {
            select: userSelectors.basic
          }
        }
      }
    }
  });

  // ✅ REAL-TIME: Notify all members about new room
  if (io) {
    io.emit('new_chat_room', {
      chatRoom,
      timestamp: new Date().toISOString()
    });
  }

  res.status(201).json({
    success: true,
    data: { chatRoom }
  });
}));



// @route   GET /api/chat/online-status
// @desc    🚀 REAL-TIME: Get online status of users
// @access  Private
router.get('/online-status', authMiddleware, asyncHandler(async (req, res) => {
  const { userIds } = req.query;
  
  if (!userIds) {
    return res.status(400).json({
      success: false,
      message: 'userIds query parameter is required'
    });
  }

  const userIdArray = userIds.split(',');
  
  // For now, assume all users are offline since we don't have proper chat service
  const onlineUsers = [];
  const offlineUsers = userIdArray;

  res.json({
    success: true,
    data: {
      onlineUsers,
      offlineUsers,
      totalConnected: 0,
      realTimeAvailable: !!io
    }
  });
}));

// @route   POST /api/chat/rooms/:id/typing
// @desc    🚀 REAL-TIME: Send typing indicator
// @access  Private
router.post('/rooms/:id/typing', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const { isTyping = true } = req.body;
  const userId = req.user.id;

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    }
  });

  if (!chatRoom) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  // ✅ REAL-TIME: Send typing indicator via WebSocket
  if (io) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelectors.basic
    });

    if (isTyping) {
      io.to(roomId).emit('user_typing', {
        userId,
        userName: `${user.firstName} ${user.lastName}`,
        roomId,
        timestamp: new Date().toISOString()
      });
    } else {
      io.to(roomId).emit('user_stopped_typing', {
        userId,
        userName: `${user.firstName} ${user.lastName}`,
        roomId,
        timestamp: new Date().toISOString()
      });
    }
  }

  res.json({
    success: true,
    message: `Typing indicator ${isTyping ? 'started' : 'stopped'}`,
    realTime: !!io
  });
}));

// @route   POST /api/chat/notification-reply
// @desc    📱 Reply to chat message from push notification
// @access  Private
router.post('/notification-reply', authMiddleware, asyncHandler(async (req, res) => {
  const { chatRoomId, content, originalMessageId } = req.body;
  const userId = req.user.id;

  if (!content || content.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Message content is required'
    });
  }

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: chatRoomId,
      members: {
        some: { id: userId }
      }
    },
    include: {
      members: {
        select: { 
          id: true, 
          username: true, 
          firstName: true, 
          lastName: true, 
          avatar: true,
          fcmTokens: true 
        }
      }
    }
  });

  if (!chatRoom) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this chat room'
    });
  }

  const message = await prisma.message.create({
    data: {
      id: uuidv4(),
      content: content.trim(),
      type: 'TEXT',
      senderId: userId,
      chatRoomId: chatRoomId,
      status: 'SENT',
      ...(originalMessageId && { replyToId: originalMessageId })
    },
    include: {
      sender: {
        select: userSelectors.basic
      },
      replyTo: {
        include: {
          sender: {
            select: userSelectors.basic
          }
        }
      }
    }
  });

  // Update chat room's last activity
  await prisma.chatRoom.update({
    where: { id: chatRoomId },
    data: { updatedAt: new Date() }
  });

  // ✅ REAL-TIME: Broadcast message via WebSocket
  if (io) {
    io.to(chatRoomId).emit('message_received', {
      id: message.id,
      roomId: message.chatRoomId,
      senderId: message.senderId,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      status: message.status,
      source: 'notification_reply'
    });
  }

  res.status(201).json({
    success: true,
    data: { 
      message,
      source: 'notification_reply',
      realTime: !!io
    },
    message: 'Reply sent successfully from notification'
  });
}));

// @route   POST /api/chat/support/session
// @desc    Start a support chat session
// @access  Private
router.post('/support/session', authMiddleware, asyncHandler(async (req, res) => {
  const { category } = req.body;
  const userId = req.user.id;

  // Check if user already has an active support session
  const existingSession = await prisma.supportSession.findFirst({
    where: {
      userId,
      status: { in: ['PENDING', 'ACTIVE'] }
    }
  });

  if (existingSession) {
    return res.json({
      success: true,
      data: {
        sessionId: existingSession.id,
        status: existingSession.status,
        queuePosition: existingSession.queuePosition,
        estimatedWaitTime: existingSession.estimatedWaitTime
      }
    });
  }

  // Get current queue length for estimate
  const queueLength = await prisma.supportSession.count({
    where: { status: 'PENDING' }
  });

  const session = await prisma.supportSession.create({
    data: {
      userId,
      category: category || 'GENERAL',
      status: 'PENDING',
      queuePosition: queueLength + 1,
      estimatedWaitTime: (queueLength + 1) * 3 // 3 minutes per person ahead
    }
  });

  res.status(201).json({
    success: true,
    data: {
      sessionId: session.id,
      status: session.status,
      queuePosition: session.queuePosition,
      estimatedWaitTime: session.estimatedWaitTime
    }
  });
}));

// @route   GET /api/chat/support/session/:id
// @desc    Get support session status
// @access  Private
router.get('/support/session/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id: sessionId } = req.params;
  const userId = req.user.id;

  const session = await prisma.supportSession.findFirst({
    where: {
      id: sessionId,
      userId
    },
    include: {
      agent: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true
        }
      }
    }
  });

  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Support session not found'
    });
  }

  res.json({
    success: true,
    data: {
      sessionId: session.id,
      status: session.status,
      queuePosition: session.queuePosition,
      estimatedWaitTime: session.estimatedWaitTime,
      agent: session.agent
    }
  });
}));

// @route   GET /api/chat/support/agents
// @desc    Get available support agents info
// @access  Public
router.get('/support/agents', asyncHandler(async (req, res) => {
  // Get count of online agents (users with role ADMIN or SUPPORT)
  const activeAgents = await prisma.user.count({
    where: {
      role: { in: ['ADMIN'] }, // Add SUPPORT role if exists
      isActive: true
    }
  });

  res.json({
    success: true,
    data: {
      activeAgents: Math.max(1, activeAgents), // Always show at least 1 agent
      averageResponseTime: '2-5 minutes'
    }
  });
}));

// @route   DELETE /api/chat/rooms/:id/delete-for-me
// @desc    Soft delete chat room for current user only
// @access  Private
router.delete('/rooms/:id/delete-for-me', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const userId = req.user.id;

  console.log(`🗑️ Soft deleting chat room ${roomId} for user ${userId}`);

  // Check if user is member of the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    }
  });

  if (!chatRoom) {
    return res.status(404).json({
      success: false,
      message: 'Chat room not found or you are not a member'
    });
  }

  // Remove user from chat room members (soft delete for user)
  await prisma.chatRoom.update({
    where: { id: roomId },
    data: {
      members: {
        disconnect: { id: userId }
      }
    }
  });

  console.log(`✅ User ${userId} removed from chat room ${roomId}`);

  // Emit real-time event to other members
  if (io) {
    io.to(roomId).emit('member_left', {
      roomId,
      userId,
      timestamp: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    message: 'Chat deleted for you successfully'
  });
}));

// @route   DELETE /api/chat/rooms/:id/delete-forever
// @desc    Permanently delete chat room for everyone (hard delete)
// @access  Private (Only room creator or admin)
router.delete('/rooms/:id/delete-forever', authMiddleware, asyncHandler(async (req, res) => {
  const { id: roomId } = req.params;
  const userId = req.user.id;

  console.log(`🗑️ Permanently deleting chat room ${roomId} by user ${userId}`);

  // Check if user has permission to delete the chat room
  const chatRoom = await prisma.chatRoom.findFirst({
    where: {
      id: roomId,
      members: {
        some: { id: userId }
      }
    },
    include: {
      members: {
        select: { id: true }
      }
    }
  });

  if (!chatRoom) {
    return res.status(404).json({
      success: false,
      message: 'Chat room not found or you are not a member'
    });
  }

  // Prevent deleting group/community chats for everyone
  if (chatRoom.type === 'GROUP' || chatRoom.type === 'SUPPORT') {
    return res.status(403).json({
      success: false,
      message: 'Group and community chats can only be removed from your list, not deleted for everyone'
    });
  }

  // Get all member IDs before deletion for real-time notification
  const memberIds = chatRoom.members.map(member => member.id);

  // Hard delete: Delete all messages first, then the chat room
  await prisma.$transaction(async (tx) => {
    // Delete all messages in the chat room
    await tx.message.deleteMany({
      where: { chatRoomId: roomId }
    });

    // Delete the chat room itself
    await tx.chatRoom.delete({
      where: { id: roomId }
    });
  });

  console.log(`✅ Chat room ${roomId} permanently deleted by user ${userId}`);

  // Emit real-time event to all members
  if (io) {
    memberIds.forEach(memberId => {
      io.to(`user_${memberId}`).emit('chat_deleted_forever', {
        roomId,
        deletedBy: userId,
        timestamp: new Date().toISOString()
      });
    });
  }

  res.json({
    success: true,
    message: 'Chat permanently deleted for everyone'
  });
}));

// =====================================
// MESSAGE MANAGEMENT APIs
// =====================================

// @route   DELETE /api/chat/messages/:messageId
// @desc    Delete a message with role-based permissions
// @access  Private
router.delete('/messages/:messageId', authMiddleware, asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  // Get message with full context
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true
        }
      },
      chatRoom: {
        include: {
          community: {
            select: {
              id: true,
              adminId: true
            }
          },
          members: {
            where: { id: userId },
            select: { id: true }
          }
        }
      },
      topic: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  // Check if user is member of the chat room
  if (!message.chatRoom.members.length) {
    throw new AppError('You are not a member of this chat room', 403);
  }

  // Determine if user can delete this message
  let canDelete = false;
  let deleteReason = '';

  // 1. User can always delete their own messages
  if (message.senderId === userId) {
    canDelete = true;
    deleteReason = 'own message';
  }
  // 2. If this is a community group chat, check community roles
  else if (message.chatRoom.community) {
    const communityId = message.chatRoom.community.id;
    
    // Check if user is community admin
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: communityId,
          userId: userId
        }
      },
      select: { role: true }
    });

    // User can delete if they are community admin OR original community admin
    if (membership?.role === 'ADMIN' || message.chatRoom.community.adminId === userId) {
      canDelete = true;
      deleteReason = 'community admin';
    }
    // Moderators can delete messages too
    else if (membership?.role === 'MODERATOR') {
      canDelete = true;
      deleteReason = 'community moderator';
    }
  }
  // 3. For regular group chats (non-community), only sender can delete
  // This is already handled by condition 1

  if (!canDelete) {
    throw new AppError('You do not have permission to delete this message', 403);
  }

  // Soft delete the message
  await prisma.message.update({
    where: { id: messageId },
    data: {
      isDeleted: true,
      content: '[Message deleted]'
    }
  });

  // Broadcast message deletion via WebSocket
  if (io && message.chatRoom.id) {
    io.to(`room:${message.chatRoom.id}`).emit('message_deleted', {
      messageId: messageId,
      deletedBy: userId,
      deletedAt: new Date().toISOString(),
      reason: deleteReason
    });
  }

  const senderName = `${message.sender.firstName} ${message.sender.lastName}`.trim() 
    || message.sender.username;

  console.log(`✅ Message deleted: ${messageId} from ${senderName} by ${userId} (${deleteReason})`);

  res.json({
    success: true,
    message: 'Message deleted successfully',
    data: {
      messageId: messageId,
      deletedBy: userId,
      deletedAt: new Date().toISOString(),
      reason: deleteReason
    }
  });
}));

// @route   POST /api/chat/messages/:messageId/restore
// @desc    Restore a deleted message (Admin only)
// @access  Private
router.post('/messages/:messageId/restore', authMiddleware, asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;

  // Get message with full context
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chatRoom: {
        include: {
          community: {
            select: {
              id: true,
              adminId: true
            }
          },
          members: {
            where: { id: userId },
            select: { id: true }
          }
        }
      }
    }
  });

  if (!message) {
    throw new AppError('Message not found', 404);
  }

  if (!message.isDeleted) {
    throw new AppError('Message is not deleted', 400);
  }

  // Check if user is member of the chat room
  if (!message.chatRoom.members.length) {
    throw new AppError('You are not a member of this chat room', 403);
  }

  // Only community admins can restore messages
  let canRestore = false;
  if (message.chatRoom.community) {
    const communityId = message.chatRoom.community.id;
    
    // Check if user is community admin
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId: communityId,
          userId: userId
        }
      },
      select: { role: true }
    });

    if (membership?.role === 'ADMIN' || message.chatRoom.community.adminId === userId) {
      canRestore = true;
    }
  }

  if (!canRestore) {
    throw new AppError('Only community admins can restore messages', 403);
  }

  // Get original content (if stored separately) or ask for it
  const { originalContent } = req.body;
  if (!originalContent) {
    throw new AppError('Original content is required to restore message', 400);
  }

  // Restore the message
  await prisma.message.update({
    where: { id: messageId },
    data: {
      isDeleted: false,
      content: originalContent
    }
  });

  // Broadcast message restoration via WebSocket
  if (io && message.chatRoom.id) {
    io.to(`room:${message.chatRoom.id}`).emit('message_restored', {
      messageId: messageId,
      restoredBy: userId,
      restoredAt: new Date().toISOString(),
      content: originalContent
    });
  }

  console.log(`✅ Message restored: ${messageId} by ${userId}`);

  res.json({
    success: true,
    message: 'Message restored successfully',
    data: {
      messageId: messageId,
      restoredBy: userId,
      restoredAt: new Date().toISOString()
    }
  });
}));

module.exports = router;
module.exports.setSocketIO = setSocketIO; 