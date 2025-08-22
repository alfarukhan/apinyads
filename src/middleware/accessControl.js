/**
 * 🛡️ API ACCESS CONTROL MIDDLEWARE
 * Professional access control untuk API endpoints
 */

const securityConfig = require('../config/security');

/**
 * 🔒 Block Direct Browser Access to ALL API Endpoints
 */
const blockDirectBrowserAccess = (req, res, next) => {
  const userAgent = req.get('user-agent') || '';
  const acceptHeader = req.get('accept') || '';
  const origin = req.get('origin');
  
  // Check if it's a direct browser request (not from our apps)
  const isBrowser = userAgent.includes('Mozilla') && 
                   acceptHeader.includes('text/html');
  
  // Allow if request has proper authentication
  const hasAuth = req.get('authorization') || req.get('X-API-Key');
  
  // Allow if request from our domains
  const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',');
  const isFromAllowedDomain = allowedDomains.some(domain => 
    origin?.includes(domain.replace('http://', '').replace('https://', ''))
  );
  
  // Development mode - allow localhost
  if (securityConfig.isDevelopment && 
      (origin?.includes('localhost') || origin?.includes('127.0.0.1'))) {
    return next();
  }
  
  // Block direct browser access to ALL /api/* endpoints
  if (isBrowser && req.path.startsWith('/api') && !hasAuth && !isFromAllowedDomain) {
    console.log(`🚫 Blocked direct browser access to ${req.path} from IP: ${req.ip}`);
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🔐 Require Authentication OR Valid Client
 */
const requireAuthOrValidClient = (req, res, next) => {
  const userAgent = req.get('user-agent') || '';
  const clientType = req.get('X-Client-Type');
  const origin = req.get('origin');
  const hasJWT = !!req.get('authorization');
  const hasAPIKey = !!req.get('X-API-Key');
  
  // Development mode - allow localhost
  if (securityConfig.isDevelopment && 
      (req.ip === '127.0.0.1' || req.ip === '::1' || 
       origin?.includes('localhost') || origin?.includes('127.0.0.1'))) {
    return next();
  }
  
  // Allow if has valid JWT token
  if (hasJWT) {
    return next();
  }
  
  // Allow if has valid API key
  if (hasAPIKey) {
    return next();
  }
  
  // Allow if from allowed domains (our websites)
  const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',');
  const isFromAllowedDomain = allowedDomains.some(domain => {
    if (!domain || !origin) return false;
    const cleanDomain = domain.replace('http://', '').replace('https://', '').replace(/\/$/, '');
    return origin.includes(cleanDomain);
  });
  
  if (isFromAllowedDomain) {
    return next();
  }
  
  // Check for valid mobile app indicators
  const validMobileClients = [
    'DanceSignal',
    'Flutter',
    'Dart'
  ];
  
  const isValidMobileApp = validMobileClients.some(client => 
    userAgent.includes(client) || clientType === 'mobile'
  );
  
  if (isValidMobileApp) {
    return next();
  }
  
  // Block unauthorized access
  console.log(`🚫 Unauthorized API access blocked - IP: ${req.ip}, User-Agent: ${userAgent}, Origin: ${origin}`);
  return res.status(404).json({
    success: false,
    message: 'Not found'
  });
};

/**
 * 📱 Mobile App Only Access
 */
