/**
 * 🏥 SECURITY HEALTH CHECK ENDPOINT
 * Minimal health check untuk production (development only features hidden)
 */

const express = require('express');
const { securityHealthCheck, generateSecurityReport } = require('../middleware/enhancedSecurity');
const securityConfig = require('../config/security');

const router = express.Router();

/**
 * 🔍 Basic Security Health Check (Production Safe)
 */
router.get('/health', (req, res) => {
  try {
    const healthCheck = securityHealthCheck();
    
    // Production-safe response (hide sensitive details)
    const response = {
      success: true,
      status: healthCheck.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: securityConfig.environment
    };
    
    // In development, include more details
    if (securityConfig.isDevelopment) {
      response.details = {
        issues: healthCheck.issues,
        features: {
          jwt: 'enabled',
          cors: 'enabled',
          rateLimit: 'enabled',
          validation: 'enabled'
        }
      };
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Security health check error:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 📊 Security Status (Development Only)
 */
router.get('/status', (req, res) => {
  if (securityConfig.isProduction) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  try {
    const report = generateSecurityReport();
    
    res.json({
      success: true,
      message: 'Security status report (development only)',
      data: report
    });
    
  } catch (error) {
    console.error('❌ Security status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate security status'
    });
  }
});

/**
 * 🔧 Security Test (Development Only)
 */
router.get('/test', (req, res) => {
  if (securityConfig.isProduction) {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  
  const testResults = {
    headers: {
      userAgent: req.get('user-agent'),
      origin: req.get('origin'),
      authorization: !!req.get('authorization'),
      apiKey: !!req.get('X-API-Key')
    },
    security: {
      ip: req.ip || req.connection.remoteAddress,
      authenticated: !!req.user,
      role: req.user?.role || null
    },
    timestamp: new Date().toISOString()
  };
  
  res.json({
    success: true,
    message: 'Security test endpoint (development only)',
    data: testResults
  });
});

module.exports = router;
