/**
 * 🔑 API KEY VALIDATION MIDDLEWARE
 * Untuk validasi internal services dan admin endpoints
 */

const crypto = require('crypto');
const securityConfig = require('../config/security');

/**
 * 🔐 Validate API Key untuk Internal Services
 */
const validateInternalAPIKey = (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    const config = securityConfig.getAPIKeyConfig();
    
    console.log('🔑 Internal API Key validation started');
    
    // Skip validation in development jika tidak required
    if (!config.requireAPIKeyForInternal && securityConfig.isDevelopment) {
      console.log('✅ API Key validation skipped for development');
      return next();
    }
    
    if (!apiKey) {
      console.log('❌ API Key missing in headers');
      return res.status(401).json({
        success: false,
        message: 'Internal API key required',
        code: 'API_KEY_MISSING'
      });
    }
    
    // Validate against expected internal service key
    if (apiKey !== config.internalServiceKey) {
      console.log('❌ Invalid internal API key provided');
      return res.status(401).json({
        success: false,
        message: 'Invalid internal API key',
        code: 'API_KEY_INVALID'
      });
    }
    
    console.log('✅ Internal API key validated successfully');
    req.isInternalService = true;
    next();
    
  } catch (error) {
    console.error('❌ API Key validation error:', error);
    res.status(500).json({
      success: false,
      message: 'API key validation failed',
      code: 'API_KEY_VALIDATION_ERROR'
    });
  }
};

/**
 * 🛡️ Validate Admin API Key
 */
const validateAdminAPIKey = (req, res, next) => {
  try {
    const apiKey = req.header('X-Admin-API-Key');
    const config = securityConfig.getAPIKeyConfig();
    
    console.log('🔑 Admin API Key validation started');
    
    if (!apiKey) {
      console.log('❌ Admin API Key missing');
      return res.status(401).json({
        success: false,
        message: 'Admin API key required',
        code: 'ADMIN_API_KEY_MISSING'
      });
    }
    
    if (apiKey !== config.adminAPIKey) {
      console.log('❌ Invalid admin API key');
      return res.status(401).json({
        success: false,
        message: 'Invalid admin API key',
        code: 'ADMIN_API_KEY_INVALID'
      });
    }
    
    console.log('✅ Admin API key validated successfully');
    req.isAdminService = true;
    next();
    
  } catch (error) {
    console.error('❌ Admin API Key validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Admin API key validation failed',
      code: 'ADMIN_API_KEY_VALIDATION_ERROR'
    });
  }
};

/**
 * 🔐 Validate Webhook Signature
 */
const validateWebhookSignature = (req, res, next) => {
  try {
    const signature = req.header('X-Webhook-Signature');
    const timestamp = req.header('X-Webhook-Timestamp');
    const config = securityConfig.getAPIKeyConfig();
    
    console.log('🔑 Webhook signature validation started');
    
    if (!signature || !timestamp) {
      console.log('❌ Webhook signature or timestamp missing');
      return res.status(401).json({
        success: false,
        message: 'Webhook signature and timestamp required',
        code: 'WEBHOOK_SIGNATURE_MISSING'
      });
    }
    
    // Check timestamp tolerance (5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTime = parseInt(timestamp);
    
    if (Math.abs(currentTime - webhookTime) > 300) {
      console.log('❌ Webhook timestamp outside tolerance');
      return res.status(401).json({
        success: false,
        message: 'Webhook timestamp outside allowed tolerance',
        code: 'WEBHOOK_TIMESTAMP_INVALID'
      });
    }
    
    // Create expected signature
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', config.webhookSigningSecret)
      .update(timestamp + payload)
      .digest('hex');
    
    const receivedSignature = signature.replace('sha256=', '');
    
    if (!crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    )) {
      console.log('❌ Webhook signature mismatch');
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook signature',
        code: 'WEBHOOK_SIGNATURE_INVALID'
      });
    }
    
    console.log('✅ Webhook signature validated successfully');
    req.isValidWebhook = true;
    next();
    
  } catch (error) {
    console.error('❌ Webhook signature validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook signature validation failed',
      code: 'WEBHOOK_SIGNATURE_VALIDATION_ERROR'
    });
  }
};

/**
 * 🔄 Optional API Key Validation (doesn't fail if missing)
 */
const optionalAPIKeyValidation = (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    const config = securityConfig.getAPIKeyConfig();
    
    if (!apiKey) {
      req.isInternalService = false;
      return next();
    }
    
    if (apiKey === config.internalServiceKey) {
      req.isInternalService = true;
      console.log('✅ Optional API key validated - internal service detected');
    } else {
      req.isInternalService = false;
      console.log('⚠️ Optional API key provided but invalid');
    }
    
    next();
    
  } catch (error) {
    console.error('❌ Optional API Key validation error:', error);
    req.isInternalService = false;
    next();
  }
};

/**
 * 🎯 Generate API Keys untuk Development
 */
const generateAPIKeys = () => {
  const internalKey = securityConfig.generateSecureToken(32);
  const adminKey = securityConfig.generateSecureToken(32);
  const webhookSecret = securityConfig.generateSecureToken(32);
  
  return {
    internalServiceKey: internalKey,
    adminAPIKey: adminKey,
    webhookSigningSecret: webhookSecret
  };
};

/**
 * 📊 Log API Key Usage
 */
const logAPIKeyUsage = (keyType, success, ip, userAgent) => {
  const logData = {
    timestamp: new Date().toISOString(),
    keyType,
    success,
    ip,
    userAgent: userAgent?.substring(0, 100) // Limit length
  };
  
  console.log(`🔑 API Key Usage: ${JSON.stringify(logData)}`);
  
  // In production, send to monitoring system
  if (securityConfig.isProduction) {
    // TODO: Send to monitoring/alerting system
  }
};

/**
 * 🛡️ Enhanced API Key Middleware dengan Logging
 */
const enhancedAPIKeyValidation = (keyType = 'internal') => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    try {
      const middleware = keyType === 'admin' 
        ? validateAdminAPIKey 
        : validateInternalAPIKey;
      
      middleware(req, res, (error) => {
        const duration = Date.now() - startTime;
        const success = !error;
        
        logAPIKeyUsage(
          keyType,
          success,
          req.ip || req.connection.remoteAddress,
          req.get('user-agent')
        );
        
        if (error) {
          return next(error);
        }
        
        console.log(`✅ API Key validation completed in ${duration}ms`);
        next();
      });
      
    } catch (error) {
      console.error('❌ Enhanced API Key validation error:', error);
      logAPIKeyUsage(keyType, false, req.ip, req.get('user-agent'));
      
      res.status(500).json({
        success: false,
        message: 'API key validation system error',
        code: 'API_KEY_SYSTEM_ERROR'
      });
    }
  };
};

module.exports = {
  validateInternalAPIKey,
  validateAdminAPIKey,
  validateWebhookSignature,
  optionalAPIKeyValidation,
  enhancedAPIKeyValidation,
  generateAPIKeys,
  logAPIKeyUsage
};
