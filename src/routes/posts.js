const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { paginatedResponse } = require('../lib/response-formatters');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ REAL-TIME: Socket.IO instance for broadcasting feed events
let io = null;

// Function to set Socket.IO instance from server
function setSocketIO(socketInstance) {
  io = socketInstance;
  console.log('✅ Socket.IO instance set for posts routes');
}

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// @route   GET /api/posts
// @desc    Get posts feed
// @access  Private
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: { isActive: true },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          }
        }
      }
    }),
    prisma.post.count({ where: { isActive: true } })
  ]);

  // ✅ ENTERPRISE: Use standardized response format
  res.json(paginatedResponse(
    { posts },
    {
      page: parseInt(page),
      lastPage: Math.ceil(total / take),
      limit: take,
      total,
      hasNext: (parseInt(page) * take) < total,
      hasPrevious: parseInt(page) > 1
    },
    'Posts retrieved successfully'
  ));
}));

// @route   GET /api/posts/feed
// @desc    Get personalized feed based on following relationships (friend-to-friend)
// @access  Private
router.get('/feed', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);
  const currentUserId = req.user.id;

  console.log('🔍 FEED: Getting feed for user:', currentUserId);

  try {
    // Get users that current user follows (direct follows)
    const directFollows = await prisma.follow.findMany({
      where: { followerId: currentUserId },
      select: { followingId: true }
    });

    // Get users that direct follows are following (friend-to-friend)
    const friendToFriendFollows = await prisma.follow.findMany({
      where: {
        followerId: { in: directFollows.map(f => f.followingId) }
      },
      select: { followingId: true }
    });

    // Combine all user IDs: current user + direct follows + friend-to-friend
    const allUserIds = [
      currentUserId, // Include own posts
      ...directFollows.map(f => f.followingId),
      ...friendToFriendFollows.map(f => f.followingId)
    ];

    // Remove duplicates
    const uniqueUserIds = [...new Set(allUserIds)];

    console.log('📊 FEED: Direct follows:', directFollows.length);
    console.log('📊 FEED: Friend-to-friend follows:', friendToFriendFollows.length);
    console.log('📊 FEED: Total unique users in feed:', uniqueUserIds.length);

    // Get posts from all these users (only last 24 hours for feed)
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    console.log('🕐 FEED: Current time (UTC):', now.toISOString());
    console.log('🕐 FEED: Current time (Local):', now.toString());
    console.log('🕐 FEED: 24 hours ago cutoff (UTC):', twentyFourHoursAgo.toISOString());
    console.log('🕐 FEED: 24 hours ago cutoff (Local):', twentyFourHoursAgo.toString());
    
    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { 
          isActive: true,
          authorId: { in: uniqueUserIds },
          createdAt: { gte: twentyFourHoursAgo } // Only posts from last 24 hours
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              avatar: true,
              isVerified: true
            }
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            }
          },
          likes: {
            where: { userId: currentUserId },
            select: { id: true }
          }
        }
      }),
      prisma.post.count({ 
        where: { 
          isActive: true,
          authorId: { in: uniqueUserIds },
          createdAt: { gte: twentyFourHoursAgo } // Only posts from last 24 hours
        }
      })
    ]);

    // Transform posts to include isLiked status and proper media URLs
    const transformedPosts = posts.map(post => ({
      ...post,
      mediaUrl: post.type === 'VIDEO' ? post.videoUrl : post.imageUrl, // Map based on post type
      isLiked: post.likes.length > 0,
      likes: undefined // Remove likes array to keep response clean
    }));

    // Debug: Check each post's age
    posts.forEach(post => {
      const postAge = Date.now() - new Date(post.createdAt).getTime();
      const hoursAge = postAge / (1000 * 60 * 60);
      console.log(`📝 FEED: Post by ${post.author.firstName} ${post.author.lastName} - Age: ${hoursAge.toFixed(1)}h - Created: ${post.createdAt.toISOString()}`);
    });

    console.log('✅ FEED: Found', transformedPosts.length, 'posts');

    res.json(paginatedResponse(
      { posts: transformedPosts },
      {
        page: parseInt(page),
        lastPage: Math.ceil(total / take),
        limit: take,
        total,
        hasNext: (parseInt(page) * take) < total,
        hasPrevious: parseInt(page) > 1
      },
      'Feed retrieved successfully'
    ));

  } catch (error) {
    console.error('❌ FEED: Error getting feed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get feed',
      error: error.message
    });
  }
}));

