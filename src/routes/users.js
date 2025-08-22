const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { getNotificationService } = require('../services/core');
const { successResponse, paginatedResponse, errorResponse } = require('../lib/response-formatters');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');
const { organizerSelect } = require('../lib/user-selectors');

// ✅ PRODUCTION: Enterprise caching for user data
const { 
  userCaching, 
  cacheInvalidation 
} = require('../middleware/enterprise-caching');

// 📊 Helper function to calculate user stats consistently
const calculateUserStats = async (userId, baseCounts) => {
  const [eventsAttended, upcomingEvents] = await Promise.all([
    // Count confirmed bookings for past events (events attended)
    prisma.booking.count({
      where: {
        userId: userId,
        status: 'CONFIRMED',
        event: {
          startDate: { lt: new Date() }
        }
      }
    }),
    // Count confirmed bookings for future events (upcoming events)
    prisma.booking.count({
      where: {
        userId: userId,
        status: 'CONFIRMED',
        event: {
          startDate: { gte: new Date() }
        }
      }
    })
  ]);

  return {
    eventsCount: eventsAttended + upcomingEvents, // Total events (attended + upcoming)
    followersCount: baseCounts.followers,
    followingCount: baseCounts.follows,
    postsCount: baseCounts.posts,
  };
};


// @route   GET /api/users
// @desc    Get paginated list of users (for CMS)
// @access  Private (Admin only)
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    search = '', 
    role = '' 
  } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  // Build where clause
  const where = {
    isActive: true,
    ...(search && {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        // Search by artist profile name if exists
        { 
          artistProfile: {
            name: { contains: search, mode: 'insensitive' }
          }
        }
      ]
    }),
    ...(role && { role: role.toUpperCase() })
  };

  // Get users with count
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        bio: true,
        city: true,
        country: true,
        dateOfBirth: true,
        gender: true,
        favoriteGenres: true,
        points: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        isVerified: true,
        isActive: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        // Include artist profile for ARTIST role users
        artistProfile: {
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            genres: true,
            country: true,
            city: true,
            isVerified: true,
            followersCount: true,
          }
        }
      },
      orderBy: [
        // Prioritize users with artist profile for ARTIST role
        ...(role === 'ARTIST' ? [{ artistProfile: { name: 'asc' } }] : []),
        { createdAt: 'desc' }
      ],
      skip: offset,
      take: limitNum,
    }),
    prisma.user.count({ where })
  ]);

  // For ARTIST role users, also check Artist table for fallback
  let artistsMap = new Map();
  if (role === 'ARTIST' || (role === '' && search)) {
    const artistUsers = users.filter(u => u.role === 'ARTIST');
    if (artistUsers.length > 0) {
      const userIds = artistUsers.map(u => u.id);
      const artists = await prisma.artist.findMany({
        where: {
          userId: { in: userIds },
          isActive: true
        },
        select: {
          userId: true,
          name: true,
          imageUrl: true,
          genres: true,
          city: true,
          country: true,
          isVerified: true,
          followersCount: true,
        }
      });
      
      // Create map for quick lookup
      artists.forEach(artist => {
        if (artist.userId) {
          artistsMap.set(artist.userId, artist);
        }
      });
    }
  }

  // Transform users to match CMS interface
  const transformedUsers = users.map(user => {
    // Get artist data from Artist table (priority over artistProfile relation)
    const artistData = artistsMap.get(user.id);
    
    // For ARTIST role: prioritize Artist table data, then artistProfile, then username
    const displayName = user.role === 'ARTIST' 
      ? (artistData?.name || user.artistProfile?.name || user.username)
      : user.username;
    
    // For ARTIST role: use Artist table image, then artistProfile image, then user avatar
    const displayImage = user.role === 'ARTIST' 
      ? (artistData?.imageUrl || user.artistProfile?.imageUrl || user.avatar)
      : user.avatar;

    // ✅ BACKWARD COMPATIBILITY: Override firstName/lastName with artist name for ARTIST role
    let firstName, lastName;
    if (user.role === 'ARTIST') {
      // Priority: Artist table → artistProfile → username
      const artistName = artistData?.name || user.artistProfile?.name || user.username;
      firstName = artistName;
      lastName = ''; // Always empty to avoid confusion in CMS
    } else {
      // Use original names for non-ARTIST users
      firstName = user.firstName;
      lastName = user.lastName;
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName, // ✅ NEW: Smart display name (artist name or username)
      firstName, // ✅ UPDATED: Artist name if available, otherwise original firstName
      lastName, // ✅ UPDATED: Artist name remainder if available, otherwise original lastName
      phone: user.phone,
      avatar: user.avatar,
      displayImage, // ✅ NEW: Smart display image (artist image or user avatar)
      bio: user.bio,
      city: user.city,
      country: user.country,
      dateOfBirth: user.dateOfBirth?.toISOString(),
      gender: user.gender,
      favoriteGenres: user.favoriteGenres || [],
      points: user.points || 0,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      isVerified: user.isVerified,
      isActive: user.isActive,
      role: user.role, // Keep original case for frontend enum matching
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      // ✅ NEW: Include artist profile data for ARTIST role
              artistProfile: user.artistProfile,
        hasArtistProfile: !!(artistData || user.artistProfile), // ✅ NEW: Quick check flag (includes Artist table)
        
        // ✅ DEBUG INFO: Artist data source
        _debug: {
          fromArtistTable: !!artistData,
          fromArtistProfile: !!user.artistProfile,
          artistTableName: artistData?.name,
          artistProfileName: user.artistProfile?.name,
          finalDisplayName: displayName,
        }
      };
    });

  const totalPages = Math.ceil(total / limitNum);

  res.json({
    success: true,
    data: {
      users: transformedUsers,
      total,
      pages: totalPages
    }
  });
}));

