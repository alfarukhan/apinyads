const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized validation schemas
const { userRegisterSchema, userLoginSchema, userUpdateProfileSchema } = require('../lib/validation-schemas');

// ✅ ENTERPRISE: Use centralized user selectors
const { authUserSelect, safeUserSelect, profileUserSelect } = require('../lib/user-selectors');

// ✅ ENTERPRISE: Use standardized response formatters
const { authResponse, userResponse, successResponse, errorResponse, formatUserData } = require('../lib/response-formatters');

const router = express.Router();

// ✅ REMOVED: Validation schemas moved to centralized lib/validation-schemas.js

// Generate JWT token
const generateToken = (userId) => {
  console.log('🔍 Generating token for user:', userId);
  console.log('🔍 JWT_SECRET available:', !!process.env.JWT_SECRET);
  
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }
  
  const token = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
  
  console.log('✅ Token generated, length:', token.length);
  return token;
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', asyncHandler(async (req, res) => {
  const { error, value } = userRegisterSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { email, username, password, firstName, lastName, phone, city, gender } = value;

  // Check if user exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { username }
      ]
    }
  });

  if (existingUser) {
    throw new AppError('User with this email or username already exists', 400);
  }

  // Hash password
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashedPassword,
      firstName,
      lastName,
      phone,
      city,
      gender,
    },
    select: safeUserSelect
  });

  // Generate token
  const token = generateToken(user.id);

  // ✅ ENTERPRISE: Use standardized response format for Flutter
  res.status(201).json(authResponse(user, token, 'User registered successfully'));
}));

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', asyncHandler(async (req, res) => {
  // Log request details for debugging
  console.log('🔍 Login request body keys:', Object.keys(req.body));
  console.log('🔍 Using field:', req.body.identifier ? 'identifier' : 'email (legacy)');
  
  // Validate request body - supports both identifier and email fields
  const { error, value } = userLoginSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // Use identifier if provided, otherwise use email (legacy support)
  const identifier = value.identifier || value.email;
  const { password } = value;
  
  console.log('✅ Validation successful, searching for user with identifier:', identifier.substring(0, 3) + '***');

  // Find user by email, username, or phone
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { username: identifier },
        { phone: identifier }
      ]
    },
    select: authUserSelect
  });

  if (!user || !user.isActive) {
    throw new AppError('Invalid credentials', 401);
  }

  // Check password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  // Generate token
  const token = generateToken(user.id);

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user;

  // ✅ ENTERPRISE: Use standardized response format for Flutter
  res.json(authResponse(userWithoutPassword, token, 'Login successful'));
}));

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      ...profileUserSelect,
      _count: {
        select: {
          followers: true,
          follows: true,
          eventRegistrations: true,
          posts: true,
        }
      }
    }
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Calculate additional stats with proper counting
  const [eventsAttended, upcomingEvents] = await Promise.all([
    // Count confirmed bookings for past events (events attended)
    prisma.booking.count({
      where: {
        userId: user.id,
        status: 'CONFIRMED',
        event: {
          startDate: { lt: new Date() }
        }
      }
    }),
    // Count confirmed bookings for future events (upcoming events)
    prisma.booking.count({
      where: {
        userId: user.id,
        status: 'CONFIRMED',
        event: {
          startDate: { gte: new Date() }
        }
      }
    })
  ]);

  // Calculate user stats using Prisma _count (which should be accurate)
  
  // 🔍 DEBUG: Manual verification to check if _count is correct
  const [manualFollowersCount, manualFollowingCount] = await Promise.all([
    // People who follow this user (this user is being followed)
    prisma.follow.count({ where: { followingId: user.id } }),
    // People this user follows (this user is the follower) 
    prisma.follow.count({ where: { followerId: user.id } })
  ]);

  console.log(`🔍 DEBUG User ${user.username} follow verification:`, {
    'Prisma _count.followers (should be people who follow me)': user._count.followers,
    'Prisma _count.follows (should be people I follow)': user._count.follows,
    'Manual followers count (people who follow me)': manualFollowersCount,
    'Manual following count (people I follow)': manualFollowingCount,
  });

  // 🔍 Let's also check actual follow records to see the data
  const sampleFollows = await prisma.follow.findMany({
    where: {
      OR: [
        { followerId: user.id },
        { followingId: user.id }
      ]
    },
    include: {
      follower: { select: { username: true } },
      following: { select: { username: true } }
    }
  });

  console.log(`🔍 DEBUG Sample follow records for ${user.username}:`, 
    sampleFollows.map(f => ({
      'follower': f.follower.username,
      'following': f.following.username,
      'meaning': f.followerId === user.id ? 
        `${user.username} follows ${f.following.username}` : 
        `${f.follower.username} follows ${user.username}`
    }))
  );

  const stats = {
    eventsCount: eventsAttended + upcomingEvents, // Total events (attended + upcoming)
    followersCount: user._count.followers,
    followingCount: user._count.follows,
    postsCount: user._count.posts,
  };



  // ✅ FIX: Send user and stats as separate objects for frontend
  res.json(successResponse('User profile retrieved successfully', {
    user: user,  // User data without stats
    stats: stats // Stats as separate object
  }));
}));

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authMiddleware, asyncHandler(async (req, res) => {
  const { error, value } = userUpdateProfileSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // Map avatarUrl to avatar field for database
  const updateData = { ...value };
  if (updateData.avatarUrl) {
    updateData.avatar = updateData.avatarUrl;
    delete updateData.avatarUrl;
  }

  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: updateData,
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
      favoriteGenres: true,
      points: true,
      role: true,
      isVerified: true,
      createdAt: true,
      updatedAt: true,
    }
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: formatUserData(updatedUser)
  });
}));

// @route   POST /api/auth/logout
// @desc    Logout user (invalidate token)
// @access  Private
router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  // In a stateless JWT system, we don't need to do anything server-side
  // The client will remove the token from storage
  // In a production system, you might want to:
  // 1. Add token to a blacklist/revoked tokens table
  // 2. Set token expiry in Redis
  // 3. Log the logout activity

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private
router.post('/change-password', authMiddleware, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current password and new password are required', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters long', 400);
  }

  // Get user with password
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { password: true }
  });

  // Verify current password
  const isValidPassword = await bcrypt.compare(currentPassword, user.password);
  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await prisma.user.update({
    where: { id: req.user.id },
    data: { password: hashedNewPassword }
  });

  res.json({
    success: true,
    message: 'Password changed successfully'
  });
}));

// @route   POST /api/auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', authMiddleware, asyncHandler(async (req, res) => {
  const token = generateToken(req.user.id);

  res.json({
    success: true,
    message: 'Token refreshed successfully',
    data: { token }
  });
}));

module.exports = router; 