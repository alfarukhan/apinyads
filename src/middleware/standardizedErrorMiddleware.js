const UnifiedErrorHandler = require('../services/core/UnifiedErrorHandler');
const LoggingService = require('../services/core/LoggingService');

/**
 * 🛡️ STANDARDIZED ERROR RESPONSE MIDDLEWARE
 * 
 * Universal error handling middleware for DanceSignal API:
 * - Integrates with UnifiedErrorHandler for consistent error processing
 * - Applies to ALL API endpoints automatically
 * - Eliminates stack trace leakage in production
 * - Provides correlation IDs for debugging
 * - Ensures security-focused error sanitization
 * - Standardizes error response format across entire API
 * 
 * ✅ Security: Zero sensitive information exposure
 * ✅ Consistency: Uniform error responses across all endpoints
 * ✅ Debugging: Rich context for developers in dev mode
 * ✅ Compliance: Audit trails for all errors
 */

let errorHandler = null;
let logger = null;

// ✅ Initialize services lazily to avoid circular dependencies
function getServices() {
  if (!errorHandler) {
    errorHandler = new UnifiedErrorHandler();
    logger = new LoggingService();
  }
  return { errorHandler, logger };
}

/**
 * 🎯 MAIN ERROR HANDLING MIDDLEWARE
 */
