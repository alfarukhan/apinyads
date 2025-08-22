/**
 * 🛡️ ENHANCED SECURITY HEADERS MIDDLEWARE
 * Customizable security headers untuk different environments
 */

const securityConfig = require('../config/security');

/**
 * 🔒 Enhanced Security Headers Middleware
 */
const enhancedSecurityHeaders = (options = {}) => {
  return (req, res, next) => {
    try {
      const config = securityConfig.getHelmetConfig();
      const {
        enableCSP = securityConfig.isProduction,
        enableHSTS = securityConfig.isProduction,
        enableFrameguard = true,
        enableXSSFilter = true,
        enableNoSniff = true,
        customCSP = null,
        additionalHeaders = {}
      } = options;

      // Content Security Policy
      if (enableCSP) {
        const cspDirectives = customCSP || config.contentSecurityPolicy?.directives || {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        };

        try {
          const cspString = Object.entries(cspDirectives)
            .map(([directive, sources]) => {
              const kebabCase = directive.replace(/([A-Z])/g, '-$1').toLowerCase();
              return `${kebabCase} ${Array.isArray(sources) ? sources.join(' ') : sources}`;
            })
            .join('; ');

          // Only set CSP if string is valid
          if (cspString && cspString.length > 0) {
            res.setHeader('Content-Security-Policy', cspString);
          }
        } catch (cspError) {
          console.warn('⚠️ CSP header creation failed:', cspError.message);
        }
        console.log('🛡️ CSP Header set');
      }

      // HTTP Strict Transport Security (HSTS)
      if (enableHSTS && securityConfig.isProduction) {
        const hstsValue = `max-age=${config.hsts?.maxAge || 31536000}; includeSubDomains; preload`;
        res.setHeader('Strict-Transport-Security', hstsValue);
        console.log('🔒 HSTS Header set');
      }

      // X-Frame-Options
      if (enableFrameguard) {
        res.setHeader('X-Frame-Options', 'DENY');
        console.log('🖼️ X-Frame-Options Header set');
      }

      // X-XSS-Protection
      if (enableXSSFilter) {
        res.setHeader('X-XSS-Protection', '1; mode=block');
        console.log('🛡️ X-XSS-Protection Header set');
      }

      // X-Content-Type-Options
      if (enableNoSniff) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        console.log('🔍 X-Content-Type-Options Header set');
      }

      // Referrer Policy
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Permissions Policy (formerly Feature Policy) - only for production
      if (securityConfig.isProduction) {
        try {
          const permissionsPolicy = [
            'geolocation=(self)',
            'camera=(self)',
            'microphone=(self)',
            'payment=(self)',
            'accelerometer=(self)',
            'gyroscope=(self)',
            'usb=()',
            'bluetooth=()'
          ].join(', ');
          res.setHeader('Permissions-Policy', permissionsPolicy);
        } catch (permError) {
          console.warn('⚠️ Permissions Policy header creation failed:', permError.message);
        }
      }

      // Cross-Origin Policies
      res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none'); // More permissive for API
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      // API-specific headers
      res.setHeader('X-API-Version', '1.0.0');
      res.setHeader('X-Environment', securityConfig.environment);
      
      // Security headers
      res.setHeader('X-Powered-By', 'DanceSignal API'); // Custom instead of removing
      res.setHeader('X-Security-Headers', 'enabled');
      
      // Rate limiting info headers (if available)
      if (req.rateLimit) {
        res.setHeader('X-RateLimit-Limit', req.rateLimit.limit);
        res.setHeader('X-RateLimit-Remaining', req.rateLimit.remaining);
        res.setHeader('X-RateLimit-Reset', req.rateLimit.reset);
      }

      // Correlation ID header (if available)
      if (req.correlationId) {
        res.setHeader('X-Correlation-ID', req.correlationId);
      }

      // Additional custom headers
      Object.entries(additionalHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      // Development-specific headers
      if (securityConfig.isDevelopment) {
        res.setHeader('X-Development-Mode', 'true');
        res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-ID, X-RateLimit-Remaining');
      }

      console.log('✅ Enhanced security headers applied');
      next();

    } catch (error) {
      console.error('❌ Error applying security headers:', error);
      // Don't fail the request, just log the error
      next();
    }
  };
};

/**
 * 🎯 API-Specific Security Headers
 */
