/**
 * 🛡️ SECURITY MIDDLEWARE INTEGRATION
 * Centralized setup untuk semua security features
 */

const securityConfig = require('../config/security');
const { enhancedSecurityHeaders, apiSecurityHeaders, adminHeaders, webhookHeaders, mobileAppHeaders } = require('./securityHeaders');
const { validateInternalAPIKey, validateAdminAPIKey, validateWebhookSignature } = require('./apiKeyValidation');
const { validateRequestSignature, optionalRequestSignature } = require('./requestSignature');
const { adminIPWhitelist, internalServiceIPWhitelist, webhookIPWhitelist, ipInfoMiddleware } = require('./ipWhitelist');
const { applyAccessControl } = require('./accessControl');
const { applyEndpointSecurity } = require('./endpointSecurity');

/**
 * 🎯 Apply Security Middleware to Express App
 */
const applySecurityMiddleware = (app) => {
  console.log('🛡️ Applying security middleware...');
  
  // 1. Apply endpoint security (request validation, timeouts, etc.)
  applyEndpointSecurity(app);
  
  // 2. IP Information middleware (for debugging)
  if (securityConfig.isDevelopment) {
    app.use('/api', ipInfoMiddleware);
    console.log('✅ IP information middleware enabled (development)');
  }
  
  // 3. Security headers for all routes
  if (process.env.ENABLE_ENHANCED_SECURITY_HEADERS === 'true') {
    app.use(enhancedSecurityHeaders());
    console.log('✅ Security headers enabled');
  }
  
  // 3.5. Mobile app headers for API routes
  if (process.env.MOBILE_APP_MODE === 'true') {
    app.use('/api', mobileAppHeaders);
    console.log('✅ Mobile app headers enabled');
  }
  
  // 4. Public API access control
  app.use('/api/events', ...applyAccessControl('public'));
  app.use('/api/search', ...applyAccessControl('public'));
  app.use('/api/artists', ...applyAccessControl('public'));
  app.use('/api/venues', ...applyAccessControl('public'));
  console.log('✅ Public API access control enabled');
  
  // 5. Mobile-only endpoints
  app.use('/api/mobile', ...applyAccessControl('mobileOnly'));
  console.log('✅ Mobile-only access control enabled');
  
  // 6. Admin-specific security
  if (process.env.ENABLE_IP_WHITELISTING === 'true') {
    app.use('/api/admin', adminIPWhitelist);
    console.log('✅ Admin IP whitelisting enabled');
  }
  
  if (process.env.ENABLE_API_KEY_VALIDATION === 'true') {
    app.use('/api/admin', validateAdminAPIKey);
    console.log('✅ Admin API key validation enabled');
  }
  
  app.use('/api/admin', ...applyAccessControl('admin'));
  app.use('/api/admin', adminHeaders);
  console.log('✅ Admin access control enabled');
  
  // 7. Internal service security
  if (process.env.ENABLE_IP_WHITELISTING === 'true') {
    app.use('/api/internal', internalServiceIPWhitelist);
    console.log('✅ Internal service IP whitelisting enabled');
  }
  
  if (process.env.ENABLE_API_KEY_VALIDATION === 'true') {
    app.use('/api/internal', validateInternalAPIKey);
    console.log('✅ Internal service API key validation enabled');
  }
  
  app.use('/api/internal', ...applyAccessControl('internal'));
  console.log('✅ Internal service access control enabled');
  
  // 8. Webhook security
  if (process.env.ENABLE_IP_WHITELISTING === 'true') {
    app.use('/webhooks', webhookIPWhitelist);
    console.log('✅ Webhook IP whitelisting enabled');
  }
  
  app.use('/webhooks', validateWebhookSignature);
  app.use('/webhooks', ...applyAccessControl('webhook'));
  app.use('/webhooks', webhookHeaders);
  console.log('✅ Webhook security enabled');
  
  // 9. Sensitive endpoints (payments, transfers)
  if (process.env.ENABLE_REQUEST_SIGNING === 'true') {
    app.use('/api/access-transfers', validateRequestSignature);
    app.use('/api/payments', validateRequestSignature);
    console.log('✅ Request signing enabled for sensitive endpoints');
  } else {
    app.use('/api/access-transfers', optionalRequestSignature);
    app.use('/api/payments', optionalRequestSignature);
    console.log('✅ Optional request signing enabled');
  }
  
  app.use('/api/access-transfers', ...applyAccessControl('sensitive'));
  app.use('/api/payments', ...applyAccessControl('sensitive'));
  console.log('✅ Sensitive endpoints access control enabled');
  
  console.log('🎉 Security middleware applied successfully!');
  
  // Log current security configuration
  logSecurityStatus();
};

/**
 * 📊 Log Current Security Status
 */
