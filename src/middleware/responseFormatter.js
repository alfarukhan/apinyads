const ResponseFormatter = require('../services/core/ResponseFormatter');

/**
 * 📝 RESPONSE FORMATTER MIDDLEWARE
 * 
 * Automatically attaches centralized response formatting methods to all routes:
 * - Consistent response structure
 * - Request tracking & timing
 * - Standardized error handling
 * - Pagination support
 * - Performance metrics
 * 
 * ✅ Consistency: Same response format everywhere
 * ✅ Performance: Automatic timing tracking
 * ✅ Debugging: Request correlation IDs
 */

/**
 * 🎯 MAIN RESPONSE FORMATTER MIDDLEWARE
 * 
 * Attaches formatter methods to res object
 */
const responseFormatterMiddleware = (req, res, next) => {
  const formatter = new ResponseFormatter();
  
  // ✅ Attach formatting methods to response object
  formatter.attachToResponse(req, res, next);
};

/**
 * 📊 PAGINATION PARAMETER MIDDLEWARE
 * 
 * Standardizes pagination parameters across all endpoints
 */
const paginationMiddleware = (req, res, next) => {
  const formatter = new ResponseFormatter();
  
  // ✅ Parse and validate pagination parameters
  const { page, limit } = formatter.validatePaginationParams(req.query);
  
  // ✅ Attach to request for easy access
  req.pagination = {
    page,
    limit,
    offset: (page - 1) * limit
  };
  
  next();
};

/**
 * ⏱️ PERFORMANCE TIMING MIDDLEWARE
 * 
 * Tracks request processing time
 */
const timingMiddleware = (req, res, next) => {
  // ✅ Start timing
  req.startTime = Date.now();
  
  // ✅ Override res.json to add timing to all responses
  const originalJson = res.json;
  res.json = function(data) {
    // ✅ Add response time if not already present
    if (data && typeof data === 'object' && data.meta && !data.meta.responseTime) {
      data.meta.responseTime = `${Date.now() - req.startTime}ms`;
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * 🔍 REQUEST CORRELATION MIDDLEWARE
 * 
 * Adds unique request IDs for tracking
 */
const correlationMiddleware = (req, res, next) => {
  const formatter = new ResponseFormatter();
  
  // ✅ Generate unique request ID
  req.requestId = formatter.generateRequestId();
  
  // ✅ Add to response headers for debugging
  res.set('X-Request-ID', req.requestId);
  
  next();
};

/**
 * 🛡️ SECURITY HEADERS MIDDLEWARE
 * 
 * Adds security headers to all responses
 */
const securityHeadersMiddleware = (req, res, next) => {
  // ✅ Add security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-API-Version': process.env.API_VERSION || '2.0'
  });
  
  next();
};

/**
 * 📈 RESPONSE COMPRESSION MIDDLEWARE
 * 
 * Optimizes response size for large datasets
 */
const compressionMiddleware = (req, res, next) => {
  // ✅ Override res.json to compress large responses
  const originalJson = res.json;
  res.json = function(data) {
    // ✅ Add compression hint for large responses
    if (data && typeof data === 'object') {
      const responseSize = JSON.stringify(data).length;
      
      if (responseSize > 10000) { // 10KB threshold
        res.set('Content-Encoding-Hint', 'large-response');
      }
      
      // ✅ Add size metadata
      if (data.meta) {
        data.meta.responseSize = `${Math.round(responseSize / 1024)}KB`;
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * 🎨 CONTENT TYPE MIDDLEWARE
 * 
 * Ensures proper content types
 */
const contentTypeMiddleware = (req, res, next) => {
  // ✅ Set default content type for API responses
  res.type('application/json');
  
  next();
};

/**
 * 📊 ANALYTICS MIDDLEWARE
 * 
 * Tracks API usage for analytics
 */
const analyticsMiddleware = (req, res, next) => {
  // ✅ Log API usage for analytics (in background)
  setImmediate(() => {
    try {
      const logData = {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        userId: req.user?.id,
        timestamp: new Date().toISOString(),
        requestId: req.requestId
      };
      
      // TODO: Send to analytics service
      console.log('📊 API Analytics:', JSON.stringify(logData));
    } catch (error) {
      console.error('❌ Analytics logging error:', error);
    }
  });
  
  next();
};

/**
 * 🔄 RATE LIMIT HEADERS MIDDLEWARE
 * 
 * Adds rate limiting information to responses
 */
const rateLimitHeadersMiddleware = (req, res, next) => {
  // ✅ Add rate limit headers (will be populated by rate limiting middleware)
  if (req.rateLimit) {
    res.set({
      'X-RateLimit-Limit': req.rateLimit.limit,
      'X-RateLimit-Remaining': req.rateLimit.remaining,
      'X-RateLimit-Reset': new Date(req.rateLimit.resetTime).toISOString()
    });
  }
  
  next();
};

/**
 * 🎯 COMBINED MIDDLEWARE STACK
 * 
 * All response formatting middleware in correct order
 */
const responseMiddlewareStack = [
  correlationMiddleware,      // Must be first (sets req.requestId)
  timingMiddleware,           // Must be early (sets req.startTime)
  securityHeadersMiddleware,  // Security headers
  contentTypeMiddleware,      // Content type
  responseFormatterMiddleware, // Attach formatter methods
  paginationMiddleware,       // Parse pagination
  compressionMiddleware,      // Response optimization
  analyticsMiddleware,        // Usage tracking
  rateLimitHeadersMiddleware  // Rate limit info
];

/**
 * 🛠️ UTILITY FUNCTIONS
 */

/**
 * Apply all response middleware to an Express app
 */
const applyResponseMiddleware = (app) => {
  responseMiddlewareStack.forEach(middleware => {
    app.use(middleware);
  });
  
  console.log('📝 Response formatting middleware applied to all routes');
};

/**
 * Create custom middleware stack
 */
const createCustomStack = (middlewareNames) => {
  const middlewareMap = {
    correlation: correlationMiddleware,
    timing: timingMiddleware,
    security: securityHeadersMiddleware,
    contentType: contentTypeMiddleware,
    formatter: responseFormatterMiddleware,
    pagination: paginationMiddleware,
    compression: compressionMiddleware,
    analytics: analyticsMiddleware,
    rateLimit: rateLimitHeadersMiddleware
  };
  
  return middlewareNames.map(name => middlewareMap[name]).filter(Boolean);
};

module.exports = {
  // ✅ Individual middleware
  responseFormatterMiddleware,
  paginationMiddleware,
  timingMiddleware,
  correlationMiddleware,
  securityHeadersMiddleware,
  compressionMiddleware,
  contentTypeMiddleware,
  analyticsMiddleware,
  rateLimitHeadersMiddleware,
  
  // ✅ Middleware stacks
  responseMiddlewareStack,
  applyResponseMiddleware,
  createCustomStack,
  
  // ✅ Legacy aliases
  formatter: responseFormatterMiddleware,
  pagination: paginationMiddleware,
  timing: timingMiddleware
};