// @route   POST /api/users
// @desc    Create new user (for CMS)
// @access  Private (Admin only)
router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const { 
    email, 
    username, 
    password, 
    firstName, 
    lastName, 
    phone, 
    bio, 
    city, 
    country, 
    role = 'USER',
    isActive = true 
  } = req.body;

  // Validate required fields
  if (!email || !username || !password) {
    throw new AppError('Email, username, and password are required', 400);
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() }
      ]
    }
  });

  if (existingUser) {
    if (existingUser.email.toLowerCase() === email.toLowerCase()) {
      throw new AppError('Email already exists', 409);
    }
    if (existingUser.username.toLowerCase() === username.toLowerCase()) {
      throw new AppError('Username already exists', 409);
    }
  }

  // Hash password
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const newUser = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      password: hashedPassword,
      firstName: firstName || '',
      lastName: lastName || '',
      phone: phone || '',
      bio: bio || '',
      city: city || '',
      country: country || '',
      role: role.toUpperCase(),
      isActive,
      isEmailVerified: false,
      isPhoneVerified: false,
      isVerified: false,
      favoriteGenres: [],
      points: 0
    },
    select: {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      phone: true,
      bio: true,
      city: true,
      country: true,
      role: true,
      isActive: true,
      isVerified: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      favoriteGenres: true,
      points: true,
      createdAt: true,
      updatedAt: true,
    }
  });

  // Transform response to match CMS expectations
  const transformedUser = {
    id: newUser.id,
    email: newUser.email,
    username: newUser.username,
    firstName: newUser.firstName,
    lastName: newUser.lastName,
    phone: newUser.phone,
    bio: newUser.bio,
    city: newUser.city,
    country: newUser.country,
    role: newUser.role,
    isActive: newUser.isActive,
    isVerified: newUser.isVerified,
    isEmailVerified: newUser.isEmailVerified,
    isPhoneVerified: newUser.isPhoneVerified,
    favoriteGenres: newUser.favoriteGenres,
    points: newUser.points,
    createdAt: newUser.createdAt.toISOString(),
    updatedAt: newUser.updatedAt.toISOString(),
  };

  res.status(201).json({
    success: true,
    data: transformedUser,
    message: 'User created successfully'
  });
}));

