const AuditLogService = require('./AuditLogService');
const LoggingService = require('./LoggingService');
const ResponseFormatter = require('./ResponseFormatter');

/**
 * 🛡️ UNIFIED ERROR HANDLER SERVICE
 * 
 * Centralized error management system for DanceSignal:
 * - Standardized error response formats
 * - Comprehensive error logging & tracking
 * - Error correlation & debugging support
 * - Security-focused error sanitization
 * - Error categorization & severity levels
 * - Performance impact monitoring
 * 
 * ✅ Security: No sensitive data leakage
 * ✅ Consistency: Uniform error responses
 * ✅ Observability: Complete error tracking
 * ✅ Developer Experience: Rich debugging info
 */
class UnifiedErrorHandler {
  constructor() {
    this.logger = new LoggingService();
    this.auditService = new AuditLogService();
    this.responseFormatter = new ResponseFormatter();

    // ✅ Error categories and their default configurations
    this.errorCategories = {
      // Authentication & authorization errors
      AUTH: {
        defaultStatus: 401,
        logLevel: 'warn',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'Authentication required'
      },

      // Authorization errors
      FORBIDDEN: {
        defaultStatus: 403,
        logLevel: 'warn',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'Access denied'
      },

      // Validation errors
      VALIDATION: {
        defaultStatus: 400,
        logLevel: 'info',
        exposeDetails: true,
        requiresAudit: false,
        defaultMessage: 'Invalid input data'
      },

      // Business logic errors
      BUSINESS: {
        defaultStatus: 400,
        logLevel: 'info',
        exposeDetails: true,
        requiresAudit: false,
        defaultMessage: 'Business rule violation'
      },

      // Resource not found
      NOT_FOUND: {
        defaultStatus: 404,
        logLevel: 'info',
        exposeDetails: true,
        requiresAudit: false,
        defaultMessage: 'Resource not found'
      },

      // Rate limiting
      RATE_LIMIT: {
        defaultStatus: 429,
        logLevel: 'warn',
        exposeDetails: true,
        requiresAudit: true,
        defaultMessage: 'Too many requests'
      },

      // External service errors
      EXTERNAL: {
        defaultStatus: 502,
        logLevel: 'error',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'External service error'
      },

      // Payment processing errors
      PAYMENT: {
        defaultStatus: 400,
        logLevel: 'warn',
        exposeDetails: true,
        requiresAudit: true,
        defaultMessage: 'Payment processing error'
      },

      // System/internal errors
      SYSTEM: {
        defaultStatus: 500,
        logLevel: 'error',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'Internal server error'
      },

      // Database errors
      DATABASE: {
        defaultStatus: 500,
        logLevel: 'error',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'Database operation failed'
      },

      // Network/timeout errors
      NETWORK: {
        defaultStatus: 503,
        logLevel: 'error',
        exposeDetails: false,
        requiresAudit: true,
        defaultMessage: 'Service temporarily unavailable'
      }
    };

    // ✅ Security-sensitive patterns that should never be exposed
    this.sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /key/i,
      /credential/i,
      /auth/i,
      /session/i,
      /jwt/i,
      /bearer/i,
      /api[_-]?key/i,
      /db[_-]?pass/i,
      /connection[_-]?string/i
    ];

    // ✅ Error statistics
    this.stats = {
      totalErrors: 0,
      errorsByCategory: {},
      errorsByStatus: {},
      lastError: null,
      startTime: Date.now()
    };