const mobileAppOnly = (req, res, next) => {
  const userAgent = req.get('user-agent') || '';
  const clientType = req.get('X-Client-Type');
  
  const isMobileApp = userAgent.includes('DanceSignal') || 
                     userAgent.includes('Flutter') ||
                     clientType === 'mobile';
  
  if (!isMobileApp && securityConfig.isProduction) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🌐 Web Client Only Access
 */
const webClientOnly = (req, res, next) => {
  const origin = req.get('origin');
  const referer = req.get('referer');
  const clientType = req.get('X-Client-Type');
  
  if (securityConfig.isDevelopment) {
    return next();
  }
  
  const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',');
  const isValidWebClient = allowedDomains.some(domain => 
    origin?.includes(domain) || referer?.includes(domain)
  ) || clientType === 'web';
  
  if (!isValidWebClient) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🔧 Internal Service Only Access
 */
const internalServiceOnly = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  const config = securityConfig.getAPIKeyConfig();
  
  // Development mode - allow localhost
  if (securityConfig.isDevelopment) {
    const ip = req.ip || req.connection.remoteAddress;
    if (ip === '127.0.0.1' || ip === '::1' || ip?.startsWith('192.168.')) {
      return next();
    }
  }
  
  if (!apiKey || apiKey !== config.internalServiceKey) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 👑 Admin Only Access
 */
const adminOnly = (req, res, next) => {
  // Must have valid admin authentication
  if (!req.user || req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🔗 Webhook Only Access
 */
const webhookOnly = (req, res, next) => {
  const signature = req.get('X-Webhook-Signature');
  const timestamp = req.get('X-Webhook-Timestamp');
  
  if (!signature || !timestamp) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  next();
};

/**
 * 🚫 Hide Sensitive Endpoints
 */
const hideSensitiveEndpoints = (sensitivePatterns = []) => {
  return (req, res, next) => {
    const isSensitive = sensitivePatterns.some(pattern => {
      const regex = new RegExp(pattern);
      return regex.test(req.path);
    });
    
    if (isSensitive && securityConfig.isProduction) {
      // Return 404 instead of 403 to hide existence
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }
    
    next();
  };
};

/**
 * 🔍 Request Logging for Security
 */
const logSecurityRequest = (req, res, next) => {
  const requestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    origin: req.get('origin'),
    referer: req.get('referer'),
    clientType: req.get('X-Client-Type'),
    appVersion: req.get('X-App-Version'),
    hasAuth: !!req.get('authorization'),
    hasAPIKey: !!req.get('X-API-Key')
  };
  
  // Log suspicious requests
  const isSuspicious = !requestLog.userAgent || 
                      requestLog.userAgent.length < 10 ||
                      requestLog.path.includes('..') ||
                      requestLog.path.includes('<script>');
  
  if (isSuspicious) {
    console.log('🚨 Suspicious request:', JSON.stringify(requestLog));
  }
  
  if (securityConfig.isDevelopment) {
    console.log('🔍 Request log:', JSON.stringify(requestLog, null, 2));
  }
  
  next();
};

/**
 * 📊 Rate Limit by Client Type
 */
const rateLimitByClientType = (req, res, next) => {
  const clientType = req.get('X-Client-Type') || 'unknown';
  const userAgent = req.get('user-agent') || '';
  
  // Different limits for different clients
  let limitMultiplier = 1;
  
  if (userAgent.includes('DanceSignal') || clientType === 'mobile') {
    limitMultiplier = 2; // Mobile apps get higher limits
  } else if (clientType === 'web') {
    limitMultiplier = 1.5; // Web clients get moderate limits
  } else if (userAgent.includes('curl') || userAgent.includes('Postman')) {
    limitMultiplier = 0.5; // Testing tools get lower limits
  }
  
  // Apply multiplier to rate limit (if available)
  if (req.rateLimit) {
    req.rateLimit.limit = Math.floor(req.rateLimit.limit * limitMultiplier);
  }
  
  next();
};

/**
 * 🎯 Access Control Presets
 */
const accessControlPresets = {
  // Public API endpoints (events, search) - REQUIRE AUTH OR VALID CLIENT
  public: [
    blockDirectBrowserAccess,
    requireAuthOrValidClient,
    logSecurityRequest,
    rateLimitByClientType
  ],
  
  // Protected public endpoints (require authentication)
  protected: [
    blockDirectBrowserAccess,
    requireAuthOrValidClient,
    logSecurityRequest,
    rateLimitByClientType
  ],
  
  // Mobile app specific endpoints
  mobileOnly: [
    mobileAppOnly,
    logSecurityRequest,
    rateLimitByClientType
  ],
  
  // Web client specific endpoints
  webOnly: [
    webClientOnly,
    logSecurityRequest,
    rateLimitByClientType
  ],
  
  // Internal service endpoints
  internal: [
    internalServiceOnly,
    logSecurityRequest
  ],
  
  // Admin endpoints
  admin: [
    adminOnly,
    logSecurityRequest
  ],
  
  // Webhook endpoints
  webhook: [
    webhookOnly,
    logSecurityRequest
  ],
  
  // Sensitive endpoints (payments, transfers)
  sensitive: [
    blockDirectBrowserAccess,
    requireAuthOrValidClient,
    logSecurityRequest,
    hideSensitiveEndpoints(['/payments/', '/transfers/', '/admin/'])
  ]
};

/**
 * 🔧 Apply Access Control Preset
 */
const applyAccessControl = (preset) => {
  if (!accessControlPresets[preset]) {
    console.warn(`⚠️ Unknown access control preset: ${preset}`);
    return [];
  }
  
  return accessControlPresets[preset];
};

module.exports = {
  blockDirectBrowserAccess,
  requireAuthOrValidClient,
  requireApplicationAuth: requireAuthOrValidClient, // Alias untuk backward compatibility
  mobileAppOnly,
  webClientOnly,
  internalServiceOnly,
  adminOnly,
  webhookOnly,
  hideSensitiveEndpoints,
  logSecurityRequest,
  rateLimitByClientType,
  accessControlPresets,
  applyAccessControl
};
