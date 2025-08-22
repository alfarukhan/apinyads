/**
 * 🚨 CENTRALIZED ERROR HANDLER
 * 
 * Unified error handling for all DanceSignal services:
 * - Consistent error response formats
 * - Security-safe error messages
 * - Structured error logging
 * - Error classification & routing
 * - Correlation ID tracking
 */
class ErrorHandler {
  constructor() {
    // ✅ CENTRALIZED: Error code taxonomy
    this.errorCodes = {
      // Payment Errors (2xxx)
      PAYMENT_CREATION_FAILED: { code: 2001, httpStatus: 500, userMessage: 'Failed to create payment. Please try again.' },
      PAYMENT_NOT_FOUND: { code: 2002, httpStatus: 404, userMessage: 'Payment not found.' },
      PAYMENT_ALREADY_PAID: { code: 2003, httpStatus: 400, userMessage: 'Payment has already been completed.' },
      PAYMENT_EXPIRED: { code: 2004, httpStatus: 400, userMessage: 'Payment has expired. Please create a new payment.' },
      PAYMENT_VERIFICATION_FAILED: { code: 2005, httpStatus: 500, userMessage: 'Payment verification failed. Please contact support.' },
      
      // Validation Errors (3xxx)
      VALIDATION_ERROR: { code: 3001, httpStatus: 400, userMessage: 'Invalid input provided.' },
      AMOUNT_OUT_OF_RANGE: { code: 3002, httpStatus: 400, userMessage: 'Payment amount is not within allowed range.' },
      INVALID_PAYMENT_METHOD: { code: 3003, httpStatus: 400, userMessage: 'Selected payment method is not supported.' },
      INVALID_USER_ID: { code: 3004, httpStatus: 400, userMessage: 'Invalid user identification.' },
      INVALID_EVENT_ID: { code: 3005, httpStatus: 400, userMessage: 'Invalid event identification.' },
      
      // Rate Limiting Errors (4xxx)
      RATE_LIMIT_EXCEEDED: { code: 4001, httpStatus: 429, userMessage: 'Too many requests. Please wait before trying again.' },
      VERIFICATION_RATE_LIMIT: { code: 4002, httpStatus: 429, userMessage: 'Too many verification attempts. Please wait before trying again.' },
      
      // Business Logic Errors (5xxx)
      EVENT_NOT_FOUND: { code: 5001, httpStatus: 404, userMessage: 'Event not found or no longer available.' },
      USER_NOT_ELIGIBLE: { code: 5002, httpStatus: 403, userMessage: 'You are not eligible for this payment.' },
      CAPACITY_EXCEEDED: { code: 5003, httpStatus: 400, userMessage: 'Event capacity has been reached.' },
      ALREADY_REGISTERED: { code: 5004, httpStatus: 400, userMessage: 'You are already registered for this event.' },
      
      // External Service Errors (6xxx)
      MIDTRANS_ERROR: { code: 6001, httpStatus: 502, userMessage: 'Payment gateway error. Please try again.' },
      DATABASE_ERROR: { code: 6002, httpStatus: 500, userMessage: 'Database error. Please try again.' },
      NOTIFICATION_ERROR: { code: 6003, httpStatus: 500, userMessage: 'Notification service error. Payment may still be successful.' },
      
      // Authentication Errors (7xxx)
      UNAUTHORIZED: { code: 7001, httpStatus: 401, userMessage: 'Authentication required.' },
      FORBIDDEN: { code: 7002, httpStatus: 403, userMessage: 'Access denied.' },
      TOKEN_EXPIRED: { code: 7003, httpStatus: 401, userMessage: 'Session expired. Please login again.' },
      
      // Generic Errors (9xxx)
      INTERNAL_ERROR: { code: 9001, httpStatus: 500, userMessage: 'Internal server error. Please try again.' },
      SERVICE_UNAVAILABLE: { code: 9002, httpStatus: 503, userMessage: 'Service temporarily unavailable. Please try again later.' },
      UNKNOWN_ERROR: { code: 9999, httpStatus: 500, userMessage: 'An unexpected error occurred. Please try again.' }
    };

    // ✅ CENTRALIZED: Error severity levels
    this.severityLevels = {
      LOW: 'low',       // Minor validation errors, user input issues
      MEDIUM: 'medium', // Business logic errors, rate limiting
      HIGH: 'high',     // Payment failures, external service errors
      CRITICAL: 'critical' // Security issues, data corruption, system failures
    };
  }

