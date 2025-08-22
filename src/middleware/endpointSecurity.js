/**
 * 🔒 ENDPOINT SECURITY MIDDLEWARE
 * Professional endpoint protection dan hiding
 */

const securityConfig = require('../config/security');

/**
 * 🚫 Hide API Root from Direct Access
 */
const hideAPIRoot = (req, res, next) => {
  // If someone accesses /api directly, show minimal info
  if (req.path === '/api' && req.method === 'GET') {
    const userAgent = req.get('user-agent') || '';
    const isBrowser = userAgent.includes('Mozilla');
    
    if (isBrowser && securityConfig.isProduction) {
      // Return 404 for browsers in production
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }
    
    // For valid clients, return minimal API info
    return res.json({
      success: true,
      message: 'DanceSignal API',
      version: '1.0.0',
      status: 'operational'
    });
  }
  
  next();
};

/**
 * 🔐 Production Endpoint Restrictions
 */
const productionEndpointRestrictions = (req, res, next) => {
  if (!securityConfig.isProduction) {
    return next();
  }
  
  // Endpoints yang harus disembunyikan di production
  const hiddenEndpoints = [
    '/api/test',
    '/api/debug',
    '/api/config',
    '/api/security',
    '/api/monitoring/dashboard',
    '/api/admin/test'
  ];
  
  const isHiddenEndpoint = hiddenEndpoints.some(endpoint => 
    req.path.startsWith(endpoint)
  );
  
  if (isHiddenEndpoint) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 📍 Validate Request Origin
 */
const validateRequestOrigin = (req, res, next) => {
  const origin = req.get('origin');
  const referer = req.get('referer');
  const userAgent = req.get('user-agent') || '';
  
  // Development mode - allow all
  if (securityConfig.isDevelopment) {
    return next();
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /curl/i,
    /wget/i,
    /python/i,
    /postman/i,
    /insomnia/i
  ];
  
  const isSuspiciousAgent = suspiciousPatterns.some(pattern => 
    pattern.test(userAgent)
  );
  
  // Block suspicious user agents di production
  if (isSuspiciousAgent && securityConfig.isProduction) {
    console.log(`🚨 Blocked suspicious user agent: ${userAgent} from IP: ${req.ip}`);
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🔍 Request Pattern Analysis
 */
const analyzeRequestPattern = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('user-agent') || '';
  const path = req.path;
  
  // Simple pattern detection
  const suspiciousPatterns = {
    sqlInjection: /('|(--)|;|\/\*|\*\/|xp_|sp_)/i,
    xss: /(<script|javascript:|vbscript:|onload=|onerror=)/i,
    pathTraversal: /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c)/i,
    enumeration: /\/(admin|config|test|debug|api\/v\d+\/)/i
  };
  
  let threatDetected = false;
  let threatType = '';
  
  // Check URL path
  Object.entries(suspiciousPatterns).forEach(([type, pattern]) => {
    if (pattern.test(path) || pattern.test(decodeURIComponent(path))) {
      threatDetected = true;
      threatType = type;
    }
  });
  
  // Check query parameters
  Object.values(req.query || {}).forEach(value => {
    Object.entries(suspiciousPatterns).forEach(([type, pattern]) => {
      if (typeof value === 'string' && pattern.test(value)) {
        threatDetected = true;
        threatType = type;
      }
    });
  });
  
  if (threatDetected) {
    console.log(`🚨 Security threat detected: ${threatType} from IP: ${ip}, Path: ${path}, User-Agent: ${userAgent}`);
    
    // In production, block the request
    if (securityConfig.isProduction) {
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }
  }
  
  next();
};

/**
 * 🛡️ Content Type Validation
 */
const validateContentType = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  const contentType = req.get('content-type') || '';
  const validContentTypes = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data'
  ];
  
  const isValidContentType = validContentTypes.some(type => 
    contentType.includes(type)
  );
  
  if (!isValidContentType && req.body && Object.keys(req.body).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid content type'
    });
  }
  
  next();
};

/**
 * 📊 Response Security Headers
 */
const addSecurityResponseHeaders = (req, res, next) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // API specific headers
  res.setHeader('X-API-Version', '1.0.0');
  
  // Don't cache sensitive responses
  if (req.path.includes('/admin/') || req.path.includes('/payment')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

/**
 * 🔒 Request Size Limiting
 */
const limitRequestSize = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.get('content-length') || '0');
    const maxSizeBytes = typeof maxSize === 'string' ? 
      parseInt(maxSize.replace(/\D/g, '')) * 1024 * 1024 : maxSize;
    
    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        success: false,
        message: 'Request too large'
      });
    }
    
    next();
  };
};

/**
 * 🕒 Request Timeout Protection
 */
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          message: 'Request timeout'
        });
      }
    }, timeoutMs);
    
    res.on('finish', () => {
      clearTimeout(timeout);
    });
    
    req.on('close', () => {
      clearTimeout(timeout);
    });
    
    next();
  };
};

/**
 * 🚨 Security Incident Response
 */
const securityIncidentResponse = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log security-related errors
    if (res.statusCode === 401 || res.statusCode === 403) {
      const incidentLog = {
        timestamp: new Date().toISOString(),
        type: 'unauthorized_access',
        ip: req.ip || req.connection.remoteAddress,
        path: req.path,
        method: req.method,
        userAgent: req.get('user-agent'),
        statusCode: res.statusCode
      };
      
      console.log('🚨 Security incident:', JSON.stringify(incidentLog));
      
      // In production, could send to security monitoring system
      if (securityConfig.isProduction) {
        // TODO: Send to security monitoring/alerting system
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * 🎯 Apply All Endpoint Security
 */
const applyEndpointSecurity = (app) => {
  console.log('🔒 Applying endpoint security middleware...');
  
  // 1. Request timeout protection
  app.use(requestTimeout(30000));
  
  // 2. Request size limiting
  app.use(limitRequestSize('10mb'));
  
  // 3. Security response headers
  app.use(addSecurityResponseHeaders);
  
  // 4. Hide API root
  app.use(hideAPIRoot);
  
  // 5. Production endpoint restrictions
  app.use(productionEndpointRestrictions);
  
  // 6. Request origin validation
  app.use('/api', validateRequestOrigin);
  
  // 7. Request pattern analysis
  app.use('/api', analyzeRequestPattern);
  
  // 8. Content type validation
  app.use('/api', validateContentType);
  
  // 9. Security incident response
  app.use(securityIncidentResponse);
  
  console.log('✅ Endpoint security middleware applied');
};

module.exports = {
  hideAPIRoot,
  productionEndpointRestrictions,
  validateRequestOrigin,
  analyzeRequestPattern,
  validateContentType,
  addSecurityResponseHeaders,
  limitRequestSize,
  requestTimeout,
  securityIncidentResponse,
  applyEndpointSecurity
};
