const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('../../lib/prisma');
const crypto = require('crypto');

/**
 * 🔐 CENTRALIZED AUTHENTICATION SERVICE
 * 
 * Unified authentication for all DanceSignal operations:
 * - JWT token generation & validation
 * - Password hashing & verification
 * - Session management & tracking
 * - User context & permissions
 * - Security monitoring & logging
 * 
 * ✅ Security: Industry-standard practices
 * ✅ Performance: Token caching & validation
 * ✅ Scalability: Stateless JWT with session tracking
 */
class AuthenticationService {
  constructor() {
    this.prisma = prisma;
    
    // ✅ CENTRALIZED: Authentication configuration
    this.config = {
      // JWT Configuration
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      
      // Password Configuration  
      BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12,
      PASSWORD_MIN_LENGTH: 8,
      PASSWORD_MAX_LENGTH: 128,
      
      // Session Configuration
      SESSION_TIMEOUT_MINUTES: parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 60 * 24, // 24 hours
      MAX_SESSIONS_PER_USER: parseInt(process.env.MAX_SESSIONS_PER_USER) || 5,
      
      // Security Configuration
      MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,
      LOCKOUT_DURATION_MINUTES: parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 15,
      ENABLE_SESSION_TRACKING: process.env.ENABLE_SESSION_TRACKING !== 'false'
    };

    // ✅ Validate critical configuration
    if (!this.config.JWT_SECRET) {
      throw new Error('JWT_SECRET is required but not set in environment variables');
    }

    // ✅ CENTRALIZED: Token cache for performance
    this.tokenCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

    console.log('🔐 AuthenticationService initialized with configuration:', {
      jwtExpiresIn: this.config.JWT_EXPIRES_IN,
      bcryptRounds: this.config.BCRYPT_ROUNDS,
      sessionTimeout: this.config.SESSION_TIMEOUT_MINUTES,
      maxSessions: this.config.MAX_SESSIONS_PER_USER,
      sessionTracking: this.config.ENABLE_SESSION_TRACKING
    });
  }

  /**
   * 🔑 GENERATE JWT TOKEN
   * 
   * Creates secure JWT token with user context
   */
  generateToken(userId, sessionData = {}) {
    try {
      const payload = {
        userId,
        sessionId: sessionData.sessionId || this.generateSessionId(),
        deviceId: sessionData.deviceId || 'unknown',
        timestamp: Date.now(),
        version: '2.0' // For token version tracking
      };

      const token = jwt.sign(payload, this.config.JWT_SECRET, {
        expiresIn: this.config.JWT_EXPIRES_IN,
        issuer: 'dancesignal-api',
        audience: 'dancesignal-app'
      });

      console.log(`🔑 JWT token generated for user ${userId}, session ${payload.sessionId}`);
      return {
        token,
        sessionId: payload.sessionId,
        expiresIn: this.config.JWT_EXPIRES_IN,
        tokenType: 'Bearer'
      };

    } catch (error) {
      console.error('❌ Error generating JWT token:', error);
      throw new Error('Failed to generate authentication token');
    }
  }