// @route   GET /api/users/payment-history
// @desc    Get user's payment history with support for Continue Payment
// @access  Private
router.get('/payment-history', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, status = '' } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  // Build where clause
  const where = {
    userId,
    ...(status && { status: status.toUpperCase() })
  };

  console.log(`📋 Getting payment history for user ${userId}, page ${pageNum}, limit ${limitNum}`);

  try {
    // Get payment history with pagination
    const [paymentHistory, total] = await Promise.all([
      prisma.paymentHistory.findMany({
        where,
        include: {
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
              location: true
            }
          }
        },
        orderBy: { transactionDate: 'desc' },
        skip: offset,
        take: limitNum,
      }),
      prisma.paymentHistory.count({ where })
    ]);

    // Transform payment history to match frontend PaymentHistoryModel
    const transformedHistory = paymentHistory.map(payment => ({
      id: payment.id,
      eventName: payment.eventName || payment.event?.title || 'Unknown Event',
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status.toLowerCase(), // Convert to lowercase for frontend enum
      paymentMethod: payment.paymentMethod,
      transactionDate: payment.transactionDate.toISOString(),
      ticketType: payment.ticketType || 'General Admission',
      imageUrl: payment.imageUrl || payment.event?.imageUrl || '/images/default-event.jpg',
      // Additional fields for Continue Payment
      bookingCode: payment.bookingCode,
      paymentUrl: payment.paymentUrl,
      eventId: payment.eventId,
    }));

    const totalPages = Math.ceil(total / limitNum);

    // ✅ ENTERPRISE: Use standardized response format
    res.json(paginatedResponse(
      { paymentHistory: transformedHistory },
      {
        page: pageNum,
        lastPage: totalPages,
        limit: limitNum,
        total,
        hasNext: offset + limitNum < total,
        hasPrevious: pageNum > 1
      },
      'Payment history retrieved successfully'
    ));

    console.log(`✅ Payment history retrieved: ${transformedHistory.length} records`);

  } catch (error) {
    console.error('❌ Error getting payment history:', error);
    throw new AppError('Failed to retrieve payment history', 500);
  }
}));

// @route   GET /api/users/mutual-followers
// @desc    Get mutual followers for transfer access
// @access  Private
router.get('/mutual-followers', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // Step 1: IDs that current user follows (A)
  const following = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });

  // Step 2: IDs that follow current user (B)
  const followers = await prisma.follow.findMany({
    where: { followingId: userId },
    select: { followerId: true },
  });

  const followingIds = new Set(following.map((f) => f.followingId));
  const followerIds = new Set(followers.map((f) => f.followerId));

  // Intersection A ∩ B = mutual
  const mutualIds = [...followingIds].filter((id) => followerIds.has(id));

  if (mutualIds.length === 0) {
    return res.json({ success: true, data: [] });
  }

  // Step 3: Fetch user profiles for mutual IDs
  const users = await prisma.user.findMany({
    where: { id: { in: mutualIds }, isActive: true },
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      avatar: true,
      isVerified: true,
    },
    orderBy: [
      { isVerified: 'desc' },
      { firstName: 'asc' },
    ],
    take: 50,
  });

  const mutualFollowers = users.map((user) => ({
    username: user.username,
    displayName:
      (user.firstName || '') + (user.lastName ? ` ${user.lastName}` : ''),
    profileImage: user.avatar || '',
    isMutual: true,
    isVerified: user.isVerified || false,
  }));

  res.json({ success: true, data: mutualFollowers });
}));

// @route   GET /api/users/:id
// @desc    Get user profile by ID
// @access  Private
router.get('/:id', 
  authMiddleware, 
  userCaching.profile, // ✅ CACHE: Cache user profiles for performance
  asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  console.log('🔍 GET /api/users/:id - Request for user ID:', id);

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatar: true,
      bio: true,
      city: true,
      country: true,
      dateOfBirth: true,
      gender: true,
      favoriteGenres: true,
      points: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      isVerified: true,
      isActive: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          followers: true,
          follows: true,
          events: true,
          posts: true,
        }
      }
    }
  });

  if (!user) {
    console.log('❌ User not found with ID:', id);
    throw new AppError('User not found', 404);
  }
  
  console.log('✅ Found user:', user.username);

  // Transform response to match frontend expectations
  const transformedUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    avatar: user.avatar,
    bio: user.bio,
    city: user.city,
    country: user.country,
    dateOfBirth: user.dateOfBirth?.toISOString(),
    gender: user.gender,
    favoriteGenres: user.favoriteGenres || [],
    points: user.points || 0,
    role: user.role,
    isVerified: user.isVerified,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    stats: await calculateUserStats(user.id, user._count)
  };

  // ✅ Apply timestamp localization to fix dateOfBirth parsing issue
  const { localizeTimestamps } = require('../utils/time-helpers');
  
  // ✅ Apply timestamp localization to convert all dates to strings (including dateOfBirth)
  const localizedUser = localizeTimestamps(transformedUser);
  
  res.json({
    success: true,
    data: localizedUser
  });
}));

