const AuditLogService = require('../services/core/AuditLogService');

/**
 * 📋 AUDIT LOGGING MIDDLEWARE
 * 
 * Automatically logs all API requests and responses for audit purposes:
 * - Request details & user context
 * - Response status & timing
 * - Security events & anomalies
 * - Compliance & forensic tracking
 * 
 * ✅ Automatic: Logs all API activity
 * ✅ Performance: Async background logging
 * ✅ Security: Tracks suspicious activity
 */

/**
 * 🔍 MAIN AUDIT MIDDLEWARE
 * 
 * Logs API requests automatically
 */
const auditMiddleware = async (req, res, next) => {
  const auditService = new AuditLogService();
  
  // ✅ Capture request start time
  const requestStartTime = Date.now();
  
  // ✅ Override res.json to capture response details
  const originalJson = res.json;
  const originalStatus = res.status;
  let responseStatus = 200;
  let responseData = null;

  // ✅ Capture status code
  res.status = function(code) {
    responseStatus = code;
    return originalStatus.call(this, code);
  };

  // ✅ Capture response data
  res.json = function(data) {
    responseData = data;
    
    // ✅ Log API request in background after response
    setImmediate(async () => {
      try {
        const responseTime = Date.now() - requestStartTime;
        
        await auditService.logApiRequest({
          userId: req.user?.id || null,
          requestId: req.requestId || null,
          sessionId: req.sessionId || null,
          endpoint: req.path,
          method: req.method,
          statusCode: responseStatus,
          responseTime: responseTime,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          correlationId: req.correlationId || req.requestId,
          
          // Request details
          queryParams: Object.keys(req.query).length > 0 ? req.query : null,
          bodySize: req.body ? JSON.stringify(req.body).length : 0,
          
          // Response details
          responseSize: responseData ? JSON.stringify(responseData).length : 0,
          success: responseStatus < 400,
          
          // Error details if applicable
          errorMessage: responseStatus >= 400 ? responseData?.error?.message : null,
          errorCode: responseStatus >= 400 ? responseData?.error?.code : null,
          
          // Additional metadata
          metadata: {
            userRole: req.user?.role,
            deviceId: req.tokenData?.deviceId,
            apiVersion: process.env.API_VERSION || '2.0'
          }
        });
        
      } catch (auditError) {
        console.error('❌ Audit logging failed:', auditError);
        // Don't throw - audit failures shouldn't break API
      }
    });
    
    return originalJson.call(this, data);
  };

  next();
};

/**
 * 🛡️ SECURITY AUDIT MIDDLEWARE
 * 
 * Tracks security-relevant events
 */
const securityAuditMiddleware = async (req, res, next) => {
  const auditService = new AuditLogService();
  
  try {
    // ✅ Check for suspicious patterns
    const suspiciousPatterns = [
      // Common attack patterns
      /(\bSELECT\b|\bUNION\b|\bINSERT\b|\bDELETE\b|\bDROP\b)/i, // SQL injection
      /(<script|javascript:|data:)/i, // XSS attempts
      /(\.\.\/|\.\.\\)/g, // Path traversal
      /(\bexec\b|\beval\b|\bsystem\b)/i // Command injection
    ];

    const userInput = JSON.stringify({
      query: req.query,
      body: req.body,
      path: req.path
    });

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(userInput)) {
        // ✅ Log suspicious activity
        await auditService.logSuspiciousActivity({
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          activityType: 'MALICIOUS_INPUT_DETECTED',
          description: `Suspicious pattern detected in request: ${pattern.source}`,
          indicators: {
            pattern: pattern.source,
            input: userInput.substring(0, 500), // Limit size
            endpoint: req.path,
            method: req.method
          },
          fraudScore: 75
        });
        
        console.warn(`🚨 Suspicious activity detected from ${req.ip}: ${pattern.source}`);
        break;
      }
    }

    // ✅ Track failed authentication attempts
    if (req.path.includes('/auth/login') && req.method === 'POST') {
      // This will be logged by the login handler, but we track the attempt
      const originalJson = res.json;
      res.json = function(data) {
        if (data && !data.success) {
          setImmediate(async () => {
            try {
              await auditService.logLoginFailed({
                identifier: req.body?.identifier || req.body?.email,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                reason: data.error?.message || 'Login failed',
                attemptCount: 1 // Would be tracked in session/cache
              });
            } catch (error) {
              console.error('❌ Failed login audit error:', error);
            }
          });
        }
        return originalJson.call(this, data);
      };
    }

  } catch (error) {
    console.error('❌ Security audit middleware error:', error);
  }

  next();
};