    console.log('🛡️ UnifiedErrorHandler initialized:', {
      categories: Object.keys(this.errorCategories).length,
      sensitivePatterns: this.sensitivePatterns.length,
      defaultLogging: true
    });
  }

  /**
   * 🎯 MAIN ERROR HANDLING METHODS
   */

  async handleError(error, req = null, res = null, options = {}) {
    const {
      category = null,
      statusCode = null,
      userId = null,
      correlationId = null,
      context = {},
      skipAudit = false,
      skipResponse = false
    } = options;

    const startTime = Date.now();

    try {
      // ✅ Generate correlation ID if not provided
      const errorCorrelationId = correlationId || this.generateCorrelationId();

      // ✅ Determine error details
      const errorDetails = this.analyzeError(error, {
        category,
        statusCode,
        context,
        req
      });

      // ✅ Update statistics
      this.updateErrorStats(errorDetails);

      // ✅ Log error
      await this.logError(error, errorDetails, {
        userId,
        correlationId: errorCorrelationId,
        context,
        req
      });

      // ✅ Audit sensitive errors
      if (errorDetails.requiresAudit && !skipAudit) {
        await this.auditError(error, errorDetails, {
          userId,
          correlationId: errorCorrelationId,
          context,
          req
        });
      }

      // ✅ Send response if res object provided
      if (res && !skipResponse && !res.headersSent) {
        return this.sendErrorResponse(res, errorDetails, {
          correlationId: errorCorrelationId,
          startTime
        });
      }

      // ✅ Return error details for manual handling
      return {
        success: false,
        error: errorDetails,
        correlationId: errorCorrelationId,
        handlingTime: Date.now() - startTime
      };

    } catch (handlingError) {
      // ✅ Fallback error handling
      console.error('❌ Critical: Error handler failed:', handlingError);
      
      if (res && !res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Internal server error',
          errorCode: 'ERROR_HANDLER_FAILURE',
          correlationId: correlationId || 'unknown',
          timestamp: new Date().toISOString()
        });
      }

      throw handlingError;
    }
  }

  analyzeError(error, options = {}) {
    const {
      category = null,
      statusCode = null,
      context = {},
      req = null
    } = options;

    // ✅ Start with error basics
    let errorDetails = {
      name: error.name || 'Error',
      message: error.message || 'Unknown error',
      stack: error.stack || null,
      category: category,
      statusCode: statusCode,
      errorCode: error.code || null,
      isOperational: error.isOperational || false
    };

    // ✅ Determine category if not provided
    if (!errorDetails.category) {
      errorDetails.category = this.categorizeError(error, req);
    }

    // ✅ Get category configuration
    const categoryConfig = this.errorCategories[errorDetails.category] || this.errorCategories.SYSTEM;

    // ✅ Set status code if not provided
    if (!errorDetails.statusCode) {
      errorDetails.statusCode = error.statusCode || categoryConfig.defaultStatus;
    }

    // ✅ Apply category configuration
    errorDetails = {
      ...errorDetails,
      logLevel: categoryConfig.logLevel,
      exposeDetails: categoryConfig.exposeDetails,
      requiresAudit: categoryConfig.requiresAudit,
      defaultMessage: categoryConfig.defaultMessage
    };

    // ✅ Sanitize sensitive information
    errorDetails.sanitizedMessage = this.sanitizeMessage(errorDetails.message);
    errorDetails.publicMessage = errorDetails.exposeDetails 
      ? errorDetails.sanitizedMessage 
      : errorDetails.defaultMessage;

    // ✅ Add context
    errorDetails.context = {
      ...context,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };

    return errorDetails;
  }

  categorizeError(error, req = null) {
    const message = (error.message || '').toLowerCase();
    const name = (error.name || '').toLowerCase();

    // ✅ Authentication errors
    if (name.includes('jwt') || message.includes('token') || message.includes('unauthorized')) {
      return 'AUTH';
    }

    // ✅ Authorization errors
    if (message.includes('forbidden') || message.includes('access denied') || error.statusCode === 403) {
      return 'FORBIDDEN';
    }

    // ✅ Validation errors
    if (name.includes('validation') || message.includes('invalid') || error.statusCode === 400) {
      return 'VALIDATION';
    }

    // ✅ Not found errors
    if (message.includes('not found') || error.statusCode === 404) {
      return 'NOT_FOUND';
    }

    // ✅ Rate limit errors
    if (message.includes('rate limit') || message.includes('too many') || error.statusCode === 429) {
      return 'RATE_LIMIT';
    }

    // ✅ Payment errors
    if (message.includes('payment') || message.includes('midtrans') || message.includes('transaction')) {
      return 'PAYMENT';
    }

    // ✅ Database errors
    if (name.includes('prisma') || message.includes('database') || message.includes('connection')) {
      return 'DATABASE';
    }

    // ✅ Network/timeout errors
    if (message.includes('timeout') || message.includes('network') || message.includes('econnreset')) {
      return 'NETWORK';
    }

    // ✅ External service errors
    if (message.includes('api') || message.includes('external') || message.includes('service')) {
      return 'EXTERNAL';
    }

    // ✅ Default to system error
    return 'SYSTEM';
  }

  sanitizeMessage(message) {
    if (!message) return 'No error message available';

    let sanitized = message;

    // ✅ Remove sensitive information
    this.sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    // ✅ Remove file paths in production
    if (process.env.NODE_ENV === 'production') {
      sanitized = sanitized.replace(/\/[a-zA-Z0-9_\-\/\.]+\.js/g, '[FILE_PATH]');
      sanitized = sanitized.replace(/at [a-zA-Z0-9_\-\/\.]+\.js:[0-9]+:[0-9]+/g, '[STACK_TRACE]');
    }

    return sanitized;
  }

  async logError(error, errorDetails, options = {}) {
    const {
      userId = null,
      correlationId = null,
      context = {},
      req = null
    } = options;

    const logData = {
      error: {
        name: errorDetails.name,
        message: errorDetails.sanitizedMessage,
        category: errorDetails.category,
        statusCode: errorDetails.statusCode,
        errorCode: errorDetails.errorCode,
        isOperational: errorDetails.isOperational
      },
      context: errorDetails.context,
      request: req ? {
        method: req.method,
        url: req.url,
        userAgent: req.get('user-agent'),
        ip: req.ip,
        userId: userId
      } : null,
      stack: process.env.NODE_ENV === 'development' ? errorDetails.stack : '[REDACTED]'
    };

    // ✅ Log based on severity
    switch (errorDetails.logLevel) {
      case 'error':
        this.logger.error(errorDetails.sanitizedMessage, logData, { correlationId });
        break;
      case 'warn':
        this.logger.warn(errorDetails.sanitizedMessage, logData, { correlationId });
        break;
      case 'info':
      default:
        this.logger.info(errorDetails.sanitizedMessage, logData, { correlationId });
        break;
    }
  }

  async auditError(error, errorDetails, options = {}) {
    const {
      userId = null,
      correlationId = null,
      context = {},
      req = null
    } = options;

    try {
      await this.auditService.logEvent('ERROR_OCCURRED', {
        userId,
        resourceType: 'error',
        resourceId: correlationId,
        metadata: {
          errorCategory: errorDetails.category,
          statusCode: errorDetails.statusCode,
          errorCode: errorDetails.errorCode,
          message: errorDetails.sanitizedMessage,
          context: context,
          request: req ? {
            method: req.method,
            url: req.url,
            ip: req.ip
          } : null
        }
      });
    } catch (auditError) {
      console.error('❌ Failed to audit error:', auditError);
    }
  }

  sendErrorResponse(res, errorDetails, options = {}) {
    const {
      correlationId = null,
      startTime = Date.now()
    } = options;

    return this.responseFormatter.error(res, {
      message: errorDetails.publicMessage,
      statusCode: errorDetails.statusCode,
      errorCode: errorDetails.errorCode || `${errorDetails.category}_ERROR`,
      details: errorDetails.exposeDetails ? {
        category: errorDetails.category,
        context: errorDetails.context
      } : undefined,
      correlationId,
      startTime
    });
  }

  updateErrorStats(errorDetails) {
    this.stats.totalErrors++;
    this.stats.lastError = {
      category: errorDetails.category,
      statusCode: errorDetails.statusCode,
      timestamp: new Date().toISOString()
    };

    // ✅ Update category stats
    if (!this.stats.errorsByCategory[errorDetails.category]) {
      this.stats.errorsByCategory[errorDetails.category] = 0;
    }
    this.stats.errorsByCategory[errorDetails.category]++;

    // ✅ Update status code stats
    if (!this.stats.errorsByStatus[errorDetails.statusCode]) {
      this.stats.errorsByStatus[errorDetails.statusCode] = 0;
    }
    this.stats.errorsByStatus[errorDetails.statusCode]++;
  }

  generateCorrelationId() {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * 🛠️ SPECIALIZED ERROR HANDLERS
   */

  createAuthError(message = 'Authentication required', options = {}) {
    const error = new Error(message);
    error.statusCode = 401;
    error.category = 'AUTH';
    error.isOperational = true;
    return error;
  }

  createValidationError(message, details = null, options = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.category = 'VALIDATION';
    error.isOperational = true;
    error.details = details;
    return error;
  }

  createNotFoundError(resource = 'Resource', options = {}) {
    const error = new Error(`${resource} not found`);
    error.statusCode = 404;
    error.category = 'NOT_FOUND';
    error.isOperational = true;
    return error;
  }

  createBusinessError(message, options = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.category = 'BUSINESS';
    error.isOperational = true;
    return error;
  }

  createPaymentError(message, options = {}) {
    const error = new Error(message);
    error.statusCode = 400;
    error.category = 'PAYMENT';
    error.isOperational = true;
    return error;
  }

  /**
   * 📊 MONITORING & STATISTICS
   */

  getErrorStats() {
    const uptime = Date.now() - this.stats.startTime;
    
    return {
      ...this.stats,
      errorRate: this.stats.totalErrors > 0 ? (this.stats.totalErrors / (uptime / 1000)).toFixed(4) + '/sec' : '0/sec',
      uptime: uptime,
      topErrorCategories: Object.entries(this.stats.errorsByCategory)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {}),
      topErrorStatuses: Object.entries(this.stats.errorsByStatus)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {})
    };
  }

  getHealthStatus() {
    const recentErrors = this.stats.totalErrors;
    const criticalErrors = (this.stats.errorsByStatus[500] || 0) + (this.stats.errorsByStatus[503] || 0);
    
    return {
      status: criticalErrors < 10 ? 'healthy' : 'degraded',
      totalErrors: recentErrors,
      criticalErrors,
      lastError: this.stats.lastError,
      categories: Object.keys(this.errorCategories).length
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    console.log('✅ UnifiedErrorHandler cleanup completed');
  }
}

module.exports = UnifiedErrorHandler;