/**
 * ✍️ REQUEST SIGNATURE VALIDATION MIDDLEWARE
 * Untuk validasi signature pada sensitive endpoints
 */

const crypto = require('crypto');
const securityConfig = require('../config/security');

/**
 * 🔐 Generate Request Signature
 * Format: HMAC-SHA256(timestamp + nonce + method + path + body)
 */
const generateRequestSignature = (timestamp, nonce, method, path, body = '', secret = null) => {
  try {
    const config = securityConfig.getRequestSigningConfig();
    const signingSecret = secret || config.secret;
    
    // Create canonical string for signing
    const canonicalString = [
      timestamp,
      nonce,
      method.toUpperCase(),
      path,
      typeof body === 'object' ? JSON.stringify(body) : body
    ].join('\n');
    
    console.log('🔐 Generating signature for canonical string length:', canonicalString.length);
    
    // Generate HMAC signature
    const signature = crypto
      .createHmac(config.algorithm, signingSecret)
      .update(canonicalString, 'utf8')
      .digest('hex');
    
    return signature;
    
  } catch (error) {
    console.error('❌ Error generating request signature:', error);
    throw new Error('Signature generation failed');
  }
};

/**
 * 🔍 Validate Request Signature
 */
const validateRequestSignature = (req, res, next) => {
  try {
    const config = securityConfig.getRequestSigningConfig();
    
    console.log('✍️ Request signature validation started');
    console.log('  Path:', req.path);
    console.log('  Method:', req.method);
    
    // Skip validation in development jika disabled
    if (!config.enabled) {
      console.log('✅ Request signature validation skipped (disabled)');
      return next();
    }
    
    // Check if endpoint requires signing
    const requiresSigning = config.requiredEndpoints.some(pattern => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(req.path);
    });
    
    if (!requiresSigning) {
      console.log('✅ Request signature not required for this endpoint');
      return next();
    }
    
    console.log('🔍 Request signature required for this endpoint');
    
    // Extract signature headers
    const signature = req.header('X-Request-Signature');
    const timestamp = req.header('X-Request-Timestamp');
    const nonce = req.header('X-Request-Nonce');
    
    if (!signature || !timestamp || !nonce) {
      console.log('❌ Missing required signature headers');
      return res.status(401).json({
        success: false,
        message: 'Request signature headers required',
        code: 'SIGNATURE_HEADERS_MISSING',
        required: ['X-Request-Signature', 'X-Request-Timestamp', 'X-Request-Nonce']
      });
    }
    
    // Validate timestamp (prevent replay attacks)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    
    if (Math.abs(currentTime - requestTime) > config.timestampTolerance) {
      console.log('❌ Request timestamp outside tolerance');
      console.log('  Current time:', currentTime);
      console.log('  Request time:', requestTime);
      console.log('  Difference:', Math.abs(currentTime - requestTime));
      
      return res.status(401).json({
        success: false,
        message: 'Request timestamp outside allowed tolerance',
        code: 'TIMESTAMP_INVALID',
        tolerance: config.timestampTolerance
      });
    }
    
    // Generate expected signature
    const body = req.method === 'GET' ? '' : req.body;
    const expectedSignature = generateRequestSignature(
      timestamp,
      nonce,
      req.method,
      req.path,
      body,
      config.secret
    );
    
    // Compare signatures using timing-safe comparison
    if (!crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      console.log('❌ Request signature mismatch');
      console.log('  Expected signature length:', expectedSignature.length);
      console.log('  Received signature length:', signature.length);
      
      return res.status(401).json({
        success: false,
        message: 'Invalid request signature',
        code: 'SIGNATURE_INVALID'
      });
    }
    
    console.log('✅ Request signature validated successfully');
    req.isSignedRequest = true;
    req.requestNonce = nonce;
    req.requestTimestamp = timestamp;
    
    next();
    
  } catch (error) {
    console.error('❌ Request signature validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Request signature validation failed',
      code: 'SIGNATURE_VALIDATION_ERROR'
    });
  }
};

