const RateLimitService = require('../services/core/RateLimitService');
const ResponseFormatter = require('../services/core/ResponseFormatter');

/**
 * 🚦 RATE LIMITING MIDDLEWARE INTEGRATION
 * 
 * Seamless integration of RateLimitService with Express middleware:
 * - Automatic rate limit checking for all requests
 * - Smart endpoint-specific limit application
 * - User-aware rate limiting with role multipliers
 * - Graceful error responses with retry information
 * - Real-time monitoring & statistics
 * 
 * ✅ Security: Prevents API abuse & DDoS attacks
 * ✅ Performance: Non-blocking rate limit checks
 * ✅ User Experience: Informative rate limit headers
 * ✅ Monitoring: Complete rate limiting analytics
 */

/**
 * 🎯 MAIN RATE LIMITING MIDDLEWARE
 * 
 * Applies intelligent rate limiting to all API requests
 */
const rateLimitMiddleware = async (req, res, next) => {
  const rateLimitService = new RateLimitService();
  const responseFormatter = new ResponseFormatter();

  try {
    // ✅ Check rate limits
    const limitResult = await rateLimitService.checkRateLimit(req);

    // ✅ Add rate limit headers to response
    if (limitResult.limit) {
      res.set({
        'X-RateLimit-Limit': limitResult.limit,
        'X-RateLimit-Remaining': limitResult.remaining || 0,
        'X-RateLimit-Reset': limitResult.resetTime ? new Date(limitResult.resetTime).toISOString() : '',
        'X-RateLimit-Policy': 'sliding-window'
      });
    }

    // ✅ Request blocked by rate limiting
    if (!limitResult.allowed) {
      console.warn(`🚦 Rate limit exceeded: ${req.ip} - ${req.method} ${req.path}`);
      
      // ✅ Add retry-after header
      if (limitResult.retryAfter) {
        res.set('Retry-After', limitResult.retryAfter);
      }

      return responseFormatter.error(res, {
        message: limitResult.message || 'Rate limit exceeded. Too many requests.',
        statusCode: 429,
        errorCode: limitResult.reason || 'RATE_LIMIT_EXCEEDED',
        details: {
          limit: limitResult.limit,
          retryAfter: limitResult.retryAfter,
          endpoint: limitResult.endpoint,
          policy: 'Please slow down your requests'
        },
        requestId: req.requestId,
        startTime: req.startTime
      });
    }

    // ✅ Store rate limit info in request for downstream use
    req.rateLimit = {
      limit: limitResult.limit,
      remaining: limitResult.remaining,
      resetTime: limitResult.resetTime,
      processingTime: limitResult.processingTime
    };

    next();

  } catch (error) {
    console.error('❌ Rate limiting middleware error:', error);
    
    // ✅ Fail open - allow request if rate limiting fails
    next();
  }
};

/**
 * 🎯 ENDPOINT-SPECIFIC RATE LIMITING
 * 
 * Creates custom rate limiting for specific routes
 */
const createEndpointRateLimit = (options = {}) => {
  const {
    windowMs = 60000, // 1 minute
    max = 100,
    message = 'Too many requests for this endpoint',
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req, res, next) => {
    const rateLimitService = new RateLimitService();
    const responseFormatter = new ResponseFormatter();

    try {
      // ✅ Create custom rate limit check
      const endpoint = `${req.method}:${req.route?.path || req.path}`;
      const key = `custom:${endpoint}:${req.user?.id || req.ip}`;
      
      // ✅ Use RateLimitService's sliding window algorithm
      const limitResult = await rateLimitService.checkSlidingWindow(key, max, windowMs);

      if (!limitResult.allowed) {
        const retryAfter = Math.ceil((limitResult.resetTime - Date.now()) / 1000);
        
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(limitResult.resetTime).toISOString(),
          'Retry-After': retryAfter
        });

        return responseFormatter.error(res, {
          message: message,
          statusCode: 429,
          errorCode: 'ENDPOINT_RATE_LIMIT_EXCEEDED',
          details: {
            endpoint: endpoint,
            limit: max,
            windowMs: windowMs,
            retryAfter: retryAfter
          },
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      // ✅ Set headers for successful requests
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': limitResult.remaining,
        'X-RateLimit-Reset': new Date(limitResult.resetTime).toISOString()
      });

      next();

    } catch (error) {
      console.error('❌ Endpoint rate limiting error:', error);
      next(); // Fail open
    }
  };
};

/**
 * 🔥 BURST PROTECTION MIDDLEWARE
 * 
 * Protects against sudden traffic spikes
 */
