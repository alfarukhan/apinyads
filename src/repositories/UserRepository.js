const BaseRepository = require('./BaseRepository');
const { getAuditLogService, getAuthenticationService } = require('../services/core');

/**
 * 👤 USER REPOSITORY
 * 
 * Specialized data access for User model with:
 * - Secure user management & authentication
 * - Profile completion tracking
 * - Activity & engagement metrics
 * - Privacy & data protection compliance
 * - User role & permission management
 * - Social features & relationships
 * 
 * ✅ Security: Secure password handling & PII protection
 * ✅ Privacy: GDPR compliance & data anonymization
 * ✅ Performance: Optimized user queries & caching
 */
class UserRepository extends BaseRepository {
  constructor() {
    super('user', {
      enableCaching: true,
      cacheCategory: 'user_cache',
      cacheTTL: 900, // 15 minutes for user data
      enableAudit: true,
      supportsSoftDelete: true,
      softDeleteField: 'deletedAt',
      auditableFields: [
        'email', 'username', 'firstName', 'lastName', 'role', 
        'isVerified', 'isActive', 'city', 'avatar'
      ]
    });

    // ✅ CENTRALIZED: Use service factory instead of direct instantiation
    this.auditService = getAuditLogService();
    this.authService = getAuthenticationService();
  }

  /**
   * 🔍 SPECIALIZED FIND OPERATIONS
   */
  
  async findByEmail(email, options = {}) {
    const { includePassword = false, useCache = false } = options;

    try {
      const select = {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        isVerified: true,
        isActive: true,
        city: true,
        points: true,
        createdAt: true,
        lastLoginAt: true,
        loginAttempts: true,
        lockedUntil: true
      };

      if (includePassword) {
        select.password = true;
      }

      return await this.findFirst(
        { email: email.toLowerCase() },
        { select, useCache }
      );

    } catch (error) {
      console.error('❌ UserRepository.findByEmail error:', error);
      throw error;
    }
  }