/**
 * 🎯 Optional Request Signature Validation
 */
const optionalRequestSignature = (req, res, next) => {
  try {
    const signature = req.header('X-Request-Signature');
    
    if (!signature) {
      req.isSignedRequest = false;
      return next();
    }
    
    // If signature is provided, validate it
    validateRequestSignature(req, res, next);
    
  } catch (error) {
    console.error('❌ Optional request signature validation error:', error);
    req.isSignedRequest = false;
    next();
  }
};

/**
 * 🔄 Generate Nonce untuk Client
 */
const generateNonce = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * 📊 Log Signature Validation Events
 */
const logSignatureValidation = (success, req, error = null) => {
  const logData = {
    timestamp: new Date().toISOString(),
    success,
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent')?.substring(0, 100),
    hasSignature: !!req.header('X-Request-Signature'),
    hasTimestamp: !!req.header('X-Request-Timestamp'),
    hasNonce: !!req.header('X-Request-Nonce'),
    error: error?.message
  };
  
  console.log(`✍️ Signature Validation: ${JSON.stringify(logData)}`);
  
  // In production, send to monitoring system
  if (securityConfig.isProduction && !success) {
    // TODO: Send alert to monitoring system
  }
};

/**
 * 🛡️ Enhanced Signature Validation dengan Monitoring
 */
const enhancedSignatureValidation = (options = {}) => {
  const {
    required = true,
    customSecret = null,
    customTolerance = null
  } = options;
  
  return (req, res, next) => {
    const startTime = Date.now();
    
    try {
      // Override config if custom options provided
      if (customSecret || customTolerance) {
        const originalConfig = securityConfig.getRequestSigningConfig();
        const customConfig = {
          ...originalConfig,
          secret: customSecret || originalConfig.secret,
          timestampTolerance: customTolerance || originalConfig.timestampTolerance
        };
        
        // Temporarily override config
        req.customSigningConfig = customConfig;
      }
      
      const middleware = required ? validateRequestSignature : optionalRequestSignature;
      
      middleware(req, res, (error) => {
        const duration = Date.now() - startTime;
        const success = !error;
        
        logSignatureValidation(success, req, error);
        
        if (error) {
          return next(error);
        }
        
        console.log(`✅ Signature validation completed in ${duration}ms`);
        next();
      });
      
    } catch (error) {
      console.error('❌ Enhanced signature validation error:', error);
      logSignatureValidation(false, req, error);
      
      res.status(500).json({
        success: false,
        message: 'Signature validation system error',
        code: 'SIGNATURE_SYSTEM_ERROR'
      });
    }
  };
};

/**
 * 🔧 Signature Validation Utility untuk Testing
 */
const createSignatureForTesting = (method, path, body = '', timestamp = null, nonce = null) => {
  const config = securityConfig.getRequestSigningConfig();
  const ts = timestamp || Math.floor(Date.now() / 1000).toString();
  const nc = nonce || generateNonce();
  
  const signature = generateRequestSignature(ts, nc, method, path, body);
  
  return {
    signature,
    timestamp: ts,
    nonce: nc,
    headers: {
      'X-Request-Signature': signature,
      'X-Request-Timestamp': ts,
      'X-Request-Nonce': nc
    }
  };
};

/**
 * 🔍 Validate Signature Configuration
 */
const validateSignatureConfig = () => {
  const config = securityConfig.getRequestSigningConfig();
  
  const issues = [];
  
  if (!config.secret || config.secret === 'dev-signing-secret') {
    issues.push('Request signing secret should be changed from default');
  }
  
  if (config.secret.length < 32) {
    issues.push('Request signing secret should be at least 32 characters');
  }
  
  if (config.timestampTolerance > 600) {
    issues.push('Timestamp tolerance should not exceed 10 minutes for security');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
};

module.exports = {
  validateRequestSignature,
  optionalRequestSignature,
  enhancedSignatureValidation,
  generateRequestSignature,
  generateNonce,
  createSignatureForTesting,
  validateSignatureConfig,
  logSignatureValidation
};
