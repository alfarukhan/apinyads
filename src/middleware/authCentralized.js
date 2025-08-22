const AuthenticationService = require('../services/core/AuthenticationService');
const PermissionService = require('../services/core/PermissionService');
const ResponseFormatter = require('../services/core/ResponseFormatter');

/**
 * 🔐 CENTRALIZED AUTHENTICATION MIDDLEWARE
 * 
 * Unified authentication system using centralized services:
 * - Token verification via AuthenticationService
 * - Permission checking via PermissionService
 * - Consistent error responses via ResponseFormatter
 * - Session management & tracking
 * - Security monitoring & logging
 * 
 * ✅ Security: Enhanced with session tracking
 * ✅ Performance: Service caching & optimization
 * ✅ Consistency: Unified error handling
 */

/**
 * 🔒 MAIN AUTHENTICATION MIDDLEWARE
 * 
 * Replaces the old authMiddleware with centralized services
 */
const authMiddleware = async (req, res, next) => {
  const authService = new AuthenticationService();
  const responseFormatter = new ResponseFormatter();
  
  try {
    // ✅ STEP 1: Extract token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return responseFormatter.error(res, {
        message: 'Access denied. Authentication token required.',
        statusCode: 401,
        errorCode: 'TOKEN_MISSING',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }

    const token = authHeader.substring(7);

    // ✅ STEP 2: Verify token using centralized service
    const verificationResult = await authService.verifyToken(token, {
      requireSession: true,
      updateActivity: true
    });

    // ✅ STEP 3: Attach user context to request
    req.user = verificationResult.user;
    req.sessionId = verificationResult.sessionId;
    req.tokenData = verificationResult.tokenData;

    // ✅ STEP 4: Log authentication success
    console.log(`🔐 Authentication successful: ${req.user.username} (${req.user.role})`);

    next();
    
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    
    // ✅ Centralized error response
    return responseFormatter.error(res, {
      message: error.message || 'Authentication failed',
      statusCode: 401,
      errorCode: 'AUTHENTICATION_FAILED',
      requestId: req.requestId,
      startTime: req.startTime
    });
  }
};

/**
 * 🔓 OPTIONAL AUTHENTICATION MIDDLEWARE
 * 
 * Doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
  const authService = new AuthenticationService();
  
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.sessionId = null;
      req.tokenData = null;
      return next();
    }

    const token = authHeader.substring(7);
    
    // ✅ Try to verify token, but don't fail if invalid
    try {
      const verificationResult = await authService.verifyToken(token, {
        requireSession: false,
        updateActivity: true
      });

      req.user = verificationResult.user;
      req.sessionId = verificationResult.sessionId;
      req.tokenData = verificationResult.tokenData;

      console.log(`🔓 Optional auth successful: ${req.user.username}`);
    } catch (verifyError) {
      console.log(`🔓 Optional auth failed (continuing): ${verifyError.message}`);
      req.user = null;
      req.sessionId = null;
      req.tokenData = null;
    }

    next();
    
  } catch (error) {
    console.error('❌ Optional auth error:', error);
    req.user = null;
    req.sessionId = null;
    req.tokenData = null;
    next();
  }
};

/**
 * 🛡️ ROLE-BASED ACCESS CONTROL
 * 
 * Enhanced with centralized permission checking
 */
