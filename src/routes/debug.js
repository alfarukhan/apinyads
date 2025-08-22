/**
 * 🔧 DEBUG ROUTES
 * For testing mobile app detection and API connectivity
 */

const express = require('express');
const router = express.Router();

/**
 * GET /debug/mobile-detection
 * Test mobile app detection
 */
router.get('/mobile-detection', (req, res) => {
  try {
    const userAgent = req.get('user-agent') || '';
    const clientType = req.get('X-Client-Type') || '';
    const origin = req.get('origin') || '';
    const appPlatform = req.get('X-App-Platform') || '';
    
    // Same detection logic as middleware
    const isMobileApp = userAgent.includes('DanceSignal') || 
                       userAgent.includes('Flutter') ||
                       userAgent.includes('Dart/') ||
                       userAgent.includes('okhttp') ||
                       userAgent.includes('CFNetwork') ||
                       clientType === 'mobile' ||
                       origin === 'capacitor://localhost' ||
                       origin === 'ionic://localhost' ||
                       origin === 'file://' ||
                       !origin;

    const debug = {
      detection: {
        isMobileApp,
        userAgent,
        clientType,
        origin,
        appPlatform,
        timestamp: new Date().toISOString()
      },
      headers: {
        'user-agent': userAgent,
        'x-client-type': clientType,
        'x-app-platform': appPlatform,
        'origin': origin,
        'host': req.get('host'),
        'connection': req.get('connection'),
        'accept': req.get('accept')
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        mobileAppMode: process.env.MOBILE_APP_MODE,
        disableStrictCsp: process.env.DISABLE_STRICT_CSP,
        enableMobileCors: process.env.ENABLE_MOBILE_CORS
      }
    };

    // Set debug headers
    res.setHeader('X-Mobile-App-Detected', isMobileApp ? 'true' : 'false');
    res.setHeader('X-Debug-Timestamp', new Date().toISOString());
    
    if (isMobileApp) {
      res.setHeader('X-Security-Headers-Bypassed', 'mobile');
    }

    console.log('🔧 Debug mobile detection:', debug);

    res.json({
      success: true,
      message: 'Mobile detection test successful',
      data: debug
    });
  } catch (error) {
    console.error('❌ Debug mobile detection error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug test failed',
      error: error.message
    });
  }
});

/**
 * GET /debug/security-headers
 * Test what security headers are applied
 */
router.get('/security-headers', (req, res) => {
  try {
    const appliedHeaders = {};
    
    // Check what headers were set by middleware
    const headerNames = [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-XSS-Protection',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Mobile-App-Detected',
      'X-Security-Headers-Bypassed',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Headers'
    ];
    
    headerNames.forEach(name => {
      const value = res.getHeader(name);
      if (value) {
        appliedHeaders[name] = value;
      }
    });

    res.json({
      success: true,
      message: 'Security headers test',
      data: {
        appliedHeaders,
        requestInfo: {
          userAgent: req.get('user-agent'),
          clientType: req.get('X-Client-Type'),
          origin: req.get('origin')
        }
      }
    });
  } catch (error) {
    console.error('❌ Debug security headers error:', error);
    res.status(500).json({
      success: false,
      message: 'Security headers test failed',
      error: error.message
    });
  }
});

/**
 * GET /debug/cors
 * Test CORS configuration
 */
router.get('/cors', (req, res) => {
  try {
    const corsHeaders = {
      'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': res.getHeader('Access-Control-Allow-Headers'),
      'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials'),
      'Access-Control-Expose-Headers': res.getHeader('Access-Control-Expose-Headers')
    };

    res.json({
      success: true,
      message: 'CORS test successful',
      data: {
        corsHeaders,
        requestOrigin: req.get('origin'),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Debug CORS error:', error);
    res.status(500).json({
      success: false,
      message: 'CORS test failed',
      error: error.message
    });
  }
});

/**
 * OPTIONS /debug/preflight
 * Test preflight requests
 */
router.options('/preflight', (req, res) => {
  res.setHeader('X-Preflight-Test', 'success');
  res.status(200).end();
});

module.exports = router;
