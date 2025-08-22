const jwt = require('jsonwebtoken');
const { prisma } = require('../../lib/prisma');
const { v4: uuidv4 } = require('uuid');

/**
 * 🚀 REAL-TIME CHAT WEBSOCKET SERVICE
 * 
 * Features:
 * - Real-time messaging with Socket.IO
 * - JWT authentication for WebSocket connections
 * - Chat rooms management
 * - Message delivery status tracking
 * - Online/offline user status
 * - Typing indicators
 * - Message reactions
 * - Push notification integration
 */
class ChatWebSocketService {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userRooms = new Map(); // userId -> Set of roomIds
    this.typingUsers = new Map(); // roomId -> Set of userIds
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  /**
   * 🔒 AUTHENTICATION MIDDLEWARE
   * Verify JWT token for WebSocket connections
   */
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            isActive: true,
            status: true
          }
        });

        if (!user || !user.isActive || user.status !== 'ACTIVE') {
          return next(new Error('Authentication error: User not found or inactive'));
        }

        socket.userId = user.id;
        socket.user = user;
        
        console.log(`🔗 WebSocket authenticated: ${user.username} (${user.id})`);
        next();
      } catch (error) {
        console.error('❌ WebSocket authentication failed:', error.message);
        next(new Error('Authentication error: Invalid token'));
      }
    });
  }

  /**
   * 🎯 EVENT HANDLERS SETUP
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      // Message events
      socket.on('join_room', (data) => this.handleJoinRoom(socket, data));
      socket.on('leave_room', (data) => this.handleLeaveRoom(socket, data));
      socket.on('send_message', (data) => this.handleSendMessage(socket, data));
      socket.on('mark_message_read', (data) => this.handleMarkMessageRead(socket, data));
      
      // Typing events
      socket.on('typing_start', (data) => this.handleTypingStart(socket, data));
      socket.on('typing_stop', (data) => this.handleTypingStop(socket, data));
      
      // Message reactions
      socket.on('add_reaction', (data) => this.handleAddReaction(socket, data));
      socket.on('remove_reaction', (data) => this.handleRemoveReaction(socket, data));
      
      // Feed events (real-time feed updates)
      socket.on('join_feed_room', () => this.handleJoinFeedRoom(socket));
      socket.on('leave_feed_room', () => this.handleLeaveFeedRoom(socket));
      socket.on('broadcast_new_post', (data) => this.handleBroadcastNewPost(socket, data));
      socket.on('broadcast_post_like', (data) => this.handleBroadcastPostLike(socket, data));
      socket.on('broadcast_new_comment', (data) => this.handleBroadcastNewComment(socket, data));
      
      // Connection events
      socket.on('disconnect', () => this.handleDisconnection(socket));
    });
  }

  /**
   * 🔗 HANDLE USER CONNECTION
   */
  async handleConnection(socket) {
    const userId = socket.userId;
    const user = socket.user;
    
    try {
      // Store connection
      this.connectedUsers.set(userId, socket.id);
      
      // Join user to their personal room for direct notifications
      socket.join(`user_${userId}`);
      console.log(`🔗 User ${userId} joined personal room: user_${userId}`);
      
      // Join user to their chat rooms
      const userChatRooms = await prisma.chatRoom.findMany({
        where: {
          members: { some: { id: userId } },
          isActive: true
        },
        select: { id: true, name: true, type: true }
      });

      const roomIds = new Set();
      for (const room of userChatRooms) {
        socket.join(room.id);
        roomIds.add(room.id);
        
        // Notify other room members that user is online
        socket.to(room.id).emit('user_online', {
          userId,
          user: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            avatar: user.avatar
          },
          timestamp: new Date().toISOString()
        });
      }
      
      this.userRooms.set(userId, roomIds);
      
      // Send connection confirmation
      socket.emit('connected', {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar
        },
        rooms: userChatRooms,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ User connected: ${user.username} (${userId}) - Rooms: ${roomIds.size}`);
      
    } catch (error) {
      console.error('❌ Error handling connection:', error);
      socket.emit('error', { message: 'Connection setup failed' });
    }
  }

  /**
   * 🚪 HANDLE JOIN ROOM
   */
  async handleJoinRoom(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;
    
    try {
      // Verify user has access to room
      const chatRoom = await prisma.chatRoom.findFirst({
        where: {
          id: roomId,
          members: { some: { id: userId } },
          isActive: true
        }
      });

      if (!chatRoom) {
        socket.emit('error', { message: 'Access denied to chat room' });
        return;
      }

      socket.join(roomId);
      
      // Add to user rooms if not already there
      const userRooms = this.userRooms.get(userId) || new Set();
      userRooms.add(roomId);
      this.userRooms.set(userId, userRooms);

      // Notify others in room
      socket.to(roomId).emit('user_joined_room', {
        userId,
        user: socket.user,
        roomId,
        timestamp: new Date().toISOString()
      });

      socket.emit('room_joined', {
        roomId,
        timestamp: new Date().toISOString()
      });

      console.log(`👥 User ${socket.user.username} joined room ${roomId}`);
      
    } catch (error) {
      console.error('❌ Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  /**
   * 🚪 HANDLE LEAVE ROOM
   */
  handleLeaveRoom(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;
    
    try {
      socket.leave(roomId);
      
      // Remove from user rooms
      const userRooms = this.userRooms.get(userId);
      if (userRooms) {
        userRooms.delete(roomId);
      }

      // Notify others in room
      socket.to(roomId).emit('user_left_room', {
        userId,
        user: socket.user,
        roomId,
        timestamp: new Date().toISOString()
      });

      socket.emit('room_left', {
        roomId,
        timestamp: new Date().toISOString()
      });

      console.log(`👋 User ${socket.user.username} left room ${roomId}`);
      
    } catch (error) {
      console.error('❌ Error leaving room:', error);
      socket.emit('error', { message: 'Failed to leave room' });
    }
  }

  /**
   * 💬 HANDLE SEND MESSAGE
   */
  async handleSendMessage(socket, data) {
    const { roomId, content, type = 'TEXT', replyToId } = data;
    const userId = socket.userId;
    
    try {
      // Verify user has access to room
      const chatRoom = await prisma.chatRoom.findFirst({
        where: {
          id: roomId,
          members: { some: { id: userId } },
          isActive: true
        },
        include: {
          members: {
            select: { id: true, username: true, firstName: true, lastName: true, avatar: true, fcmTokens: true }
          }
        }
      });

      if (!chatRoom) {
        socket.emit('error', { message: 'Access denied to chat room' });
        return;
      }

      // Create message in database
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
              avatar: true
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

      // Broadcast message to all room members
      this.io.to(roomId).emit('new_message', {
        message,
        timestamp: new Date().toISOString()
      });

      // Update message status to DELIVERED after broadcasting
      await prisma.message.update({
        where: { id: message.id },
        data: { status: 'DELIVERED' }
      });

      // Emit status update event for DELIVERED so clients can render ✓✓
      this.io.to(roomId).emit('message_status_updated', {
        messageId: message.id,
        roomId,
        status: 'DELIVERED',
        timestamp: new Date().toISOString()
      });

      // Stop typing indicator for sender
      this.handleTypingStop(socket, { roomId });

      // Send push notifications to offline users
      await this.sendPushNotifications(message, chatRoom);

      console.log(`💬 Message sent in room ${roomId} by ${socket.user.username}`);
      
    } catch (error) {
      console.error('❌ Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  /**
   * ✅ HANDLE MARK MESSAGE READ
   */
  async handleMarkMessageRead(socket, data) {
    const { messageId, roomId } = data;
    const userId = socket.userId;
    
    try {
      // Update message read status
      await prisma.message.update({
        where: { 
          id: messageId,
          chatRoomId: roomId
        },
        data: { 
          isRead: true,
          status: 'READ'
        }
      });

      // Notify sender that message was read
      socket.to(roomId).emit('message_read', {
        messageId,
        readBy: userId,
        user: socket.user,
        timestamp: new Date().toISOString()
      });

      // Also emit message status update
      socket.to(roomId).emit('message_status_updated', {
        messageId,
        roomId,
        status: 'READ',
        readBy: userId,
        timestamp: new Date().toISOString()
      });

      // Emit unread count update for the reader (should decrease)
      const newUnreadCount = await prisma.message.count({
        where: {
          chatRoomId: roomId,
          senderId: { not: userId },
          status: { not: 'READ' }
        }
      });
      this.io.to(`user_${userId}`).emit('unread_count_updated', {
        roomId,
        unreadCount: newUnreadCount,
        userId,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Message ${messageId} marked as read by ${socket.user.username}`);
      
    } catch (error) {
      console.error('❌ Error marking message as read:', error);
    }
  }

  /**
   * ⌨️ HANDLE TYPING START
   */
  handleTypingStart(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;
    
    try {
      // Add to typing users
      if (!this.typingUsers.has(roomId)) {
        this.typingUsers.set(roomId, new Set());
      }
      this.typingUsers.get(roomId).add(userId);

      // Notify others in room
      socket.to(roomId).emit('user_typing_start', {
        userId,
        user: socket.user,
        roomId,
        timestamp: new Date().toISOString()
      });

      console.log(`⌨️ User ${socket.user.username} started typing in room ${roomId}`);
      
    } catch (error) {
      console.error('❌ Error handling typing start:', error);
    }
  }

  /**
   * ⌨️ HANDLE TYPING STOP
   */
  handleTypingStop(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;
    
    try {
      // Remove from typing users
      const typingUsers = this.typingUsers.get(roomId);
      if (typingUsers) {
        typingUsers.delete(userId);
        if (typingUsers.size === 0) {
          this.typingUsers.delete(roomId);
        }
      }

      // Notify others in room
      socket.to(roomId).emit('user_typing_stop', {
        userId,
        user: socket.user,
        roomId,
        timestamp: new Date().toISOString()
      });

      console.log(`⌨️ User ${socket.user.username} stopped typing in room ${roomId}`);
      
    } catch (error) {
      console.error('❌ Error handling typing stop:', error);
    }
  }

  /**
   * 😄 HANDLE ADD REACTION
   */
  async handleAddReaction(socket, data) {
    const { messageId, reaction, roomId } = data;
    const userId = socket.userId;
    
    try {
      // Add reaction logic here (would need reaction table)
      // For now, just broadcast the reaction
      
      socket.to(roomId).emit('reaction_added', {
        messageId,
        reaction,
        userId,
        user: socket.user,
        timestamp: new Date().toISOString()
      });

      console.log(`😄 Reaction ${reaction} added to message ${messageId} by ${socket.user.username}`);
      
    } catch (error) {
      console.error('❌ Error adding reaction:', error);
    }
  }

  /**
   * 😄 HANDLE REMOVE REACTION
   */
  async handleRemoveReaction(socket, data) {
    const { messageId, reaction, roomId } = data;
    const userId = socket.userId;
    
    try {
      // Remove reaction logic here
      
      socket.to(roomId).emit('reaction_removed', {
        messageId,
        reaction,
        userId,
        user: socket.user,
        timestamp: new Date().toISOString()
      });

      console.log(`😄 Reaction ${reaction} removed from message ${messageId} by ${socket.user.username}`);
      
    } catch (error) {
      console.error('❌ Error removing reaction:', error);
    }
  }

  /**
   * 🔌 HANDLE USER DISCONNECTION
   */
  handleDisconnection(socket) {
    const userId = socket.userId;
    const user = socket.user;
    
    if (!userId) return;
    
    try {
      // Remove from connected users
      this.connectedUsers.delete(userId);
      
      // Get user's rooms and notify others
      const userRooms = this.userRooms.get(userId) || new Set();
      
      for (const roomId of userRooms) {
        // Remove from typing users
        const typingUsers = this.typingUsers.get(roomId);
        if (typingUsers) {
          typingUsers.delete(userId);
          if (typingUsers.size === 0) {
            this.typingUsers.delete(roomId);
          }
        }
        
        // Notify others that user is offline
        socket.to(roomId).emit('user_offline', {
          userId,
          user,
          timestamp: new Date().toISOString()
        });
      }
      
      // Clean up user rooms
      this.userRooms.delete(userId);
      
      console.log(`🔌 User disconnected: ${user?.username || 'Unknown'} (${userId})`);
      
    } catch (error) {
      console.error('❌ Error handling disconnection:', error);
    }
  }

  /**
   * 📱 SEND PUSH NOTIFICATIONS
   * Send enhanced chat notifications to offline users with reply support
   */
  async sendPushNotifications(message, chatRoom) {
    try {
      const { getNotificationService } = require('../core');
      const notificationService = getNotificationService();
      
      // Get offline members (not currently connected)
      const offlineMembers = chatRoom.members.filter(member => 
        member.id !== message.senderId && 
        !this.connectedUsers.has(member.id) &&
        member.fcmTokens && member.fcmTokens.length > 0
      );

      // Determine if this is a group chat
      const isGroupChat = chatRoom.type === 'GROUP' || chatRoom.members.length > 2;

      for (const member of offlineMembers) {
        try {
          // ✅ ENHANCED: Use specialized chat notification method
          await notificationService.sendChatMessageNotification(member.id, {
            senderName: message.sender.firstName || message.sender.username,
            senderAvatar: message.sender.avatar,
            message: message.content,
            chatRoomId: chatRoom.id,
            messageId: message.id,
            roomName: chatRoom.name || (isGroupChat ? 'Group Chat' : 'Chat'),
            isGroupChat
          });
          
          console.log(`📱 Enhanced chat notification sent to ${member.username}`);
        } catch (error) {
          console.error(`❌ Failed to send chat notification to ${member.username}:`, error);
          
          // ✅ FALLBACK: Use generic notification if specialized method fails
          try {
            await notificationService.sendToUser(member.id, {
              title: `${message.sender.firstName || message.sender.username}`,
              body: message.content,
              type: 'CHAT_MESSAGE',
              actionData: {
                chatRoomId: chatRoom.id,
                messageId: message.id,
                senderId: message.senderId,
                senderName: message.sender.firstName || message.sender.username,
                roomName: chatRoom.name || 'Chat'
              },
              actions: [
                {
                  action: 'REPLY',
                  title: 'Reply',
                  type: 'input',
                  placeholder: 'Type a message...'
                },
                {
                  action: 'MARK_READ',
                  title: 'Mark as read'
                }
              ]
            });
            
            console.log(`📱 Fallback notification sent to ${member.username}`);
          } catch (fallbackError) {
            console.error(`❌ Fallback notification also failed for ${member.username}:`, fallbackError);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error sending push notifications:', error);
    }
  }

  /**
   * 🎯 GET CONNECTED USERS COUNT
   */
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  /**
   * 🎯 GET USER ONLINE STATUS
   */
  isUserOnline(userId) {
    return this.connectedUsers.has(userId);
  }

  /**
   * 🎯 GET ROOM ONLINE USERS
   */
  getRoomOnlineUsers(roomId) {
    const onlineUsers = [];
    for (const [userId, socketId] of this.connectedUsers) {
      const userRooms = this.userRooms.get(userId);
      if (userRooms && userRooms.has(roomId)) {
        onlineUsers.push(userId);
      }
    }
    return onlineUsers;
  }

  // ✅ REAL-TIME FEED HANDLERS

  /**
   * 📡 HANDLE JOIN FEED ROOM
   * User joins the global feed room for real-time updates
   */
  handleJoinFeedRoom(socket) {
    const userId = socket.userId;
    
    try {
      // Join the global feed room
      socket.join('feed_room');
      
      console.log(`📡 User ${userId} joined feed room`);
      
      // Track that user is in feed room
      let userRooms = this.userRooms.get(userId);
      if (!userRooms) {
        userRooms = new Set();
        this.userRooms.set(userId, userRooms);
      }
      userRooms.add('feed_room');
      
      // Notify user they joined feed room
      socket.emit('feed_room_joined', {
        message: 'Successfully joined feed room for real-time updates'
      });
      
    } catch (error) {
      console.error(`❌ Error joining feed room for user ${userId}:`, error);
      socket.emit('error', {
        type: 'FEED_JOIN_ERROR',
        message: 'Failed to join feed room'
      });
    }
  }

  /**
   * 📡 HANDLE LEAVE FEED ROOM
   * User leaves the global feed room
   */
  handleLeaveFeedRoom(socket) {
    const userId = socket.userId;
    
    try {
      // Leave the global feed room
      socket.leave('feed_room');
      
      console.log(`📡 User ${userId} left feed room`);
      
      // Remove from user rooms tracking
      const userRooms = this.userRooms.get(userId);
      if (userRooms) {
        userRooms.delete('feed_room');
      }
      
    } catch (error) {
      console.error(`❌ Error leaving feed room for user ${userId}:`, error);
    }
  }

  /**
   * 📝 HANDLE BROADCAST NEW POST
   * User created a new post, broadcast to others in feed room
   */
  handleBroadcastNewPost(socket, data) {
    const userId = socket.userId;
    
    try {
      console.log(`📝 Broadcasting new post from user ${userId}:`, data.id);
      
      // Broadcast to all users in feed room except the author
      socket.to('feed_room').emit('new_post', data);
      
    } catch (error) {
      console.error(`❌ Error broadcasting new post from user ${userId}:`, error);
    }
  }

  /**
   * ❤️ HANDLE BROADCAST POST LIKE
   * User liked/unliked a post, broadcast to others
   */
  handleBroadcastPostLike(socket, data) {
    const userId = socket.userId;
    
    try {
      console.log(`❤️ Broadcasting post ${data.isLiked ? 'like' : 'unlike'} from user ${userId}`);
      
      // Broadcast to all users in feed room
      const eventName = data.isLiked ? 'post_liked' : 'post_unliked';
      socket.to('feed_room').emit(eventName, {
        postId: data.postId,
        userId: userId,
      });
      
    } catch (error) {
      console.error(`❌ Error broadcasting post like from user ${userId}:`, error);
    }
  }

  /**
   * 💬 HANDLE BROADCAST NEW COMMENT
   * User commented on a post, broadcast to others
   */
  handleBroadcastNewComment(socket, data) {
    const userId = socket.userId;
    
    try {
      console.log(`💬 Broadcasting new comment from user ${userId} on post ${data.postId}`);
      
      // Broadcast to all users in feed room
      socket.to('feed_room').emit('post_commented', data);
      
    } catch (error) {
      console.error(`❌ Error broadcasting new comment from user ${userId}:`, error);
    }
  }
}

module.exports = ChatWebSocketService;