const logSecurityStatus = () => {
  console.log('\n🛡️ SECURITY STATUS REPORT:');
  console.log('==============================');
  
  const features = [
    { name: 'Enhanced Security Headers', enabled: process.env.ENABLE_ENHANCED_SECURITY_HEADERS === 'true' },
    { name: 'IP Whitelisting', enabled: process.env.ENABLE_IP_WHITELISTING === 'true' },
    { name: 'API Key Validation', enabled: process.env.ENABLE_API_KEY_VALIDATION === 'true' },
    { name: 'Request Signing', enabled: process.env.ENABLE_REQUEST_SIGNING === 'true' },
    { name: 'JWT Authentication', enabled: true },
    { name: 'Rate Limiting', enabled: true },
    { name: 'CORS Protection', enabled: true },
    { name: 'Helmet Security', enabled: true },
    { name: 'Input Validation', enabled: true },
    { name: 'Password Hashing', enabled: true }
  ];
  
  features.forEach(feature => {
    const status = feature.enabled ? '✅ ENABLED' : '⚠️ DISABLED';
    console.log(`  ${feature.name}: ${status}`);
  });
  
  console.log('\n🔧 ENVIRONMENT:', securityConfig.environment.toUpperCase());
  console.log('🔧 PRODUCTION MODE:', securityConfig.isProduction ? 'YES' : 'NO');
  
  if (securityConfig.isDevelopment) {
    console.log('\n⚠️ DEVELOPMENT MODE - Some security features are relaxed');
    console.log('  - CORS allows localhost origins');
    console.log('  - IP whitelisting may be bypassed');
    console.log('  - Request signing may be optional');
  }
  
  console.log('==============================\n');
};

/**
 * 🔧 Security Middleware untuk Specific Routes
 */
const securityPresets = {
  // Admin endpoints - maksimum security
  admin: [
    process.env.ENABLE_IP_WHITELISTING === 'true' ? adminIPWhitelist : null,
    process.env.ENABLE_API_KEY_VALIDATION === 'true' ? validateAdminAPIKey : null,
    adminHeaders
  ].filter(Boolean),
  
  // Internal service endpoints
  internal: [
    process.env.ENABLE_IP_WHITELISTING === 'true' ? internalServiceIPWhitelist : null,
    process.env.ENABLE_API_KEY_VALIDATION === 'true' ? validateInternalAPIKey : null
  ].filter(Boolean),
  
  // Webhook endpoints
  webhook: [
    process.env.ENABLE_IP_WHITELISTING === 'true' ? webhookIPWhitelist : null,
    validateWebhookSignature,
    webhookHeaders
  ].filter(Boolean),
  
  // Sensitive endpoints (payment, transfer)
  sensitive: [
    process.env.ENABLE_REQUEST_SIGNING === 'true' ? validateRequestSignature : optionalRequestSignature
  ],
  
  // Public API endpoints (events, search)
  public: [
    apiSecurityHeaders
  ],
  
  // Mobile app endpoints
  mobile: [
    apiSecurityHeaders
  ]
};

/**
 * 🎯 Apply Security Preset to Route
 */
const applySecurityPreset = (preset) => {
  if (!securityPresets[preset]) {
    console.warn(`⚠️ Unknown security preset: ${preset}`);
    return [];
  }
  
  return securityPresets[preset];
};

/**
 * 🔍 Security Health Check
 */
const securityHealthCheck = () => {
  const issues = [];
  
  // Check JWT secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your-super-secret-jwt-key-dancesignal-2024') {
    issues.push('JWT_SECRET should be changed from default value');
  }
  
  // Check API keys in production
  if (securityConfig.isProduction) {
    if (!process.env.INTERNAL_SERVICE_API_KEY || process.env.INTERNAL_SERVICE_API_KEY.includes('dev-')) {
      issues.push('INTERNAL_SERVICE_API_KEY should be changed for production');
    }
    
    if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.includes('dev-')) {
      issues.push('ADMIN_API_KEY should be changed for production');
    }
    
    if (!process.env.REQUEST_SIGNING_SECRET || process.env.REQUEST_SIGNING_SECRET.includes('dev-')) {
      issues.push('REQUEST_SIGNING_SECRET should be changed for production');
    }
  }
  
  // Check security features enabled in production
  if (securityConfig.isProduction) {
    if (process.env.ENABLE_IP_WHITELISTING !== 'true') {
      issues.push('IP whitelisting should be enabled in production');
    }
    
    if (process.env.ENABLE_API_KEY_VALIDATION !== 'true') {
      issues.push('API key validation should be enabled in production');
    }
    
    if (process.env.ENABLE_REQUEST_SIGNING !== 'true') {
      issues.push('Request signing should be enabled in production');
    }
  }
  
  return {
    healthy: issues.length === 0,
    issues: issues
  };
};

/**
 * 📋 Generate Security Report
 */
const generateSecurityReport = () => {
  const config = securityConfig.getCompleteConfig();
  const healthCheck = securityHealthCheck();
  
  return {
    timestamp: new Date().toISOString(),
    environment: config.environment,
    features: {
      jwt: { enabled: true, algorithm: config.jwt.algorithm },
      cors: { enabled: true, origins: config.cors.origin },
      rateLimit: { enabled: true, limits: config.rateLimit },
      helmet: { enabled: true, config: config.helmet },
      apiKey: { enabled: process.env.ENABLE_API_KEY_VALIDATION === 'true' },
      ipWhitelist: { enabled: process.env.ENABLE_IP_WHITELISTING === 'true' },
      requestSigning: { enabled: process.env.ENABLE_REQUEST_SIGNING === 'true' },
      enhancedHeaders: { enabled: process.env.ENABLE_ENHANCED_SECURITY_HEADERS === 'true' }
    },
    health: healthCheck,
    recommendations: healthCheck.issues.map(issue => ({
      type: 'security',
      priority: securityConfig.isProduction ? 'high' : 'medium',
      message: issue
    }))
  };
};

module.exports = {
  applySecurityMiddleware,
  applyEnhancedSecurity: applySecurityMiddleware, // Alias untuk backward compatibility
  securityPresets,
  applySecurityPreset,
  logSecurityStatus,
  securityHealthCheck,
  generateSecurityReport
};