  /**
   * 🚨 HANDLE PAYMENT ERROR
   * 
   * Primary error handler for payment-related errors
   */
  handlePaymentError(error, correlationId = null) {
    const errorDetails = this.analyzeError(error);
    const severity = this.determineSeverity(error, errorDetails);
    
    // ✅ Log error with structured format
    this.logError(error, errorDetails, severity, correlationId);
    
    // ✅ Create user-safe response
    const response = this.createErrorResponse(errorDetails, correlationId);
    
    // ✅ Alert if critical
    if (severity === this.severityLevels.CRITICAL) {
      this.sendCriticalAlert(error, errorDetails, correlationId);
    }
    
    return response;
  }

  /**
   * 🔍 ANALYZE ERROR
   * 
   * Determines error type and appropriate handling
   */
  analyzeError(error) {
    // ✅ Check for known error types
    if (error.name === 'ValidationError') {
      return {
        type: 'VALIDATION_ERROR',
        details: error.details || {},
        originalMessage: error.message
      };
    }

    // ✅ Midtrans errors
    if (error.message && error.message.includes('Midtrans')) {
      return {
        type: 'MIDTRANS_ERROR',
        details: { 
          httpStatusCode: error.httpStatusCode,
          apiResponse: error.ApiResponse 
        },
        originalMessage: error.message
      };
    }

    // ✅ Database errors
    if (error.name === 'PrismaClientValidationError' || 
        error.name === 'PrismaClientKnownRequestError') {
      return {
        type: 'DATABASE_ERROR',
        details: { 
          code: error.code,
          meta: error.meta 
        },
        originalMessage: error.message
      };
    }

    // ✅ Rate limiting errors
    if (error.message && error.message.includes('Rate limit')) {
      return {
        type: 'RATE_LIMIT_EXCEEDED',
        details: {},
        originalMessage: error.message
      };
    }

    // ✅ Business logic errors (based on message patterns)
    if (error.message && error.message.includes('not found')) {
      const type = error.message.includes('Payment') ? 'PAYMENT_NOT_FOUND' :
                   error.message.includes('Event') ? 'EVENT_NOT_FOUND' :
                   'UNKNOWN_ERROR';
      return {
        type,
        details: {},
        originalMessage: error.message
      };
    }

    // ✅ Default to unknown error
    return {
      type: 'UNKNOWN_ERROR',
      details: {},
      originalMessage: error.message || 'Unknown error occurred'
    };
  }

  /**
   * 📊 DETERMINE SEVERITY
   */
  determineSeverity(error, errorDetails) {
    switch (errorDetails.type) {
      case 'VALIDATION_ERROR':
      case 'INVALID_PAYMENT_METHOD':
      case 'INVALID_USER_ID':
      case 'INVALID_EVENT_ID':
        return this.severityLevels.LOW;

      case 'RATE_LIMIT_EXCEEDED':
      case 'VERIFICATION_RATE_LIMIT':
      case 'EVENT_NOT_FOUND':
      case 'USER_NOT_ELIGIBLE':
      case 'CAPACITY_EXCEEDED':
      case 'ALREADY_REGISTERED':
        return this.severityLevels.MEDIUM;

      case 'PAYMENT_CREATION_FAILED':
      case 'PAYMENT_VERIFICATION_FAILED':
      case 'MIDTRANS_ERROR':
      case 'NOTIFICATION_ERROR':
        return this.severityLevels.HIGH;

      case 'DATABASE_ERROR':
      case 'INTERNAL_ERROR':
      case 'SERVICE_UNAVAILABLE':
        return this.severityLevels.CRITICAL;

      default:
        return this.severityLevels.MEDIUM;
    }
  }