// @route   GET /api/posts/user/:userId
// @desc    Get posts by specific user
// @access  Private
router.get('/user/:userId', authMiddleware, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);
  const currentUserId = req.user.id;
  const isOwnProfile = currentUserId === userId;

  console.log('🔍 Getting posts for user:', userId, '| Is own profile:', isOwnProfile);

  // Check if user exists and is active
  const targetUser = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: { id: true, username: true, firstName: true, lastName: true }
  });

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // For other users' profiles, only show posts from last 24 hours
  // For own profile, show all posts
  const whereClause = { 
    authorId: userId,
    isActive: true 
  };

  if (!isOwnProfile) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    whereClause.createdAt = { gte: twentyFourHoursAgo };
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: whereClause,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        likes: {
          select: {
            userId: true
          }
        },
        comments: {
          take: 3, // Get first 3 comments
          orderBy: { createdAt: 'desc' },
          include: {
            author: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatar: true,
              }
            }
          }
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          }
        }
      }
    }),
    prisma.post.count({ 
      where: whereClause 
    })
  ]);

  // Transform posts to match frontend expectations
  const transformedPosts = posts.map(post => ({
    id: post.id,
    authorId: post.author.id,
    authorName: `${post.author.firstName} ${post.author.lastName}`.trim() || post.author.username,
    authorPhoto: post.author.avatar,
    type: post.type.toLowerCase(), // Convert to lowercase for frontend
    content: post.content,
    mediaUrl: post.type === 'VIDEO' ? post.videoUrl : post.imageUrl, // Map based on post type
    locationName: post.locationName,
    latitude: post.latitude,
    longitude: post.longitude,
    musicTrack: post.musicTrack ? {
      id: post.musicTrack.spotifyTrackId || 'unknown',
      name: post.musicTrack.name,
      artist: post.musicTrack.artist,
      albumImageUrl: post.musicTrack.albumImageUrl,
      previewUrl: post.musicTrack.previewUrl || '',
      spotifyUrl: post.musicTrack.spotifyUrl || '',
      durationMs: post.musicTrack.durationMs || 0,
    } : null,
    createdAt: post.createdAt.toISOString(),
    likedBy: post.likes.map(like => like.userId),
    comments: post.comments.map(comment => ({
      id: comment.id,
      authorId: comment.author.id,
      authorName: `${comment.author.firstName} ${comment.author.lastName}`.trim() || comment.author.username,
      authorPhoto: comment.author.avatar,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
    })),
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
  }));

  console.log(`✅ Found ${posts.length} posts for user ${targetUser.username}`);

  res.json({
    success: true,
    data: {
      posts: transformedPosts,
      user: targetUser,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        hasNext: (parseInt(page) * take) < total,
        hasPrevious: parseInt(page) > 1,
        lastPage: Math.ceil(total / take)
      }
    }
  });
}));

// @route   GET /api/posts/:id
// @desc    Get single post by ID
// @access  Public
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  // Get user from auth header if present
  let currentUserId = null;
  try {
    const authHeader = req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      currentUserId = decoded.userId;
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }

  const post = await prisma.post.findUnique({
    where: { id, isActive: true },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          isVerified: true
        }
      },
      _count: {
        select: {
          likes: true,
          comments: true,
        }
      },
      likes: currentUserId ? {
        where: { 
          userId: currentUserId,
          type: 'POST'
        },
        select: { id: true }
      } : false
    }
  });

  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }

  // Transform post to include isLiked status
  const transformedPost = {
    ...post,
    isLiked: currentUserId ? post.likes.length > 0 : false,
    likes: undefined // Remove likes array to keep response clean
  };

  res.json({
    success: true,
    data: { post: transformedPost }
  });
}));