const requireRole = (roles) => {
  return async (req, res, next) => {
    const permissionService = new PermissionService();
    const responseFormatter = new ResponseFormatter();

    try {
      if (!req.user) {
        return responseFormatter.error(res, {
          message: 'Access denied. Authentication required.',
          statusCode: 401,
          errorCode: 'AUTHENTICATION_REQUIRED',
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      // ✅ Convert single role to array
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      // ✅ Check if user has any of the required roles
      const hasRole = allowedRoles.includes(req.user.role);
      
      if (!hasRole) {
        // ✅ Log unauthorized access attempt
        console.warn(`🚫 Access denied: ${req.user.username} (${req.user.role}) attempted to access ${req.method} ${req.path}`);
        
        return responseFormatter.error(res, {
          message: 'Access denied. Insufficient permissions.',
          statusCode: 403,
          errorCode: 'INSUFFICIENT_PERMISSIONS',
          details: {
            userRole: req.user.role,
            requiredRoles: allowedRoles
          },
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      console.log(`🛡️ Role check passed: ${req.user.username} has role ${req.user.role}`);
      next();
      
    } catch (error) {
      console.error('❌ Role check error:', error);
      
      return responseFormatter.error(res, {
        message: 'Authorization check failed',
        statusCode: 500,
        errorCode: 'AUTHORIZATION_ERROR',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }
  };
};

/**
 * 🎯 PERMISSION-BASED ACCESS CONTROL
 * 
 * Fine-grained permission checking
 */
const requirePermission = (permission, resourceType = null) => {
  return async (req, res, next) => {
    const permissionService = new PermissionService();
    const responseFormatter = new ResponseFormatter();

    try {
      if (!req.user) {
        return responseFormatter.error(res, {
          message: 'Access denied. Authentication required.',
          statusCode: 401,
          errorCode: 'AUTHENTICATION_REQUIRED',
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      // ✅ Build resource context if provided
      let resourceContext = null;
      if (resourceType) {
        resourceContext = {
          type: resourceType,
          id: req.params.id || req.params.eventId || req.params.bookingId,
          ownerId: req.body.userId || req.user.id
        };
      }

      // ✅ Check permission using centralized service
      const permissionResult = await permissionService.checkPermission(
        req.user,
        permission,
        resourceContext
      );

      if (!permissionResult.allowed) {
        console.warn(`🚫 Permission denied: ${req.user.username} lacks ${permission} for ${resourceType || 'general'}`);
        
        return responseFormatter.error(res, {
          message: permissionResult.reason || 'Access denied. Insufficient permissions.',
          statusCode: 403,
          errorCode: 'PERMISSION_DENIED',
          details: {
            permission: permission,
            resource: resourceContext,
            reason: permissionResult.reason
          },
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      console.log(`🎯 Permission granted: ${req.user.username} has ${permission}`);
      next();
      
    } catch (error) {
      console.error('❌ Permission check error:', error);
      
      return responseFormatter.error(res, {
        message: 'Permission check failed',
        statusCode: 500,
        errorCode: 'PERMISSION_CHECK_ERROR',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }
  };
};

/**
 * 👤 USER OWNERSHIP VERIFICATION
 * 
 * Ensures user can only access their own resources
 */
const requireOwnership = (userIdParam = 'userId') => {
  return async (req, res, next) => {
    const responseFormatter = new ResponseFormatter();

    try {
      if (!req.user) {
        return responseFormatter.error(res, {
          message: 'Access denied. Authentication required.',
          statusCode: 401,
          errorCode: 'AUTHENTICATION_REQUIRED',
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      // ✅ Get target user ID from params or body
      const targetUserId = req.params[userIdParam] || req.body[userIdParam];
      
      if (!targetUserId) {
        return responseFormatter.error(res, {
          message: 'User ID parameter missing',
          statusCode: 400,
          errorCode: 'MISSING_USER_ID',
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      // ✅ Check ownership (admins can access any resource)
      if (req.user.id !== targetUserId && req.user.role !== 'ADMIN') {
        console.warn(`🚫 Ownership denied: ${req.user.username} attempted to access resource of user ${targetUserId}`);
        
        return responseFormatter.error(res, {
          message: 'Access denied. You can only access your own resources.',
          statusCode: 403,
          errorCode: 'OWNERSHIP_REQUIRED',
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      console.log(`👤 Ownership verified: ${req.user.username} accessing ${targetUserId === req.user.id ? 'own' : 'other (admin)'} resource`);
      next();
      
    } catch (error) {
      console.error('❌ Ownership check error:', error);
      
      return responseFormatter.error(res, {
        message: 'Ownership verification failed',
        statusCode: 500,
        errorCode: 'OWNERSHIP_CHECK_ERROR',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }
  };
};

/**
 * ⏰ SESSION ACTIVITY TRACKING
 * 
 * Updates user session activity
 */
const trackActivity = async (req, res, next) => {
  if (req.user && req.sessionId) {
    try {
      const authService = new AuthenticationService();
      // Update session activity in background
      setImmediate(async () => {
        try {
          await authService.validateSession(req.sessionId, req.user.id);
        } catch (error) {
          console.error('❌ Activity tracking error:', error);
        }
      });
    } catch (error) {
      console.error('❌ Activity tracking setup error:', error);
    }
  }
  next();
};

/**
 * 🔐 ACCOUNT STATUS VERIFICATION
 * 
 * Ensures user account is in good standing
 */
const requireActiveAccount = async (req, res, next) => {
  const responseFormatter = new ResponseFormatter();

  try {
    if (!req.user) {
      return responseFormatter.error(res, {
        message: 'Access denied. Authentication required.',
        statusCode: 401,
        errorCode: 'AUTHENTICATION_REQUIRED',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }

    // ✅ Check account status
    if (!req.user.isActive) {
      return responseFormatter.error(res, {
        message: 'Account is deactivated. Please contact support.',
        statusCode: 403,
        errorCode: 'ACCOUNT_DEACTIVATED',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }

    if (req.user.isLocked) {
      return responseFormatter.error(res, {
        message: 'Account is temporarily locked. Please try again later.',
        statusCode: 403,
        errorCode: 'ACCOUNT_LOCKED',
        requestId: req.requestId,
        startTime: req.startTime
      });
    }

    next();
    
  } catch (error) {
    console.error('❌ Account status check error:', error);
    
    return responseFormatter.error(res, {
      message: 'Account verification failed',
      statusCode: 500,
      errorCode: 'ACCOUNT_CHECK_ERROR',
      requestId: req.requestId,
      startTime: req.startTime
    });
  }
};

module.exports = {
  // ✅ CENTRALIZED: Main authentication middleware
  authMiddleware,
  optionalAuth,
  
  // ✅ CENTRALIZED: Authorization middleware
  requireRole,
  requirePermission,
  requireOwnership,
  
  // ✅ CENTRALIZED: Account & session middleware
  requireActiveAccount,
  trackActivity,
  
  // ✅ Legacy exports for backward compatibility
  auth: authMiddleware,
  optional: optionalAuth,
  role: requireRole
};