  /**
   * 📝 STRUCTURED ERROR LOGGING
   */
  logError(error, errorDetails, severity, correlationId) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId || 'unknown',
      severity,
      errorType: errorDetails.type,
      errorCode: this.errorCodes[errorDetails.type]?.code || 9999,
      message: errorDetails.originalMessage,
      details: errorDetails.details,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      service: 'PaymentService',
      environment: process.env.NODE_ENV || 'unknown'
    };

    // ✅ Use appropriate log level
    switch (severity) {
      case this.severityLevels.LOW:
        console.info('🔵 PAYMENT_ERROR_LOW:', JSON.stringify(logEntry, null, 2));
        break;
      case this.severityLevels.MEDIUM:
        console.warn('🟡 PAYMENT_ERROR_MEDIUM:', JSON.stringify(logEntry, null, 2));
        break;
      case this.severityLevels.HIGH:
        console.error('🔴 PAYMENT_ERROR_HIGH:', JSON.stringify(logEntry, null, 2));
        break;
      case this.severityLevels.CRITICAL:
        console.error('💥 PAYMENT_ERROR_CRITICAL:', JSON.stringify(logEntry, null, 2));
        break;
      default:
        console.error('❓ PAYMENT_ERROR_UNKNOWN:', JSON.stringify(logEntry, null, 2));
    }
  }

  /**
   * 📨 CREATE ERROR RESPONSE
   * 
   * Creates standardized error response for API
   */
  createErrorResponse(errorDetails, correlationId) {
    const errorConfig = this.errorCodes[errorDetails.type] || this.errorCodes.UNKNOWN_ERROR;
    
    const response = {
      success: false,
      error: {
        code: errorConfig.code,
        // ✅ FIX: Show detailed error in development mode OR when debugging payments
        message: (process.env.NODE_ENV === 'development' || process.env.DEBUG_PAYMENTS === 'true')
          ? errorDetails.originalMessage || errorConfig.userMessage
          : errorConfig.userMessage,
        type: errorDetails.type,
        correlationId: correlationId || 'unknown',
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add validation details for client-side handling
    if (errorDetails.type === 'VALIDATION_ERROR' && errorDetails.details) {
      response.error.validationErrors = errorDetails.details;
    }

    // ✅ Add helpful hints for specific errors
    switch (errorDetails.type) {
      case 'RATE_LIMIT_EXCEEDED':
        response.error.retryAfter = 300; // 5 minutes
        break;
      case 'PAYMENT_EXPIRED':
        response.error.action = 'CREATE_NEW_PAYMENT';
        break;
      case 'MIDTRANS_ERROR':
        response.error.action = 'RETRY_PAYMENT';
        break;
    }

    // ✅ Create Error object with proper HTTP status
    // ✅ FIX: Show detailed error in development mode OR when debugging payments
    const errorMessage = (process.env.NODE_ENV === 'development' || process.env.DEBUG_PAYMENTS === 'true')
      ? errorDetails.originalMessage || errorConfig.userMessage
      : errorConfig.userMessage;
    const errorResponse = new Error(errorMessage);
    errorResponse.statusCode = errorConfig.httpStatus;
    errorResponse.isOperational = true;
    errorResponse.details = response;
    
    return errorResponse;
  }

  /**
   * 🚨 SEND CRITICAL ALERT
   * 
   * Alerts for critical errors that need immediate attention
   */
  sendCriticalAlert(error, errorDetails, correlationId) {
    const alertData = {
      service: 'PaymentService',
      severity: 'CRITICAL',
      errorType: errorDetails.type,
      correlationId,
      timestamp: new Date().toISOString(),
      message: errorDetails.originalMessage,
      environment: process.env.NODE_ENV
    };

    // ✅ Log critical alert
    console.error('🚨 CRITICAL_PAYMENT_ALERT:', JSON.stringify(alertData, null, 2));

    // TODO: Integrate with alerting service (Slack, PagerDuty, etc.)
    // await this.sendSlackAlert(alertData);
    // await this.sendEmailAlert(alertData);
  }

  /**
   * 🎯 SPECIFIC ERROR CREATORS
   */
  createValidationError(message, details = {}) {
    const error = new Error(message);
    error.name = 'ValidationError';
    error.details = details;
    return error;
  }

  createPaymentError(type, details = {}) {
    const errorConfig = this.errorCodes[type] || this.errorCodes.PAYMENT_CREATION_FAILED;
    const error = new Error(errorConfig.userMessage);
    error.type = type;
    error.details = details;
    return error;
  }

  createRateLimitError(attempts, window) {
    const error = new Error(`Rate limit exceeded: ${attempts} attempts in ${window}ms`);
    error.type = 'RATE_LIMIT_EXCEEDED';
    error.details = { attempts, window };
    return error;
  }

  /**
   * 🔧 UTILITY METHODS
   */
  isOperationalError(error) {
    return error.isOperational === true;
  }

  getErrorCode(errorType) {
    return this.errorCodes[errorType]?.code || 9999;
  }

  getHttpStatus(errorType) {
    return this.errorCodes[errorType]?.httpStatus || 500;
  }

  getUserMessage(errorType) {
    return this.errorCodes[errorType]?.userMessage || 'An unexpected error occurred.';
  }
}

module.exports = ErrorHandler;