function standardizedErrorMiddleware(error, req, res, next) {
  const { errorHandler, logger } = getServices();
  
  // ✅ Generate correlation ID if not already present
  const correlationId = req.correlationId || 
                       req.headers['x-correlation-id'] || 
                       `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // ✅ Add correlation ID to request for downstream use
  req.correlationId = correlationId;

  // ✅ Extract user context for better error tracking
  const userId = req.user?.id || null;
  const userEmail = req.user?.email || null;
  const userRole = req.user?.role || null;

  // ✅ Build rich error context
  const errorContext = {
    // Request details
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    params: req.params,
    
    // User context
    userId,
    userEmail,
    userRole,
    
    // Request metadata
    userAgent: req.get('user-agent'),
    referer: req.get('referer'),
    origin: req.get('origin'),
    ip: req.ip,
    ips: req.ips,
    
    // Headers (filtered for security)
    headers: filterSensitiveHeaders(req.headers),
    
    // Performance context
    requestStartTime: req.requestStartTime || Date.now(),
    
    // Request body (if safe to log)
    body: filterSensitiveBody(req.body),
    
    // Additional context
    correlationId,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  };

  // ✅ Use UnifiedErrorHandler for consistent error processing
  errorHandler.handleError(error, req, res, {
    userId,
    correlationId,
    context: errorContext,
    skipResponse: false // Let error handler send response
  }).catch(handlingError => {
    // ✅ Fallback error handling if main error handler fails
    logger.error('Critical: Error handler failed', {
      originalError: error.message,
      handlingError: handlingError.message,
      correlationId,
      url: req.url
    });

    // ✅ Send minimal safe response
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        errorCode: 'CRITICAL_ERROR_HANDLER_FAILURE',
        correlationId,
        timestamp: new Date().toISOString()
      });
    }
  });
}

/**
 * 🔒 SECURITY HELPERS
 */

function filterSensitiveHeaders(headers) {
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-session-token'
  ];

  const filtered = {};
  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveHeaders.includes(key.toLowerCase())) {
      filtered[key] = '[REDACTED]';
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

function filterSensitiveBody(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sensitiveFields = [
    'password',
    'confirmPassword',
    'oldPassword',
    'newPassword',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'key',
    'credential',
    'cardNumber',
    'cvv',
    'pin',
    'ssn',
    'socialSecurityNumber'
  ];

  const filtered = {};
  for (const [key, value] of Object.entries(body)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      filtered[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = filterSensitiveBody(value); // Recursive filtering
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * 🎯 SPECIALIZED ERROR HANDLERS
 */

function createValidationErrorHandler() {
  return (error, req, res, next) => {
    // ✅ Handle Joi validation errors specifically
    if (error.name === 'ValidationError' || error.isJoi) {
      const errorHandler = new UnifiedErrorHandler();
      
      const validationError = errorHandler.createValidationError(
        'Invalid input data',
        error.details || error.message
      );

      return standardizedErrorMiddleware(validationError, req, res, next);
    }

    // ✅ Pass to next error handler
    next(error);
  };
}

function createDatabaseErrorHandler() {
  return (error, req, res, next) => {
    // ✅ Handle Prisma/database errors specifically
    if (error.name?.includes('Prisma') || error.code?.startsWith('P')) {
      const errorHandler = new UnifiedErrorHandler();
      
      let message = 'Database operation failed';
      let category = 'DATABASE';

      // ✅ Specific Prisma error handling
      switch (error.code) {
        case 'P2002':
          message = 'Duplicate entry found';
          category = 'VALIDATION';
          break;
        case 'P2025':
          message = 'Record not found';
          category = 'NOT_FOUND';
          break;
        case 'P2003':
          message = 'Foreign key constraint failed';
          category = 'VALIDATION';
          break;
        default:
          message = 'Database operation failed';
          category = 'DATABASE';
      }

      const dbError = new Error(message);
      dbError.category = category;
      dbError.isOperational = true;

      return standardizedErrorMiddleware(dbError, req, res, next);
    }

    // ✅ Pass to next error handler
    next(error);
  };
}

function createAuthenticationErrorHandler() {
  return (error, req, res, next) => {
    // ✅ Handle JWT and authentication errors
    if (error.name === 'JsonWebTokenError' || 
        error.name === 'TokenExpiredError' || 
        error.message?.includes('jwt') ||
        error.message?.includes('token')) {
      
      const errorHandler = new UnifiedErrorHandler();
      
      let message = 'Authentication required';
      if (error.name === 'TokenExpiredError') {
        message = 'Token has expired';
      } else if (error.name === 'JsonWebTokenError') {
        message = 'Invalid token';
      }

      const authError = errorHandler.createAuthError(message);
      return standardizedErrorMiddleware(authError, req, res, next);
    }

    // ✅ Pass to next error handler
    next(error);
  };
}

/**
 * 🚀 MIDDLEWARE APPLICATION HELPERS
 */

function applyStandardizedErrorHandling(app) {
  console.log('🛡️ Applying standardized error handling middleware...');

  // ✅ Apply specialized error handlers first (order matters)
  app.use(createValidationErrorHandler());
  app.use(createDatabaseErrorHandler());
  app.use(createAuthenticationErrorHandler());
  
  // ✅ Apply main standardized error handler last
  app.use(standardizedErrorMiddleware);

  console.log('✅ Standardized error handling applied successfully');
}

/**
 * 📊 ERROR STATISTICS MIDDLEWARE
 */

function errorStatsMiddleware(req, res, next) {
  const originalSend = res.send;
  
  res.send = function(data) {
    // ✅ Track error responses for monitoring
    if (res.statusCode >= 400) {
      const { logger } = getServices();
      
      logger.info('Error response sent', {
        statusCode: res.statusCode,
        method: req.method,
        url: req.url,
        userId: req.user?.id,
        correlationId: req.correlationId,
        responseTime: Date.now() - (req.requestStartTime || Date.now())
      });
    }

    return originalSend.call(this, data);
  };

  next();
}

/**
 * 🔧 CORRELATION ID MIDDLEWARE
 */

function correlationIdMiddleware(req, res, next) {
  // ✅ Generate or extract correlation ID
  const correlationId = req.headers['x-correlation-id'] || 
                       `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  req.correlationId = correlationId;
  req.requestStartTime = Date.now();
  
  // ✅ Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', correlationId);
  
  next();
}

/**
 * 🎯 EXPORTS
 */

module.exports = {
  // Main middleware
  standardizedErrorMiddleware,
  
  // Specialized handlers
  createValidationErrorHandler,
  createDatabaseErrorHandler,
  createAuthenticationErrorHandler,
  
  // Application helpers
  applyStandardizedErrorHandling,
  
  // Utility middleware
  errorStatsMiddleware,
  correlationIdMiddleware,
  
  // Security helpers
  filterSensitiveHeaders,
  filterSensitiveBody
};