// @route   POST /api/posts
// @desc    Create new post
// @access  Private
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const { content, imageUrl, videoUrl, locationName, latitude, longitude, eventId, type = 'TEXT', musicTrack } = req.body;
  const userId = req.user.id; // From auth middleware

  const post = await prisma.post.create({
    data: {
      content,
      imageUrl,
      videoUrl,
      locationName,
      latitude,
      longitude,
      eventId,
      type,
      musicTrack,
      authorId: userId,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      _count: {
        select: {
          likes: true,
          comments: true,
        }
      }
    }
  });

  // ✅ REAL-TIME: Broadcast new post to all users in feed room
  if (io) {
    const broadcastData = {
      id: post.id,
      authorId: post.authorId,
      authorName: `${post.author.firstName} ${post.author.lastName}`.trim(),
      authorPhoto: post.author.avatar || '',
      type: post.type,
      content: post.content,
      mediaUrl: post.type === 'VIDEO' ? post.videoUrl : post.imageUrl,
      locationName: post.locationName,
      latitude: post.latitude,
      longitude: post.longitude,
      musicTrack: post.musicTrack ? {
        id: post.musicTrack.spotifyTrackId || 'unknown',
        name: post.musicTrack.name,
        artist: post.musicTrack.artist,
        albumImageUrl: post.musicTrack.albumImageUrl,
        previewUrl: post.musicTrack.previewUrl || '',
        spotifyUrl: post.musicTrack.spotifyUrl || '',
        durationMs: post.musicTrack.durationMs || 0,
      } : null,
      createdAt: post.createdAt.toISOString(),
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: false, // New post, not liked by anyone yet
    };
    
    // Broadcast to all users in the global feed room (except the author)
    io.to('feed_room').except(`user_${userId}`).emit('new_post', broadcastData);
    console.log(`📡 REAL-TIME: Broadcasted new post ${post.id} to feed room`);
  }

  res.status(201).json({
    success: true,
    message: 'Post created successfully',
    data: { post }
  });
}));

// @route   POST /api/posts/:id/like
// @desc    Like/Unlike post
// @access  Private
router.post('/:id/like', authMiddleware, asyncHandler(async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.user.id;

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId, isActive: true }
  });

  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }

  // Check if user already liked this post
  const existingLike = await prisma.like.findFirst({
    where: {
      userId,
      postId,
      type: 'POST'
    }
  });

  if (existingLike) {
    // Unlike - remove the like
    await prisma.like.delete({
      where: { id: existingLike.id }
    });

    // ✅ REAL-TIME: Broadcast post unlike to feed room
    if (io) {
      io.to('feed_room').emit('post_unliked', {
        postId: postId,
        userId: userId,
      });
      console.log(`📡 REAL-TIME: Broadcasted post unlike ${postId}`);
    }

    res.json({
      success: true,
      message: 'Post unliked successfully',
      data: { liked: false }
    });
  } else {
    // Like - add the like
    await prisma.like.create({
      data: {
        userId,
        postId,
        type: 'POST'
      }
    });

    // ✅ REAL-TIME: Broadcast post like to feed room
    if (io) {
      io.to('feed_room').emit('post_liked', {
        postId: postId,
        userId: userId,
      });
      console.log(`📡 REAL-TIME: Broadcasted post like ${postId}`);
    }

    res.json({
      success: true,
      message: 'Post liked successfully',
      data: { liked: true }
    });
  }
}));

// @route   DELETE /api/posts/:id
// @desc    Delete post
// @access  Private
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const post = await prisma.post.findUnique({
    where: { id, isActive: true }
  });

  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }

  // Check if user owns this post
  if (post.authorId !== userId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only delete your own posts.'
    });
  }

  // Soft delete
  await prisma.post.update({
    where: { id },
    data: { isActive: false }
  });

  res.json({
    success: true,
    message: 'Post deleted successfully'
  });
}));

// @route   POST /api/posts/:id/report
// @desc    Report a post (any user can report any post)
// @access  Private
router.post('/:id/report', authMiddleware, asyncHandler(async (req, res) => {
  const { id: postId } = req.params;
  const userId = req.user.id;
  const { reason } = req.body || {};

  // Ensure post exists and active
  const post = await prisma.post.findUnique({ where: { id: postId, isActive: true } });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  // Upsert report (unique by postId + reporterId)
  let report;
  try {
    report = await prisma.postReport.upsert({
      where: { postId_reporterId: { postId: postId, reporterId: userId } },
      update: { reason: reason ?? 'Inappropriate', updatedAt: new Date() },
      create: {
        postId: postId,
        reporterId: userId,
        reason: reason ?? 'Inappropriate',
      },
    });
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Failed to report post' });
  }

  return res.json({ success: true, message: 'Report submitted', data: report });
}));

// @route   POST /api/posts/:id/share
// @desc    Record a share action (optional analytics)
// @access  Private
router.post('/:id/share', authMiddleware, asyncHandler(async (req, res) => {
  const { id: postId } = req.params;

  // Validate post exists
  const post = await prisma.post.findUnique({ where: { id: postId, isActive: true } });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Post not found' });
  }

  // For now, just acknowledge share (could persist analytics later)
  return res.json({ success: true, message: 'Share recorded' });
}));