  /**
   * 🔍 VERIFY JWT TOKEN
   * 
   * Validates token and returns user context
   */
  async verifyToken(token, options = {}) {
    try {
      // ✅ Check cache first for performance
      const cacheKey = `token_${token.substring(0, 20)}`;
      if (this.tokenCache.has(cacheKey)) {
        const cached = this.tokenCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.data;
        }
        this.tokenCache.delete(cacheKey);
      }

      // ✅ Verify JWT token
      const decoded = jwt.verify(token, this.config.JWT_SECRET, {
        issuer: 'dancesignal-api',
        audience: 'dancesignal-app'
      });

      // ✅ Get user with permissions
      const user = await this.getUserContext(decoded.userId, decoded.sessionId);
      
      if (!user) {
        throw new Error('User not found or inactive');
      }

      // ✅ Validate session if tracking enabled
      if (this.config.ENABLE_SESSION_TRACKING && decoded.sessionId) {
        const sessionValid = await this.validateSession(decoded.sessionId, decoded.userId);
        if (!sessionValid) {
          throw new Error('Session expired or invalid');
        }
      }

      const result = {
        userId: decoded.userId,
        sessionId: decoded.sessionId,
        deviceId: decoded.deviceId,
        user: user,
        tokenData: decoded
      };

      // ✅ Cache successful verification
      this.tokenCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('❌ Token verification failed:', error.message);
      
      if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid authentication token');
      } else if (error.name === 'TokenExpiredError') {
        throw new Error('Authentication token has expired');
      } else {
        throw new Error(error.message || 'Token verification failed');
      }
    }
  }

  /**
   * 👤 GET USER CONTEXT
   * 
   * Retrieves complete user context with permissions
   */
  async getUserContext(userId, sessionId = null) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
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
          lastLoginAt: true,
          // Security fields
          loginAttempts: true,
          lockedUntil: true
        }
      });

      if (!user || !user.isActive) {
        return null;
      }

      // ✅ Check if account is locked
      if (user.lockedUntil && new Date() < user.lockedUntil) {
        throw new Error('Account is temporarily locked due to too many failed login attempts');
      }

      // ✅ Add computed fields
      const userContext = {
        ...user,
        // Security status
        isLocked: user.lockedUntil && new Date() < user.lockedUntil,
        needsVerification: !user.isVerified,
        
        // Session info
        currentSessionId: sessionId,
        
        // Permissions (computed from role)
        permissions: this.getUserPermissions(user.role),
        
        // Display name
        displayName: user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}` 
          : user.username
      };

      return userContext;

    } catch (error) {
      console.error('❌ Error getting user context:', error);
      throw error;
    }
  }

  /**
   * 🔒 HASH PASSWORD
   * 
   * Securely hash password with bcrypt
   */
  async hashPassword(password) {
    try {
      // ✅ Validate password strength
      this.validatePasswordStrength(password);
      
      const saltRounds = this.config.BCRYPT_ROUNDS;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      
      console.log(`🔒 Password hashed with ${saltRounds} rounds`);
      return hashedPassword;

    } catch (error) {
      console.error('❌ Error hashing password:', error);
      throw error;
    }
  }

  /**
   * ✅ VERIFY PASSWORD
   * 
   * Compare plain password with hash
   */
  async verifyPassword(password, hashedPassword) {
    try {
      const isValid = await bcrypt.compare(password, hashedPassword);
      console.log(`🔍 Password verification: ${isValid ? 'success' : 'failed'}`);
      return isValid;

    } catch (error) {
      console.error('❌ Error verifying password:', error);
      return false;
    }
  }

  /**
   * 📱 CREATE SESSION
   * 
   * Create and track user session
   */
  async createSession(userId, sessionData = {}) {
    if (!this.config.ENABLE_SESSION_TRACKING) {
      return { sessionId: this.generateSessionId() };
    }

    try {
      const sessionId = this.generateSessionId();
      const expiresAt = new Date(Date.now() + this.config.SESSION_TIMEOUT_MINUTES * 60 * 1000);

      // ✅ Cleanup old sessions for user (keep only latest N sessions)
      await this.cleanupUserSessions(userId);

      // ✅ Create new session record
      const session = await this.prisma.userSession.create({
        data: {
          id: sessionId,
          userId: userId,
          deviceId: sessionData.deviceId || 'unknown',
          deviceName: sessionData.deviceName || 'Unknown Device',
          ipAddress: sessionData.ipAddress || 'unknown',
          userAgent: sessionData.userAgent || 'unknown',
          platform: sessionData.platform || 'unknown',
          isActive: true,
          expiresAt: expiresAt,
          lastActivityAt: new Date()
        }
      });

      console.log(`📱 Session created: ${sessionId} for user ${userId}`);
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        deviceId: session.deviceId
      };

    } catch (error) {
      console.error('❌ Error creating session:', error);
      // Return basic session ID even if tracking fails
      return { sessionId: this.generateSessionId() };
    }
  }

  /**
   * 🔍 VALIDATE SESSION
   * 
   * Check if session is still valid
   */
  async validateSession(sessionId, userId) {
    if (!this.config.ENABLE_SESSION_TRACKING) {
      return true; // Skip validation if tracking disabled
    }

    try {
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: sessionId,
          userId: userId,
          isActive: true,
          expiresAt: { gt: new Date() }
        }
      });

      if (!session) {
        return false;
      }

      // ✅ Update last activity
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() }
      });

      return true;

    } catch (error) {
      console.error('❌ Error validating session:', error);
      return false;
    }
  }

  /**
   * 🚪 INVALIDATE SESSION
   * 
   * Logout user by invalidating session
   */
  async invalidateSession(sessionId, userId = null) {
    try {
      const whereClause = { id: sessionId };
      if (userId) whereClause.userId = userId;

      await this.prisma.userSession.updateMany({
        where: whereClause,
        data: { 
          isActive: false,
          endedAt: new Date()
        }
      });

      // ✅ Clear token cache
      this.clearUserTokenCache(userId);

      console.log(`🚪 Session invalidated: ${sessionId}`);
      return true;

    } catch (error) {
      console.error('❌ Error invalidating session:', error);
      return false;
    }
  }

  /**
   * 🛡️ SECURITY HELPERS
   */
  
  generateSessionId() {
    return `sess_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  }

  validatePasswordStrength(password) {
    if (!password || password.length < this.config.PASSWORD_MIN_LENGTH) {
      throw new Error(`Password must be at least ${this.config.PASSWORD_MIN_LENGTH} characters long`);
    }
    
    if (password.length > this.config.PASSWORD_MAX_LENGTH) {
      throw new Error(`Password must be no more than ${this.config.PASSWORD_MAX_LENGTH} characters long`);
    }

    // ✅ Basic strength requirements
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const strengthChecks = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar];
    const passedChecks = strengthChecks.filter(Boolean).length;

    if (passedChecks < 3) {
      throw new Error('Password must contain at least 3 of: uppercase, lowercase, numbers, special characters');
    }
  }

  getUserPermissions(role) {
    const permissions = {
      USER: ['read:own_profile', 'update:own_profile', 'create:bookings', 'read:events'],
      ORGANIZER: ['read:own_profile', 'update:own_profile', 'create:events', 'manage:own_events', 'read:analytics'],
      ADMIN: ['*'] // Full access
    };

    return permissions[role] || permissions.USER;
  }

  async cleanupUserSessions(userId) {
    try {
      const userSessions = await this.prisma.userSession.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' }
      });

      if (userSessions.length >= this.config.MAX_SESSIONS_PER_USER) {
        const sessionsToDeactivate = userSessions.slice(this.config.MAX_SESSIONS_PER_USER - 1);
        const sessionIds = sessionsToDeactivate.map(s => s.id);

        await this.prisma.userSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { isActive: false, endedAt: new Date() }
        });

        console.log(`🧹 Cleaned up ${sessionIds.length} old sessions for user ${userId}`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up user sessions:', error);
    }
  }

  clearUserTokenCache(userId) {
    // Clear cached tokens for user
    for (const [key, value] of this.tokenCache) {
      if (value.data?.userId === userId) {
        this.tokenCache.delete(key);
      }
    }
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.prisma.$disconnect();
    this.tokenCache.clear();
    console.log('✅ AuthenticationService cleanup completed');
  }
}

module.exports = AuthenticationService;