/**
 * 💰 PAYMENT AUDIT MIDDLEWARE
 * 
 * Special tracking for payment-related endpoints
 */
const paymentAuditMiddleware = async (req, res, next) => {
  const auditService = new AuditLogService();
  
  // ✅ Only apply to payment-related endpoints
  const paymentPaths = ['/bookings', '/events', '/payment'];
  const isPaymentRelated = paymentPaths.some(path => req.path.includes(path));
  
  if (!isPaymentRelated) {
    return next();
  }

  try {
    // ✅ Override response to capture payment events
    const originalJson = res.json;
    res.json = function(data) {
      // ✅ Log payment events in background
      setImmediate(async () => {
        try {
          if (data && data.success && data.data) {
            // ✅ Payment creation
            if (req.path.includes('/payment') && req.method === 'POST') {
              await auditService.logPaymentCreated({
                userId: req.user?.id,
                paymentId: data.data.paymentId || data.data.payment?.paymentId,
                amount: data.data.payment?.amount || data.data.amount,
                currency: 'IDR',
                paymentMethod: req.body?.paymentMethod,
                eventId: req.params?.id || req.body?.eventId,
                type: req.path.includes('guest-list') ? 'GUESTLIST' : 'BOOKING',
                correlationId: data.data.correlationId || req.requestId
              });
            }
            
            // ✅ Booking creation
            else if (req.path.includes('/bookings') && req.method === 'POST') {
              await auditService.logEvent('BOOKING_CREATED', {
                userId: req.user?.id,
                resourceType: 'booking',
                resourceId: data.data.booking?.id || data.data.booking?.bookingCode,
                correlationId: req.requestId,
                metadata: {
                  eventId: data.data.booking?.eventId,
                  quantity: data.data.booking?.quantity,
                  totalAmount: data.data.booking?.totalAmount
                }
              });
            }
          }
        } catch (error) {
          console.error('❌ Payment audit logging error:', error);
        }
      });
      
      return originalJson.call(this, data);
    };

  } catch (error) {
    console.error('❌ Payment audit middleware error:', error);
  }

  next();
};

/**
 * 📊 PERFORMANCE AUDIT MIDDLEWARE
 * 
 * Tracks slow requests and performance issues
 */
const performanceAuditMiddleware = async (req, res, next) => {
  const startTime = Date.now();
  
  // ✅ Override res.end to capture total request time
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    
    // ✅ Log slow requests (>5 seconds)
    if (responseTime > 5000) {
      setImmediate(async () => {
        try {
          const auditService = new AuditLogService();
          await auditService.logEvent('API_PERFORMANCE_ISSUE', {
            userId: req.user?.id,
            requestId: req.requestId,
            endpoint: req.path,
            method: req.method,
            responseTime: responseTime,
            metadata: {
              threshold: 5000,
              severity: responseTime > 10000 ? 'HIGH' : 'MEDIUM',
              userAgent: req.get('User-Agent')
            }
          });
        } catch (error) {
          console.error('❌ Performance audit error:', error);
        }
      });
    }
    
    return originalEnd.apply(this, args);
  };

  next();
};

/**
 * 🎯 COMBINED AUDIT MIDDLEWARE STACK
 */
const auditMiddlewareStack = [
  auditMiddleware,           // General API logging
  securityAuditMiddleware,   // Security event tracking
  paymentAuditMiddleware,    // Payment-specific tracking
  performanceAuditMiddleware // Performance monitoring
];

/**
 * 🛠️ UTILITY FUNCTIONS
 */
const applyAuditMiddleware = (app) => {
  auditMiddlewareStack.forEach(middleware => {
    app.use(middleware);
  });
  
  console.log('📋 Audit logging middleware applied to all routes');
};

module.exports = {
  auditMiddleware,
  securityAuditMiddleware,
  paymentAuditMiddleware,
  performanceAuditMiddleware,
  auditMiddlewareStack,
  applyAuditMiddleware
};