// @route   POST /api/users/:id/follow
// @desc    Follow/unfollow user
// @access  Private
router.post('/:id/follow', authMiddleware, asyncHandler(async (req, res) => {
  const { id: targetUserId } = req.params;
  const currentUserId = req.user.id;

  if (targetUserId === currentUserId) {
    throw new AppError('Cannot follow yourself', 400);
  }

  // Check if target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId, isActive: true }
  });

  if (!targetUser) {
    throw new AppError('User not found', 404);
  }

  // Check if already following
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: currentUserId,
        followingId: targetUserId
      }
    }
  });

  if (existingFollow) {
    // Unfollow
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: targetUserId
        }
      }
    });

    // ✅ CACHE: Invalidate user stats caches after unfollow
    await cacheInvalidation.invalidateUser(req.user.id);
    await cacheInvalidation.invalidateUser(targetUserId);
    
    res.json({
      success: true,
      message: 'Unfollowed successfully',
      data: { isFollowing: false }
    });
  } else {
    // Follow
    await prisma.follow.create({
      data: {
        followerId: currentUserId,
        followingId: targetUserId
      }
    });

    // ✅ CACHE: Invalidate user stats caches after follow
    await cacheInvalidation.invalidateUser(req.user.id);
    await cacheInvalidation.invalidateUser(targetUserId);
    
    res.json({
      success: true,
      message: 'Followed successfully',
      data: { isFollowing: true }
    });
  }
}));


// @route   GET /api/users/:id/followers
// @desc    Get user followers
// @access  Private
router.get('/:id/followers', 
  authMiddleware, 
  userCaching.stats, // ✅ CACHE: Cache followers lists for performance
  asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 12, search } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const userFilter = search ? {
    OR: [
      { username: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ]
  } : {};

  const [followers, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followingId: id, follower: userFilter },
      skip,
      take,
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            isVerified: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.follow.count({ where: { followingId: id, follower: userFilter } })
  ]);

  res.json({
    success: true,
    data: {
      followers: followers.map(f => f.follower),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   GET /api/users/:id/following
// @desc    Get user following (users they follow)
// @access  Private
router.get('/:id/following', 
  authMiddleware, 
  userCaching.stats, // ✅ CACHE: Cache following lists for performance
  asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 12, search } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const userFilter = search ? {
    OR: [
      { username: { contains: search, mode: 'insensitive' } },
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
    ]
  } : {};

  const [following, total] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: id, following: userFilter },
      skip,
      take,
      include: {
        following: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            isVerified: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.follow.count({ where: { followerId: id, following: userFilter } })
  ]);

  res.json({
    success: true,
    data: {
      following: following.map(f => f.following),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   POST /api/users/verify-password
// @desc    Verify user password for sensitive operations
// @access  Private
router.post('/verify-password', authMiddleware, asyncHandler(async (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    throw new AppError('Password is required', 400);
  }
  
  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, password: true }
  });
  
  if (!user) {
    throw new AppError('User not found', 404);
  }
  
  // Verify password (assuming bcrypt is used)
  const bcrypt = require('bcryptjs');
  const isValidPassword = await bcrypt.compare(password, user.password);
  
  if (!isValidPassword) {
    throw new AppError('Invalid password', 401);
  }
  
  res.json({
    success: true,
    message: 'Password verified successfully'
  });
}));

