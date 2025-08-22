const LoggingService = require('../services/core/LoggingService');
const ConfigService = require('../services/core/ConfigService');
const AuditLogService = require('../services/core/AuditLogService');

/**
 * 📝 STRUCTURED LOGGING MIDDLEWARE
 * 
 * Enterprise logging system for DanceSignal API:
 * - Replaces all console.log with structured logging
 * - Adds correlation IDs to all log entries
 * - Provides request/response logging with performance metrics
 * - Integrates with centralized LoggingService
 * - Supports multiple log levels and filtering
 * - Enables distributed tracing and monitoring
 * 
 * ✅ Observability: Complete request lifecycle tracking
 * ✅ Performance: Request timing and performance metrics
 * ✅ Security: Sensitive data filtering and redaction
 * ✅ Correlation: Request tracing across services
 */

let logger = null;
let configService = null;
let auditService = null;

// ✅ Initialize services lazily
function getServices() {
  if (!logger) {
    logger = new LoggingService();
    configService = new ConfigService();
    auditService = new AuditLogService();
  }
  return { logger, configService, auditService };
}

/**
 * 🎯 REQUEST/RESPONSE LOGGING MIDDLEWARE
 */

function requestLoggingMiddleware(options = {}) {
  const {
    logRequests = true,
    logResponses = true,
    logHeaders = false,
    logBody = false,
    logPerformance = true,
    skipPaths = ['/health', '/favicon.ico'],
    skipMethods = [],
    maxBodySize = 1024 * 10, // 10KB
    sensitiveFields = ['password', 'token', 'secret', 'key']
  } = options;

  return (req, res, next) => {
    const { logger } = getServices();
    const startTime = Date.now();
    
    // ✅ Skip logging for specified paths
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // ✅ Skip logging for specified methods
    if (skipMethods.includes(req.method)) {
      return next();
    }

    // ✅ Ensure correlation ID exists
    if (!req.correlationId) {
      req.correlationId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    req.requestStartTime = startTime;

    // ✅ Build request log data
    const requestLogData = {
      request: {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        params: req.params,
        userAgent: req.get('user-agent'),
        referer: req.get('referer'),
        origin: req.get('origin'),
        ip: req.ip,
        ips: req.ips
      },
      user: {
        id: req.user?.id || null,
        email: req.user?.email || null,
        role: req.user?.role || null
      },
      timing: {
        requestStartTime: startTime,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add headers if enabled
    if (logHeaders) {
      requestLogData.request.headers = filterSensitiveData(req.headers, sensitiveFields);
    }

    // ✅ Add body if enabled and safe
    if (logBody && req.body && shouldLogBody(req, maxBodySize)) {
      requestLogData.request.body = filterSensitiveData(req.body, sensitiveFields);
    }

    // ✅ Log incoming request
    if (logRequests) {
      logger.info('Incoming request', requestLogData, { correlationId: req.correlationId });
    }

    // ✅ Override res.json to capture response
    const originalJson = res.json;
    res.json = function(data) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // ✅ Build response log data
      const responseLogData = {
        response: {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          duration: `${duration}ms`,
          size: JSON.stringify(data).length
        },
        performance: {
          requestDuration: duration,
          slow: duration > 1000, // Mark as slow if > 1 second
          veryFast: duration < 100 // Mark as very fast if < 100ms
        },
        request: {
          method: req.method,
          url: req.url,
          userAgent: req.get('user-agent')?.substring(0, 100)
        },
        user: {
          id: req.user?.id || null
        }
      };

      // ✅ Add response headers if enabled
      if (logHeaders) {
        responseLogData.response.headers = filterSensitiveData(res.getHeaders(), sensitiveFields);
      }

      // ✅ Add response body if enabled and safe
      if (logResponses && shouldLogResponseBody(res, data, maxBodySize)) {
        responseLogData.response.body = filterSensitiveData(data, sensitiveFields);
      }

      // ✅ Determine log level based on status code
      let logLevel = 'info';
      if (res.statusCode >= 500) {
        logLevel = 'error';
      } else if (res.statusCode >= 400) {
        logLevel = 'warn';
      } else if (duration > 2000) {
        logLevel = 'warn'; // Slow requests
      }

      // ✅ Log response
      logger[logLevel]('Request completed', responseLogData, { correlationId: req.correlationId });

      // ✅ Log performance metrics
      if (logPerformance) {
        logPerformanceMetrics(req, res, duration, { logger });
      }

      return originalJson.call(this, data);
    };

    // ✅ Override res.send for non-JSON responses
    const originalSend = res.send;
    res.send = function(data) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (!res.headersSent) {
        const responseLogData = {
          response: {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            duration: `${duration}ms`,
            contentType: res.get('content-type')
          },
          request: {
            method: req.method,
            url: req.url
          },
          user: {
            id: req.user?.id || null
          }
        };

        let logLevel = 'info';
        if (res.statusCode >= 500) {
          logLevel = 'error';
        } else if (res.statusCode >= 400) {
          logLevel = 'warn';
        }

        logger[logLevel]('Request completed (non-JSON)', responseLogData, { correlationId: req.correlationId });
      }

      return originalSend.call(this, data);
    };

    next();
  };
}

/**
 * 📊 PERFORMANCE LOGGING
 */

function logPerformanceMetrics(req, res, duration, { logger }) {
  const performanceData = {
    performance: {
      requestDuration: duration,
      endpoint: `${req.method} ${req.path}`,
      statusCode: res.statusCode,
      category: categorizePerformance(duration),
      userId: req.user?.id || null,
      timestamp: new Date().toISOString()
    }
  };

  // ✅ Log based on performance category
  if (duration > 5000) {
    logger.warn('Very slow request', performanceData, { correlationId: req.correlationId });
  } else if (duration > 2000) {
    logger.warn('Slow request', performanceData, { correlationId: req.correlationId });
  } else if (duration < 50) {
    logger.info('Very fast request', performanceData, { correlationId: req.correlationId });
  }

  // ✅ Store performance metrics for monitoring
  // TODO: Could send to metrics collection service
}

function categorizePerformance(duration) {
  if (duration < 100) return 'VERY_FAST';
  if (duration < 500) return 'FAST';
  if (duration < 1000) return 'NORMAL';
  if (duration < 2000) return 'SLOW';
  if (duration < 5000) return 'VERY_SLOW';
  return 'EXTREMELY_SLOW';
}

/**
 * 🔒 SECURITY & FILTERING
 */

function filterSensitiveData(data, sensitiveFields = []) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const defaultSensitiveFields = [
    'password', 'confirmPassword', 'oldPassword', 'newPassword',
    'token', 'accessToken', 'refreshToken', 'sessionToken',
    'secret', 'apiKey', 'key', 'credential',
    'authorization', 'cookie', 'set-cookie',
    'cardNumber', 'cvv', 'pin', 'ssn',
    'privateKey', 'publicKey'
  ];

  const allSensitiveFields = [...defaultSensitiveFields, ...sensitiveFields];
  const filtered = {};

  for (const [key, value] of Object.entries(data)) {
    const isKeyLowerCase = key.toLowerCase();
    const isSensitive = allSensitiveFields.some(field => 
      isKeyLowerCase.includes(field.toLowerCase())
    );

    if (isSensitive) {
      filtered[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = filterSensitiveData(value, sensitiveFields);
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

function shouldLogBody(req, maxBodySize) {
  // ✅ Don't log body for file uploads
  const contentType = req.get('content-type') || '';
  if (contentType.includes('multipart/form-data') || 
      contentType.includes('application/octet-stream')) {
    return false;
  }

  // ✅ Check body size
  const bodyString = JSON.stringify(req.body || {});
  return bodyString.length <= maxBodySize;
}

function shouldLogResponseBody(res, data, maxBodySize) {
  // ✅ Don't log large responses
  const dataString = JSON.stringify(data || {});
  if (dataString.length > maxBodySize) {
    return false;
  }

  // ✅ Don't log binary data
  const contentType = res.get('content-type') || '';
  if (contentType.includes('image/') || 
      contentType.includes('video/') || 
      contentType.includes('audio/') ||
      contentType.includes('application/octet-stream')) {
    return false;
  }

  return true;
}

/**
 * 🎯 CONSOLE.LOG REPLACEMENT
 */

function replaceConsoleLogging() {
  const { logger } = getServices();

  // ✅ Store original console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  // ✅ Replace console methods with structured logging
  console.log = (...args) => {
    const message = formatConsoleMessage(args);
    logger.info(message, { source: 'console', args: args.slice(1) });
  };

  console.info = (...args) => {
    const message = formatConsoleMessage(args);
    logger.info(message, { source: 'console', args: args.slice(1) });
  };

  console.warn = (...args) => {
    const message = formatConsoleMessage(args);
    logger.warn(message, { source: 'console', args: args.slice(1) });
  };

  console.error = (...args) => {
    const message = formatConsoleMessage(args);
    logger.error(message, { source: 'console', args: args.slice(1) });
  };

  console.debug = (...args) => {
    const message = formatConsoleMessage(args);
    logger.debug(message, { source: 'console', args: args.slice(1) });
  };

  // ✅ Provide restore function for testing
  console.restore = () => {
    Object.assign(console, originalConsole);
  };

  console.log('📝 Console logging replaced with structured logging');
}

function formatConsoleMessage(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (error) {
        return '[Circular Object]';
      }
    }
    return String(arg);
  }).join(' ');
}

/**
 * 🔧 SPECIALIZED LOGGING MIDDLEWARE
 */

function databaseQueryLoggingMiddleware() {
  return (req, res, next) => {
    // ✅ Track database queries if Prisma logging is enabled
    const { logger } = getServices();
    
    // TODO: Integrate with Prisma query logging
    // This would capture slow queries, query count, etc.
    
    next();
  };
}

function securityLoggingMiddleware() {
  return (req, res, next) => {
    const { logger, auditService } = getServices();
    
    // ✅ Log security-relevant events
    const securityEvents = [
      'login', 'logout', 'password-change', 'password-reset',
      'account-creation', 'account-deletion', 'role-change',
      'payment-creation', 'payment-completion', 'refund-request'
    ];

    const originalJson = res.json;
    res.json = function(data) {
      // ✅ Check if this is a security-relevant endpoint
      const path = req.path.toLowerCase();
      const method = req.method.toLowerCase();
      
      if (securityEvents.some(event => path.includes(event))) {
        auditService.logEvent('SECURITY_RELEVANT_REQUEST', {
          userId: req.user?.id,
          resourceType: 'security',
          resourceId: req.correlationId,
          metadata: {
            endpoint: `${method.toUpperCase()} ${req.path}`,
            statusCode: res.statusCode,
            userAgent: req.get('user-agent'),
            ip: req.ip
          }
        });
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * 🚀 APPLICATION HELPERS
 */

function applyStructuredLogging(app, options = {}) {
  console.log('📝 Applying structured logging middleware...');

  const {
    replaceConsole = true,
    logRequests = true,
    logResponses = true,
    logSecurity = true,
    logDatabase = false
  } = options;

  // ✅ Replace console.log with structured logging
  if (replaceConsole) {
    replaceConsoleLogging();
  }

  // ✅ Apply request/response logging
  if (logRequests || logResponses) {
    app.use(requestLoggingMiddleware({
      logRequests,
      logResponses,
      logHeaders: process.env.NODE_ENV === 'development',
      logBody: process.env.NODE_ENV === 'development'
    }));
  }

  // ✅ Apply security logging
  if (logSecurity) {
    app.use(securityLoggingMiddleware());
  }

  // ✅ Apply database query logging
  if (logDatabase) {
    app.use(databaseQueryLoggingMiddleware());
  }

  console.log('✅ Structured logging applied successfully');
}

/**
 * 📊 LOGGING STATISTICS
 */

function getLoggingStats() {
  const { logger } = getServices();
  
  // TODO: Implement logging statistics collection
  return {
    totalRequests: 0,
    errorRate: '0%',
    averageResponseTime: '0ms',
    slowRequests: 0,
    lastLogEntry: new Date().toISOString()
  };
}

/**
 * 🎯 EXPORTS
 */

module.exports = {
  // Main middleware
  requestLoggingMiddleware,
  
  // Specialized logging
  databaseQueryLoggingMiddleware,
  securityLoggingMiddleware,
  
  // Console replacement
  replaceConsoleLogging,
  formatConsoleMessage,
  
  // Application helpers
  applyStructuredLogging,
  
  // Utilities
  filterSensitiveData,
  shouldLogBody,
  shouldLogResponseBody,
  logPerformanceMetrics,
  categorizePerformance,
  
  // Monitoring
  getLoggingStats
};