const burstProtectionMiddleware = (burstLimit = 50, burstWindowMs = 10000) => {
  return async (req, res, next) => {
    const rateLimitService = new RateLimitService();
    const responseFormatter = new ResponseFormatter();

    try {
      const key = `burst:${req.ip}`;
      const limitResult = await rateLimitService.checkSlidingWindow(key, burstLimit, burstWindowMs);

      if (!limitResult.allowed) {
        console.warn(`🔥 Burst limit exceeded: ${req.ip}`);
        
        return responseFormatter.error(res, {
          message: 'Request burst limit exceeded. Please slow down.',
          statusCode: 429,
          errorCode: 'BURST_LIMIT_EXCEEDED',
          details: {
            burstLimit: burstLimit,
            burstWindow: burstWindowMs,
            retryAfter: Math.ceil((limitResult.resetTime - Date.now()) / 1000)
          },
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      next();

    } catch (error) {
      console.error('❌ Burst protection error:', error);
      next(); // Fail open
    }
  };
};

/**
 * 👤 USER-SPECIFIC RATE LIMITING
 * 
 * Enhanced rate limiting based on user authentication status
 */
const userAwareRateLimit = (options = {}) => {
  const {
    authenticatedLimit = 200,
    anonymousLimit = 50,
    windowMs = 60000
  } = options;

  return async (req, res, next) => {
    const rateLimitService = new RateLimitService();
    const responseFormatter = new ResponseFormatter();

    try {
      const isAuthenticated = !!req.user;
      const limit = isAuthenticated ? authenticatedLimit : anonymousLimit;
      const identifier = isAuthenticated ? req.user.id : req.ip;
      const key = `user_aware:${identifier}`;

      const limitResult = await rateLimitService.checkSlidingWindow(key, limit, windowMs);

      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': limitResult.remaining || 0,
        'X-RateLimit-Reset': limitResult.resetTime ? new Date(limitResult.resetTime).toISOString() : '',
        'X-RateLimit-Type': isAuthenticated ? 'authenticated' : 'anonymous'
      });

      if (!limitResult.allowed) {
        return responseFormatter.error(res, {
          message: isAuthenticated 
            ? 'User rate limit exceeded' 
            : 'Anonymous rate limit exceeded. Consider signing in for higher limits.',
          statusCode: 429,
          errorCode: 'USER_RATE_LIMIT_EXCEEDED',
          details: {
            userType: isAuthenticated ? 'authenticated' : 'anonymous',
            limit: limit,
            suggestion: isAuthenticated ? 'Please slow down' : 'Sign in for higher rate limits'
          },
          requestId: req.requestId,
          startTime: req.startTime
        });
      }

      next();

    } catch (error) {
      console.error('❌ User-aware rate limiting error:', error);
      next(); // Fail open
    }
  };
};

/**
 * 📊 RATE LIMIT MONITORING MIDDLEWARE
 * 
 * Adds detailed monitoring for rate limiting
 */
const rateLimitMonitoringMiddleware = (req, res, next) => {
  // ✅ Track rate limit metrics
  const originalJson = res.json;
  res.json = function(data) {
    // ✅ Add rate limit performance to response metadata
    if (data && data.meta && req.rateLimit) {
      data.meta.rateLimit = {
        limit: req.rateLimit.limit,
        remaining: req.rateLimit.remaining,
        processingTime: req.rateLimit.processingTime,
        policy: 'sliding-window'
      };
    }
    
    return originalJson.call(this, data);
  };

  next();
};

/**
 * 🛠️ UTILITY FUNCTIONS
 */

/**
 * Skip rate limiting for certain conditions
 */
const skipRateLimit = (skipCondition) => {
  return (req, res, next) => {
    if (typeof skipCondition === 'function' && skipCondition(req)) {
      return next();
    }
    
    // Apply rate limiting normally
    rateLimitMiddleware(req, res, next);
  };
};

/**
 * Apply rate limiting to specific HTTP methods only
 */
const rateLimitMethods = (methods = ['POST', 'PUT', 'PATCH', 'DELETE']) => {
  return (req, res, next) => {
    if (!methods.includes(req.method)) {
      return next();
    }
    
    rateLimitMiddleware(req, res, next);
  };
};

/**
 * 🎯 PRESET CONFIGURATIONS
 */
const presets = {
  // Strict rate limiting for authentication endpoints
  auth: createEndpointRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Too many authentication attempts. Please try again later.'
  }),

  // Moderate rate limiting for payment endpoints
  payment: createEndpointRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many payment requests. Please slow down.'
  }),

  // Lenient rate limiting for read-only endpoints
  readonly: createEndpointRateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200,
    message: 'Too many requests. Please slow down.'
  }),

  // Very strict rate limiting for resource-intensive operations
  heavy: createEndpointRateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 3,
    message: 'Resource-intensive operation rate limit exceeded.'
  })
};

module.exports = {
  // ✅ Main middleware
  rateLimitMiddleware,
  
  // ✅ Specialized middleware
  createEndpointRateLimit,
  burstProtectionMiddleware,
  userAwareRateLimit,
  rateLimitMonitoringMiddleware,
  
  // ✅ Utility functions
  skipRateLimit,
  rateLimitMethods,
  
  // ✅ Preset configurations
  presets,
  
  // ✅ Legacy compatibility
  rateLimit: rateLimitMiddleware
};