// @route   GET /api/users/:id/events/attended
// @desc    Get user's event history (all past events with confirmed bookings)
// @access  Private
router.get('/:id/events/attended', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  console.log(`🔍 DEBUG: Fetching attended events for user ${id}`);

  const [events, total] = await Promise.all([
    prisma.booking.findMany({
      where: {
        userId: id,
        status: 'CONFIRMED',
        event: {
          startDate: { lt: new Date() } // Past events only
        }
      },
      skip,
      take,
      include: {
        event: {
          include: {
            venue: {
              select: {
                id: true,
                name: true,
                address: true,
              }
            },
            artists: {
              include: {
                artist: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { event: { startDate: 'desc' } }
    }),
    prisma.booking.count({
      where: {
        userId: id,
        status: 'CONFIRMED',
        event: {
          startDate: { lt: new Date() }
        }
      }
    })
  ]);

  console.log(`🔍 DEBUG: Found ${events.length} attended events for user ${id}`);

  res.json({
    success: true,
    data: {
      events: events.map(booking => booking.event),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   GET /api/users/:id/events/upcoming
// @desc    Get user's upcoming events (future events with confirmed bookings)
// @access  Private
router.get('/:id/events/upcoming', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  console.log(`🔍 DEBUG: Fetching upcoming events for user ${id}`);

  const [events, total] = await Promise.all([
    prisma.booking.findMany({
      where: {
        userId: id,
        status: 'CONFIRMED',
        event: {
          startDate: { gte: new Date() } // Future events only
        }
      },
      skip,
      take,
      include: {
        event: {
          include: {
            venue: {
              select: {
                id: true,
                name: true,
                address: true,
              }
            },
            artists: {
              include: {
                artist: {
                  select: {
                    id: true,
                    name: true,
                    imageUrl: true,
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { event: { startDate: 'asc' } }
    }),
    prisma.booking.count({
      where: {
        userId: id,
        status: 'CONFIRMED',
        event: {
          startDate: { gte: new Date() }
        }
      }
    })
  ]);

  console.log(`🔍 DEBUG: Found ${events.length} upcoming events for user ${id}`);

  res.json({
    success: true,
    data: {
      events: events.map(booking => booking.event),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   PUT /api/users/:id
// @desc    Update user (for CMS)
// @access  Private (Admin only)
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { email, username, name, role, isActive } = req.body;

  // Split name into firstName and lastName if provided
  let firstName, lastName;
  if (name) {
    const nameParts = name.trim().split(' ');
    firstName = nameParts[0] || '';
    lastName = nameParts.slice(1).join(' ') || '';
  }

  // Build update data
  const updateData = {};
  if (email) updateData.email = email;
  if (username) updateData.username = username;
  if (firstName !== undefined) updateData.firstName = firstName;
  if (lastName !== undefined) updateData.lastName = lastName;
  if (role) updateData.role = role.toUpperCase();
  if (typeof isActive === 'boolean') updateData.isActive = isActive;

  const updatedUser = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      isVerified: true,
      createdAt: true,
      updatedAt: true,
    }
  });

  // Transform response to match CMS expectations
  const transformedUser = {
    id: updatedUser.id,
    email: updatedUser.email,
    username: updatedUser.username,
    name: `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() || updatedUser.username,
    role: updatedUser.role.toLowerCase(),
    isActive: updatedUser.isActive,
    createdAt: updatedUser.createdAt.toISOString(),
    updatedAt: updatedUser.updatedAt.toISOString(),
  };

  res.json({
    success: true,
    data: transformedUser,
    message: 'User updated successfully'
  });
}));

// @route   DELETE /api/users/:id
// @desc    Delete user (for CMS)
// @access  Private (Admin only)
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Soft delete by setting isActive to false
  await prisma.user.update({
    where: { id },
    data: { isActive: false }
  });

  res.json({
    success: true,
    message: 'User deleted successfully'
  });
}));

// @route   POST /api/users/fcm-token
// @desc    Register FCM token for push notifications
// @access  Private
router.post('/fcm-token', authMiddleware, asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user.id;

  if (!fcmToken) {
    throw new AppError('FCM token is required', 400);
  }

  console.log(`📱 Registering FCM token for user ${userId}`);

      const notificationService = getNotificationService();
    const success = await notificationService.registerToken(userId, fcmToken);

  // ✅ ENTERPRISE: Use standardized response format
  res.json(successResponse(
    success ? 'FCM token registered successfully' : 'FCM token already registered',
    { registered: success }
  ));
}));

// @route   DELETE /api/users/fcm-token
// @desc    Unregister FCM token
// @access  Private
router.delete('/fcm-token', authMiddleware, asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user.id;

  if (!fcmToken) {
    throw new AppError('FCM token is required', 400);
  }

  console.log(`📱 Unregistering FCM token for user ${userId}`);

      const notificationService = getNotificationService();
    const success = await notificationService.unregisterToken(userId, fcmToken);

  // ✅ ENTERPRISE: Use standardized response format  
  res.json(successResponse(
    'FCM token unregistered successfully',
    { unregistered: success }
  ));
}));

// @route   GET /api/users/notifications
// @desc    Get user's notification history
// @access  Private
router.get('/notifications', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, unreadOnly = false } = req.query;
  
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const offset = (pageNum - 1) * limitNum;

  const where = {
    userId,
    ...(unreadOnly === 'true' && { isRead: false })
  };

  console.log(`📋 Getting notifications for user ${userId}`);

  try {
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limitNum,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ 
        where: { userId, isRead: false } 
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // ✅ ENTERPRISE: Use standardized response format
    res.json(paginatedResponse(
      { 
        notifications, 
        unreadCount 
      },
      {
        page: pageNum,
        lastPage: totalPages,
        limit: limitNum,
        total,
        hasNext: offset + limitNum < total,
        hasPrevious: pageNum > 1
      },
      'Notifications retrieved successfully'
    ));

    console.log(`✅ Notifications retrieved: ${notifications.length} records`);

  } catch (error) {
    console.error('❌ Error getting notifications:', error);
    throw new AppError('Failed to retrieve notifications', 500);
  }
}));

// @route   PUT /api/users/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/notifications/:id/read', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const notification = await prisma.notification.findFirst({
    where: { id, userId }
  });

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  await prisma.notification.update({
    where: { id },
    data: { isRead: true }
  });

  // ✅ ENTERPRISE: Use standardized response format
  res.json(successResponse('Notification marked as read'));
}));

// @route   PUT /api/users/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put('/notifications/read-all', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });

  res.json({
    success: true,
    message: `${result.count} notifications marked as read`
  });
}));

// @route   GET /api/users/me/favorite-events
// @desc    Get user's favorite events
// @access  Private
router.get('/me/favorite-events', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const userId = req.user.id;
  
  const take = Math.min(parseInt(limit), 50);
  const skip = (parseInt(page) - 1) * take;

  console.log(`🔍 [API] Fetching favorite events for user: ${userId}`);
  
  const favorites = await prisma.userEventFavorite.findMany({
    where: { userId },
    include: {
      event: {
        include: {
          organizer: { select: organizerSelect },
          venue: true,
          artists: { include: { artist: true } },
          _count: {
            select: {
              accessTickets: true,
              bookings: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take,
    skip
  });
  
  console.log(`🔍 [API] Found ${favorites.length} favorite events for user ${userId}`);

  const total = await prisma.userEventFavorite.count({
    where: { userId }
  });

  const events = favorites.map(fav => fav.event);
  
  console.log(`🔍 [API] Returning ${events.length} events in response`);
  console.log(`🔍 [API] Sample event structure:`, events[0] ? Object.keys(events[0]) : 'No events');
  
  res.json({
    success: true,
    data: {
      events,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take
      }
    },
    message: 'User favorite events retrieved successfully'
  });
}));

// @route   GET /api/users/artists-for-lineup
// @desc    Get list of ARTIST role users for lineup selection (CMS)
// @access  Private (Admin/Organizer)
router.get('/artists-for-lineup', authMiddleware, requireRole(['ADMIN', 'ORGANIZER']), asyncHandler(async (req, res) => {
  const { 
    search = '', 
    limit = 50 
  } = req.query;

  const limitNum = Math.min(100, parseInt(limit)); // Max 100 untuk performance

  // Build where clause for ARTIST role users
  const where = {
    isActive: true,
    role: 'ARTIST',
    ...(search && {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        // Search by artist profile name if exists
        { 
          artistProfile: {
            name: { contains: search, mode: 'insensitive' }
          }
        }
      ]
    })
  };

  // Get ARTIST users with their artist profiles
  const artists = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      avatar: true,
      city: true,
      country: true,
      isVerified: true,
      role: true,
      // Include artist profile for enhanced display
      artistProfile: {
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          genres: true,
          country: true,
          city: true,
          isVerified: true,
          followersCount: true,
        }
      }
    },
    orderBy: [
      // Users with artist profile first (they have complete setup)
      { artistProfile: { name: 'asc' } },
      // Then by username for users without artist profile
      { username: 'asc' }
    ],
    take: limitNum,
  });

  // Also get Artist table data for these users
  const userIds = artists.map(u => u.id);
  const artistTableData = await prisma.artist.findMany({
    where: {
      userId: { in: userIds },
      isActive: true
    },
    select: {
      userId: true,
      name: true,
      imageUrl: true,
      genres: true,
      city: true,
      country: true,
      isVerified: true,
      followersCount: true,
    }
  });

  // Create map for quick lookup
  const artistTableMap = new Map();
  artistTableData.forEach(artist => {
    if (artist.userId) {
      artistTableMap.set(artist.userId, artist);
    }
  });

  // Transform for CMS lineup selection
  const artistsForLineup = artists.map(user => {
    // Get artist data from Artist table (priority over artistProfile relation)
    const artistTableData = artistTableMap.get(user.id);
    
    // Smart display logic: prioritize Artist table, then artistProfile, then username
    const displayName = artistTableData?.name || user.artistProfile?.name || user.username;
    const displayImage = artistTableData?.imageUrl || user.artistProfile?.imageUrl || user.avatar;
    const displayBio = artistTableData?.description || user.artistProfile?.description || `${user.firstName || ''} ${user.lastName || ''}`.trim();

    // For backward compatibility with CMS: use artist name from Artist table
    let firstName, lastName;
    // Priority: Artist table → artistProfile → username
    const artistName = artistTableData?.name || user.artistProfile?.name || user.username;
    firstName = artistName;
    lastName = ''; // Always empty to avoid confusion in CMS

    return {
      // User data for linking
      userId: user.id,
      username: user.username,
      
      // Artist profile data (if exists)
      artistId: user.artistProfile?.id || null,
      
      // ✅ BACKWARD COMPATIBILITY: Override firstName/lastName with artist name
      firstName,
      lastName,
      
      // Display data (prioritized)
      displayName,
      displayImage,
      displayBio,
      city: artistTableData?.city || user.artistProfile?.city || user.city,
      country: artistTableData?.country || user.artistProfile?.country || user.country,
      genres: artistTableData?.genres || user.artistProfile?.genres || [],
      
      // Status flags
      hasArtistProfile: !!(artistTableData || user.artistProfile),
      isVerified: artistTableData?.isVerified || user.artistProfile?.isVerified || user.isVerified,
      followersCount: artistTableData?.followersCount || user.artistProfile?.followersCount || 0,
      
      // For search result highlighting
      searchMatchType: search ? (
        artistTableData?.name?.toLowerCase().includes(search.toLowerCase()) ? 'artist_table_name' :
        user.artistProfile?.name?.toLowerCase().includes(search.toLowerCase()) ? 'artist_profile_name' :
        user.username.toLowerCase().includes(search.toLowerCase()) ? 'username' :
        'other'
      ) : null,
      
      // ✅ DEBUG INFO: Artist data source
      _debug: {
        fromArtistTable: !!artistTableData,
        fromArtistProfile: !!user.artistProfile,
        artistTableName: artistTableData?.name,
        artistProfileName: user.artistProfile?.name,
        finalDisplayName: displayName,
      }
    };
  });

  res.json({
    success: true,
    message: `Found ${artistsForLineup.length} artists for lineup selection`,
    data: {
      artists: artistsForLineup,
      total: artistsForLineup.length,
      searchTerm: search,
      hasMore: artistsForLineup.length === limitNum,
    }
  });
}));

module.exports = router; 