// @route   GET /api/posts/:id/comments
// @desc    Get post comments (with hierarchy support)
// @access  Private
router.get('/:id/comments', authMiddleware, asyncHandler(async (req, res) => {
  const { id: postId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId, isActive: true }
  });

  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where: { postId },
      skip,
      take,
      orderBy: [
        { parentId: 'asc' }, // Main comments first (parentId null), then replies
        { createdAt: 'asc' }  // Chronological order within each group
      ],
      include: {
        author: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    }),
    prisma.comment.count({ where: { postId } })
  ]);

  res.json(paginatedResponse(comments, {
    page: parseInt(page),
    limit: parseInt(limit),
    total
  }));
}));

// @route   POST /api/posts/:id/comments
// @desc    Add comment to post (with optional parentId for replies)
// @access  Private
router.post('/:id/comments', authMiddleware, asyncHandler(async (req, res) => {
  const { id: postId } = req.params;
  const { content, parentId } = req.body;
  const userId = req.user.id;

  // Validate content
  if (!content || content.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Comment content is required'
    });
  }

  if (content.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: 'Comment content cannot exceed 500 characters'
    });
  }

  // Check if post exists
  const post = await prisma.post.findUnique({
    where: { id: postId, isActive: true }
  });

  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }

  // If parentId is provided, validate that the parent comment exists
  if (parentId) {
    const parentComment = await prisma.comment.findUnique({
      where: { id: parentId }
    });

    if (!parentComment) {
      return res.status(400).json({
        success: false,
        message: 'Parent comment not found'
      });
    }

    // Ensure the parent comment belongs to the same post
    if (parentComment.postId !== postId) {
      return res.status(400).json({
        success: false,
        message: 'Parent comment does not belong to this post'
      });
    }
  }

  // Create comment with optional parentId
  const comment = await prisma.comment.create({
    data: {
      content: content.trim(),
      authorId: userId,
      postId: postId,
      parentId: parentId || null
    },
    include: {
      author: {
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

  // ✅ REAL-TIME: Broadcast new comment to feed room
  if (io) {
    const commentData = {
      id: comment.id,
      content: comment.content,
      authorId: comment.authorId,
      authorName: `${comment.author.firstName} ${comment.author.lastName}`.trim(),
      authorPhoto: comment.author.avatar || '',
      parentId: comment.parentId,
      createdAt: comment.createdAt.toISOString(),
    };

    io.to('feed_room').emit('post_commented', {
      postId: postId,
      comment: commentData,
    });
    console.log(`📡 REAL-TIME: Broadcasted new comment on post ${postId}`);
  }

  res.status(201).json({
    success: true,
    message: parentId ? 'Reply added successfully' : 'Comment added successfully',
    data: comment
  });
}));

// @route   DELETE /api/posts/comments/:commentId
// @desc    Delete comment
// @access  Private
router.delete('/comments/:commentId', authMiddleware, asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.id;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId }
  });

  if (!comment) {
    return res.status(404).json({
      success: false,
      message: 'Comment not found'
    });
  }

  // Check if user owns this comment
  if (comment.authorId !== userId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only delete your own comments.'
    });
  }

  // Hard delete (since no isActive field in Comment model)
  await prisma.comment.delete({
    where: { id: commentId }
  });

  res.json({
    success: true,
    message: 'Comment deleted successfully'
  });
}));

// @route   POST /api/posts/test-video
// @desc    Create test video post for debugging
// @access  Private
router.post('/test-video', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const testVideoUrl = req.body.videoUrl || 'https://flutter.github.io/assets-for-api-docs/assets/videos/bee.mp4';

  const post = await prisma.post.create({
    data: {
      content: 'Test video post from backend',
      videoUrl: testVideoUrl,
      type: 'VIDEO',
      authorId: userId,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      _count: {
        select: {
          likes: true,
          comments: true,
        }
      }
    }
  });

  // Transform for frontend compatibility
  const transformedPost = {
    id: post.id,
    authorId: post.author.id,
    authorName: `${post.author.firstName} ${post.author.lastName}`.trim() || post.author.username,
    authorPhoto: post.author.avatar,
    type: post.type.toLowerCase(),
    content: post.content,
    mediaUrl: post.videoUrl, // For video posts, map videoUrl to mediaUrl
    locationName: post.locationName,
    latitude: post.latitude,
    longitude: post.longitude,
    likesCount: post._count.likes,
    commentsCount: post._count.comments,
    isLiked: false,
    comments: [],
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };

  res.status(201).json({
    success: true,
    message: 'Test video post created successfully',
    data: { post: transformedPost }
  });
}));

module.exports = router;
module.exports.setSocketIO = setSocketIO; 