const apiSecurityHeaders = (req, res, next) => {
  // JSON API specific headers
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  // Prevent caching of API responses by default
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // API-specific security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  console.log('🔧 API security headers applied');
  next();
};

/**
 * 📱 Mobile App Specific Headers
 */
const mobileAppHeaders = (req, res, next) => {
  // Check if request is from mobile app
  const userAgent = req.get('user-agent') || '';
  const isMobileApp = userAgent.includes('DanceSignal') || 
                     userAgent.includes('Flutter') ||
                     userAgent.includes('Dart/') ||
                     req.get('X-Client-Type') === 'mobile';

  if (isMobileApp) {
    try {
      // Mobile-specific headers
      res.setHeader('X-Mobile-Optimized', 'true');
      res.setHeader('X-App-Cache-Control', 'max-age=300'); // 5 minutes cache for mobile
      
      // More permissive but valid CSP for mobile apps
      const mobileCsp = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https: wss:",
        "media-src 'self' data: https: blob:",
        "font-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline' https:",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:"
      ].join('; ');
      
      res.setHeader('Content-Security-Policy', mobileCsp);
      
      // Allow all origins for mobile app (CORS is handled separately)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control');
      
      console.log('📱 Mobile app headers applied');
    } catch (mobileError) {
      console.warn('⚠️ Mobile headers application failed:', mobileError.message);
    }
  }
  
  next();
};

/**
 * 🔗 Webhook-Specific Headers
 */
const webhookHeaders = (req, res, next) => {
  // Webhook-specific headers
  res.setHeader('X-Webhook-Receiver', 'DanceSignal API');
  res.setHeader('X-Webhook-Version', '1.0');
  
  // More permissive headers for webhooks
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature, X-Webhook-Timestamp');
  
  console.log('🔗 Webhook headers applied');
  next();
};

/**
 * 🛡️ Admin Panel Specific Headers
 */
const adminHeaders = (req, res, next) => {
  // Extra strict headers for admin endpoints
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Allow embedding in same origin
  res.setHeader('X-Admin-Protected', 'true');
  
  // Strict CSP for admin
  const strictCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; object-src 'none'; media-src 'self'; frame-src 'none'";
  res.setHeader('Content-Security-Policy', strictCSP);
  
  // No caching for admin responses
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  console.log('👑 Admin headers applied');
  next();
};

/**
 * 📊 Security Headers Analytics
 */
const logSecurityHeaders = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log security headers that were set
    const securityHeaders = {};
    const headerNames = [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-XSS-Protection',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy'
    ];
    
    headerNames.forEach(headerName => {
      const value = res.getHeader(headerName);
      if (value) {
        securityHeaders[headerName] = value;
      }
    });
    
    if (securityConfig.isDevelopment && Object.keys(securityHeaders).length > 0) {
      console.log('📊 Security Headers Set:', JSON.stringify(securityHeaders, null, 2));
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * 🔧 Conditional Security Headers
 */
const conditionalSecurityHeaders = (conditions = {}) => {
  return (req, res, next) => {
    const {
      pathPatterns = [],
      userAgentPatterns = [],
      methodsRequired = [],
      customCondition = null
    } = conditions;
    
    let shouldApply = true;
    
    // Check path patterns
    if (pathPatterns.length > 0) {
      shouldApply = pathPatterns.some(pattern => {
        const regex = new RegExp(pattern);
        return regex.test(req.path);
      });
    }
    
    // Check user agent patterns
    if (userAgentPatterns.length > 0 && shouldApply) {
      const userAgent = req.get('user-agent') || '';
      shouldApply = userAgentPatterns.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(userAgent);
      });
    }
    
    // Check methods
    if (methodsRequired.length > 0 && shouldApply) {
      shouldApply = methodsRequired.includes(req.method);
    }
    
    // Check custom condition
    if (customCondition && shouldApply) {
      shouldApply = customCondition(req, res);
    }
    
    if (shouldApply) {
      enhancedSecurityHeaders()(req, res, next);
    } else {
      next();
    }
  };
};

module.exports = {
  enhancedSecurityHeaders,
  apiSecurityHeaders,
  mobileAppHeaders,
  webhookHeaders,
  adminHeaders,
  logSecurityHeaders,
  conditionalSecurityHeaders
};