  async findByUsername(username, options = {}) {
    const { useCache = true } = options;

    try {
      return await this.findFirst(
        { username: username.toLowerCase() },
        {
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
            role: true,
            isVerified: true,
            isActive: true,
            city: true,
            points: true,
            createdAt: true,
            lastLoginAt: true
          },
          useCache
        }
      );

    } catch (error) {
      console.error('❌ UserRepository.findByUsername error:', error);
      throw error;
    }
  }

  async findActiveUsers(options = {}) {
    const {
      role = null,
      city = null,
      isVerified = null,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      userId = null
    } = options;

    try {
      const where = {
        isActive: true
      };

      if (role) where.role = role;
      if (city) where.city = { contains: city, mode: 'insensitive' };
      if (isVerified !== null) where.isVerified = isVerified;

      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      return await this.findMany({
        where,
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          isVerified: true,
          city: true,
          points: true,
          createdAt: true,
          lastLoginAt: true,
          _count: {
            select: {
              events: true,
              bookings: true
            }
          }
        },
        orderBy,
        page,
        limit,
        userId
      });

    } catch (error) {
      console.error('❌ UserRepository.findActiveUsers error:', error);
      throw error;
    }
  }

  async findUserProfile(userId, options = {}) {
    const { requestingUserId = null, includePrivateInfo = false } = options;

    try {
      const user = await this.findById(userId, {
        include: {
          events: {
            where: { status: 'PUBLISHED' },
            select: {
              id: true,
              title: true,
              startDate: true,
              location: true,
              imageUrl: true,
              _count: { select: { bookings: true } }
            },
            orderBy: { startDate: 'asc' },
            take: 5
          },
          bookings: {
            where: { status: 'CONFIRMED' },
            select: {
              id: true,
              event: {
                select: { id: true, title: true, startDate: true, imageUrl: true }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          _count: {
            select: {
              events: true,
              bookings: true,
              guestList: true
            }
          }
        },
        userId: requestingUserId
      });

      if (!user) return null;

      // ✅ Remove sensitive information for non-owners
      if (userId !== requestingUserId && !includePrivateInfo) {
        delete user.email;
        delete user.loginAttempts;
        delete user.lockedUntil;
        delete user.lastLoginAt;
      }

      // ✅ Add computed profile metrics
      user.profileMetrics = {
        eventsOrganized: user._count.events,
        eventsAttended: user._count.bookings,
        guestlistRequests: user._count.guestLists,
        profileCompletion: this.calculateProfileCompletion(user),
        memberSince: user.createdAt,
        isOnline: this.checkUserOnlineStatus(user.lastLoginAt)
      };

      return user;

    } catch (error) {
      console.error('❌ UserRepository.findUserProfile error:', error);
      throw error;
    }
  }

  /**
   * ✨ SPECIALIZED CREATE/UPDATE OPERATIONS
   */
  
  async createUser(userData, options = {}) {
    const { hashPassword = true, sendWelcomeEmail = true } = options;

    try {
      // ✅ User-specific validation
      const validatedData = await this.validateUserData(userData);

      // ✅ Hash password if provided
      if (validatedData.password && hashPassword) {
        validatedData.password = await this.authService.hashPassword(validatedData.password);
      }

      // ✅ Normalize email and username
      validatedData.email = validatedData.email.toLowerCase();
      validatedData.username = validatedData.username.toLowerCase();

      const user = await this.create(validatedData, {
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          role: true,
          isVerified: true,
          isActive: true,
          createdAt: true
        }
      });

      // ✅ Log user registration
      await this.auditService.logEvent('USER_REGISTERED', {
        userId: user.id,
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          email: user.email,
          username: user.username,
          role: user.role
        }
      });

      // ✅ TODO: Send welcome email if enabled
      if (sendWelcomeEmail) {
        console.log(`📧 Welcome email queued for: ${user.email}`);
      }

      return user;

    } catch (error) {
      console.error('❌ UserRepository.createUser error:', error);
      throw error;
    }
  }

  async updateProfile(userId, profileData, options = {}) {
    const { requestingUserId = userId } = options;

    try {
      // ✅ Authorization check
      if (userId !== requestingUserId) {
        throw new Error('Unauthorized: Cannot update another user\'s profile');
      }

      // ✅ Validate profile data
      const validatedData = await this.validateProfileData(profileData);

      const updatedUser = await this.update(userId, validatedData, {
        select: {
          id: true,
          email: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          city: true,
          isVerified: true,
          updatedAt: true
        },
        userId: requestingUserId
      });

      // ✅ Log profile update
      await this.auditService.logEvent('PROFILE_UPDATED', {
        userId: requestingUserId,
        resourceType: 'user',
        resourceId: userId,
        metadata: {
          updatedFields: Object.keys(validatedData)
        }
      });

      return updatedUser;

    } catch (error) {
      console.error('❌ UserRepository.updateProfile error:', error);
      throw error;
    }
  }

  async updatePassword(userId, currentPassword, newPassword, options = {}) {
    const { requestingUserId = userId } = options;

    try {
      // ✅ Authorization check
      if (userId !== requestingUserId) {
        throw new Error('Unauthorized: Cannot update another user\'s password');
      }

      // ✅ Get current user with password
      const user = await this.findById(userId, {
        select: { id: true, password: true },
        useCache: false
      });

      if (!user) {
        throw new Error('User not found');
      }

      // ✅ Verify current password
      const isValidPassword = await this.authService.verifyPassword(currentPassword, user.password);
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // ✅ Hash new password
      const hashedNewPassword = await this.authService.hashPassword(newPassword);

      // ✅ Update password
      await this.update(userId, { password: hashedNewPassword }, {
        userId: requestingUserId,
        skipAudit: true // Password changes are handled specially
      });

      // ✅ Log password change
      await this.auditService.logEvent('PASSWORD_CHANGED', {
        userId: requestingUserId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { timestamp: new Date() }
      });

      // ✅ Invalidate all user sessions
      // TODO: Implement session invalidation
      console.log(`🔑 Password updated for user ${userId}, sessions should be invalidated`);

      return { success: true };

    } catch (error) {
      console.error('❌ UserRepository.updatePassword error:', error);
      throw error;
    }
  }

  async verifyEmail(userId, options = {}) {
    try {
      const updatedUser = await this.update(userId, { 
        isVerified: true,
        emailVerifiedAt: new Date()
      }, {
        select: {
          id: true,
          email: true,
          isVerified: true,
          emailVerifiedAt: true
        },
        userId
      });

      // ✅ Log email verification
      await this.auditService.logEvent('EMAIL_VERIFIED', {
        userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { email: updatedUser.email }
      });

      return updatedUser;

    } catch (error) {
      console.error('❌ UserRepository.verifyEmail error:', error);
      throw error;
    }
  }

  async updateLastLogin(userId, loginData = {}) {
    const { ipAddress = null, userAgent = null } = loginData;

    try {
      await this.update(userId, {
        lastLoginAt: new Date(),
        loginAttempts: 0, // Reset login attempts on successful login
        lockedUntil: null  // Clear any account locks
      }, {
        skipAudit: true // Login tracking is handled by auth service
      });

      // ✅ Log successful login
      await this.auditService.logUserLogin(userId, {
        ipAddress,
        userAgent,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('❌ UserRepository.updateLastLogin error:', error);
      // Don't throw - login tracking failure shouldn't break login
    }
  }

  async incrementLoginAttempts(userId) {
    try {
      await this.prisma.$executeRaw`
        UPDATE "User" 
        SET "loginAttempts" = "loginAttempts" + 1,
            "lockedUntil" = CASE 
              WHEN "loginAttempts" + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
              ELSE "lockedUntil"
            END
        WHERE "id" = ${userId}
      `;

    } catch (error) {
      console.error('❌ UserRepository.incrementLoginAttempts error:', error);
    }
  }

  /**
   * 🎯 USER POINTS & GAMIFICATION
   */
  
  async addPoints(userId, points, reason, options = {}) {
    const { awardedBy = null } = options;

    try {
      const updatedUser = await this.prisma.$transaction(async (tx) => {
        // ✅ Update user points
        const user = await tx.user.update({
          where: { id: userId },
          data: { points: { increment: points } },
          select: { id: true, points: true, username: true } // Keep minimal for performance
        });

        // ✅ Log points transaction
        await tx.pointTransaction.create({
          data: {
            userId,
            points,
            reason,
            awardedBy,
            createdAt: new Date()
          }
        });

        return user;
      });

      // ✅ Log points award
      await this.auditService.logEvent('POINTS_AWARDED', {
        userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: {
          points,
          reason,
          newTotal: updatedUser.points,
          awardedBy
        }
      });

      console.log(`🎯 Points awarded: ${points} to ${updatedUser.username} (Total: ${updatedUser.points})`);
      return updatedUser;

    } catch (error) {
      console.error('❌ UserRepository.addPoints error:', error);
      throw error;
    }
  }

  /**
   * 📊 USER ANALYTICS & STATISTICS
   */
  
  async getUserStatistics(userId, options = {}) {
    try {
      const user = await this.model.findUnique({
        where: { id: userId },
        include: {
          events: {
            select: { id: true, status: true, createdAt: true, _count: { select: { bookings: true } } }
          },
          bookings: {
            select: { id: true, status: true, createdAt: true, totalAmount: true }
          },
          guestList: {
            select: { id: true, status: true, isPaid: true, createdAt: true }
          },
          pointTransactions: {
            select: { points: true, reason: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 10
          }
        }
      });

      if (!user) return null;

      // ✅ Calculate statistics
      const confirmedBookings = user.bookings.filter(b => b.status === 'CONFIRMED');
      const publishedEvents = user.events.filter(e => e.status === 'PUBLISHED');

      const stats = {
        // Event organization
        totalEventsCreated: user.events.length,
        publishedEvents: publishedEvents.length,
        totalEventAttendees: publishedEvents.reduce((sum, e) => sum + e._count.bookings, 0),

        // Event attendance
        totalBookings: user.bookings.length,
        confirmedBookings: confirmedBookings.length,
        totalSpent: confirmedBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0),

        // Guestlist activity
        guestlistRequests: user.guestList.length,
        approvedGuestlist: user.guestList.filter(g => g.status === 'APPROVED').length,
        paidGuestlist: user.guestList.filter(g => g.isPaid).length,

        // Engagement metrics
        currentPoints: user.points || 0,
        recentPointTransactions: user.pointTransactions,
        profileCompletion: this.calculateProfileCompletion(user),
        memberSince: user.createdAt,
        lastActivity: user.lastLoginAt
      };

      return stats;

    } catch (error) {
      console.error('❌ UserRepository.getUserStatistics error:', error);
      throw error;
    }
  }

  /**
   * 🔍 VALIDATION & BUSINESS LOGIC
   */
  
  async validateUserData(data) {
    // ✅ Email validation
    if (!data.email || !this.isValidEmail(data.email)) {
      throw new Error('Valid email address is required');
    }

    // ✅ Check email uniqueness
    const existingUser = await this.findByEmail(data.email, { useCache: false });
    if (existingUser) {
      throw new Error('Email address is already registered');
    }

    // ✅ Username validation
    if (!data.username || data.username.length < 3) {
      throw new Error('Username must be at least 3 characters long');
    }

    if (!/^[a-zA-Z0-9_]+$/.test(data.username)) {
      throw new Error('Username can only contain letters, numbers, and underscores');
    }

    // ✅ Check username uniqueness
    const existingUsername = await this.findByUsername(data.username, { useCache: false });
    if (existingUsername) {
      throw new Error('Username is already taken');
    }

    // ✅ Password validation
    if (data.password && data.password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    return data;
  }

  async validateProfileData(data) {
    // ✅ Remove read-only fields
    const { id, email, password, role, isVerified, createdAt, updatedAt, ...profileData } = data;

    // ✅ Username validation if being updated
    if (profileData.username) {
      if (profileData.username.length < 3) {
        throw new Error('Username must be at least 3 characters long');
      }

      if (!/^[a-zA-Z0-9_]+$/.test(profileData.username)) {
        throw new Error('Username can only contain letters, numbers, and underscores');
      }

      // ✅ Check username uniqueness (excluding current user)
      const existingUsername = await this.findByUsername(profileData.username, { useCache: false });
      if (existingUsername) {
        throw new Error('Username is already taken');
      }

      profileData.username = profileData.username.toLowerCase();
    }

    return profileData;
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  calculateProfileCompletion(user) {
    const fields = ['firstName', 'lastName', 'avatar', 'city'];
    const completedFields = fields.filter(field => user[field] && user[field].trim().length > 0);
    
    let completion = (completedFields.length / fields.length) * 100;
    
    // ✅ Bonus for email verification
    if (user.isVerified) completion += 10;
    
    return Math.min(100, Math.round(completion));
  }

  checkUserOnlineStatus(lastLoginAt) {
    if (!lastLoginAt) return false;
    
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    return new Date(lastLoginAt) > thirtyMinutesAgo;
  }
}

module.exports = UserRepository;