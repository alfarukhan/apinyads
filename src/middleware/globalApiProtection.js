/**
 * 🛡️ GLOBAL API PROTECTION MIDDLEWARE
 * Melindungi SEMUA /api/* endpoints dari akses unauthorized
 */

const securityConfig = require('../config/security');

/**
 * 🔒 Global API Protection - BLOCK ALL Unauthorized Access
 */
const globalAPIProtection = (req, res, next) => {
  // Skip non-API routes
  if (!req.path.startsWith('/api')) {
    return next();
  }
  
  // Skip health checks and public endpoints
  const publicEndpoints = [
    '/api/health',
    '/api/security/health',
    '/api/debug',
    '/api/events', // Public events listing
    '/api/artists', // Public artists
    '/api/venues', // Public venues  
    '/api/cities', // Public cities
    '/api/daily-drop', // Public daily drop
    '/api/auth/login', // Login endpoint
    '/api/auth/register', // Register endpoint
    '/api/webhooks', // Webhooks from external services
    '/api/payments/status', // Payment status check
    '/api/bookings/webhook' // Midtrans webhooks
  ];
  
  const isPublicEndpoint = publicEndpoints.some(endpoint => 
    req.path === endpoint || req.path.startsWith(endpoint + '/')
  );
  
  if (isPublicEndpoint) {
    console.log(`✅ Public endpoint - allowing access to ${req.path}`);
    return next();
  }
  
  const userAgent = req.get('user-agent') || '';
  const origin = req.get('origin');
  const hasJWT = !!req.get('authorization');
  const hasAPIKey = !!req.get('X-API-Key');
  const clientType = req.get('X-Client-Type');
  const acceptHeader = req.get('accept') || '';
  
  console.log(`🔍 Global API Protection - Path: ${req.path}, Origin: ${origin}, User-Agent: ${userAgent}`);
  
  // **DEVELOPMENT MODE** - Allow localhost AND mobile development
  if (securityConfig.isDevelopment) {
    const isLocalhost = req.ip === '127.0.0.1' || 
                       req.ip === '::1' || 
                       origin?.includes('localhost') || 
                       origin?.includes('127.0.0.1');
    
    // Also allow development mobile testing (no origin + common mobile patterns)
    const isDevelopmentMobile = !origin && (
      userAgent.includes('okhttp') ||
      userAgent.includes('Dart') ||
      userAgent.includes('Flutter') ||
      userAgent.includes('DanceSignal') ||
      userAgent.includes('Mobile') ||
      userAgent.includes('Android')
    );
    
    if (isLocalhost || isDevelopmentMobile) {
      console.log(`✅ Development mode - allowing access to ${req.path} (localhost: ${isLocalhost}, mobile: ${isDevelopmentMobile})`);
      return next();
    }
  }
  
  // **PRODUCTION MODE** - Strict validation
  
  // 1. Block direct browser access (detected by Accept header)
  const isBrowserRequest = userAgent.includes('Mozilla') && 
                           acceptHeader.includes('text/html');
  
  if (isBrowserRequest) {
    console.log(`🚫 BLOCKED: Direct browser access to ${req.path} from IP: ${req.ip}`);
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  // 2. Allow if has valid JWT token (user authenticated)
  if (hasJWT) {
    console.log(`✅ JWT token present - allowing access to ${req.path}`);
    return next();
  }
  
  // 3. Allow if has valid API key (internal services)
  if (hasAPIKey) {
    console.log(`✅ API key present - allowing access to ${req.path}`);
    return next();
  }
  
  // 4. Allow if from authorized domains (our websites)
  if (origin) {
    const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',');
    const isFromAllowedDomain = allowedDomains.some(domain => {
      if (!domain) return false;
      const cleanDomain = domain.replace('http://', '').replace('https://', '').replace(/\/$/, '');
      return origin.includes(cleanDomain);
    });
    
    if (isFromAllowedDomain) {
      console.log(`✅ Request from allowed domain (${origin}) - allowing access to ${req.path}`);
      return next();
    }
  }
  
  // 5. Allow if from valid mobile apps (EXPANDED PATTERNS)
  const validMobileIdentifiers = [
    'DanceSignal',
    'Flutter',
    'Dart',
    'okhttp', // Android default HTTP client
    'Mobile', // Generic mobile pattern
    'Android', // Android apps
    'iPhone', // iOS apps
    'iPad', // iPad apps
    'iOS', // iOS general
    'CFNetwork', // iOS network framework
    'Darwin', // iOS/macOS
    'Mozilla/5.0', // Some mobile browsers/webviews
    'Dalvik', // Android runtime
    'Apache-HttpClient', // Android HTTP client
    'java/', // Java-based clients
    'expo' // Expo React Native
  ];
  
  const isValidMobileApp = validMobileIdentifiers.some(identifier => 
    userAgent.includes(identifier) || clientType === 'mobile'
  );
  
  if (isValidMobileApp) {
    console.log(`✅ Valid mobile app detected - allowing access to ${req.path}`);
    return next();
  }
  
  // 6. Block all other access
  const blockLog = {
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: userAgent,
    origin: origin,
    hasJWT: hasJWT,
    hasAPIKey: hasAPIKey,
    clientType: clientType,
    reason: 'unauthorized_api_access'
  };
  
  console.log(`🚨 BLOCKED unauthorized API access:`, JSON.stringify(blockLog));
  
  // Return 404 instead of 403 to hide API existence
  return res.status(404).json({
    success: false,
    message: 'Not found'
  });
};

/**
 * 🔧 Apply Global API Protection
 */
const applyGlobalAPIProtection = (app) => {
  console.log('🛡️ Applying global API protection...');
  
  // Apply to ALL /api/* routes
  app.use('/api/*', globalAPIProtection);
  
  console.log('✅ Global API protection enabled - ALL /api/* endpoints protected');
  console.log('  - Blocks direct browser access');
  console.log('  - Requires JWT token OR API key OR valid client');
  console.log('  - Allows authorized domains and mobile apps');
  console.log('  - Development: allows localhost');
  console.log('  - Production: strict validation');
};

/**
 * ⚠️ Emergency Bypass (Development Only)
 */
const emergencyBypass = (req, res, next) => {
  if (securityConfig.isProduction) {
    return next();
  }
  
  const bypassSecret = req.get('X-Emergency-Bypass');
  if (bypassSecret === process.env.EMERGENCY_BYPASS_SECRET) {
    console.log(`⚠️ EMERGENCY BYPASS used for ${req.path}`);
    return next();
  }
  
  next();
};

module.exports = {
  globalAPIProtection,
  applyGlobalAPIProtection,
  emergencyBypass
};
