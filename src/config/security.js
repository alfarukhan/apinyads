/**
 * 🛡️ SECURITY CONFIGURATION
 * Centralized security settings untuk DanceSignal API
 */

const crypto = require('crypto');

class SecurityConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.isProduction = this.environment === 'production';
    this.isDevelopment = this.environment === 'development';
  }

  /**
   * 🔐 JWT Configuration
   */
  getJWTConfig() {
    return {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      algorithm: 'HS256',
      issuer: 'dancesignal-api',
      audience: 'dancesignal-app'
    };
  }

  /**
   * 🚦 Rate Limiting Configuration
   */
  getRateLimitConfig() {
    const base = {
      // Global rate limiting
      global: {
        windowMs: this.isProduction ? 15 * 60 * 1000 : 60 * 1000, // 15min prod, 1min dev
        max: this.isProduction ? 10000 : 1000,
        message: 'Too many requests, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false
      },
      
      // Authentication endpoints
      auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: this.isProduction ? 20 : 50, // Lower in production
        message: 'Too many authentication attempts, please try again later.'
      },
      
      // Booking/Payment endpoints
      booking: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: this.isProduction ? 100 : 50,
        message: 'Too many booking attempts, please wait before trying again.'
      },
      
      // Transfer endpoints
      transfer: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: this.isProduction ? 50 : 20,
        message: 'Too many transfer attempts, please wait before trying again.'
      },
      
      // Ultra-strict for payments
      payment: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: this.isProduction ? 25 : 50,
        message: 'Payment rate limit exceeded for security.'
      }
    };

    return base;
  }

  /**
   * 🌐 CORS Configuration
   */
  getCORSConfig() {
    const allowedOrigins = this.isDevelopment ? [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3011', // CMS
      'http://localhost:3012',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3011',
      'capacitor://localhost',
      'http://localhost',
      'ionic://localhost',
      'file://'
    ] : (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

    return {
      origin: (origin, callback) => {
        // ✅ MOBILE APPS: Always allow requests with no origin (mobile apps, native apps)
        if (!origin) {
          console.log('🔓 CORS: No origin - allowing (likely mobile app)');
          return callback(null, true);
        }
        
        // ✅ MOBILE APPS: Allow all mobile app origins
        if (origin && (
          origin.startsWith('capacitor://') || 
          origin.startsWith('ionic://') || 
          origin.startsWith('file://') ||
          origin === 'null' // Some mobile webviews send 'null'
        )) {
          console.log(`📱 CORS: Mobile origin ${origin} - allowing`);
          return callback(null, true);
        }
        
        // ✅ DEVELOPMENT: Allow all localhost and LAN IPs
        if (this.isDevelopment && (
          origin.match(/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/) ||
          origin.includes('192.168.') ||
          origin.includes('10.0.') ||
          origin.includes('172.16.') ||
          origin.includes('103.191.') // User's current IP range
        )) {
          console.log(`🛠️ CORS: Development origin ${origin} - allowing`);
          return callback(null, true);
        }
        
        // Check allowed origins
        if (allowedOrigins.includes(origin)) {
          console.log(`✅ CORS: Whitelisted origin ${origin} - allowing`);
          callback(null, true);
        } else {
          // ✅ PRODUCTION: Always allow for mobile compatibility
          console.warn(`⚠️ CORS: Unrecognized origin ${origin}, allowing for mobile compatibility`);
          callback(null, true);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'Cache-Control',
        'X-CSRF-Token',
        'X-Access-Token',
        'X-API-Key', // For internal services
        'X-Client-Version',
        'X-Request-Signature', // For request signing
        'X-Client-Type', // ✅ Mobile identification header
        'X-App-Platform', // ✅ Platform identification header
        'User-Agent'
      ],
      exposedHeaders: [
        'Authorization', 
        'X-Total-Count',
        'X-Mobile-App-Detected', // ✅ Expose mobile detection result
        'X-Security-Headers-Bypassed' // ✅ Expose security bypass info
      ],
      optionsSuccessStatus: 200,
      preflightContinue: false,
      maxAge: this.isProduction ? 86400 : 0
    };
  }

  /**
   * 🛡️ Helmet Security Headers Configuration
   */
  getHelmetConfig() {
    // Disable strict CSP for mobile app compatibility
    const disableStrictCsp = process.env.DISABLE_STRICT_CSP === 'true';
    const mobileAppMode = process.env.MOBILE_APP_MODE === 'true';
    
    if (this.isDevelopment || disableStrictCsp || mobileAppMode) {
      return {
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: false,
        crossOriginOpenerPolicy: false
      };
    }

    return {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      },
      noSniff: true,
      frameguard: { action: 'deny' },
      xssFilter: true
    };
  }

  /**
   * 🔑 API Key Configuration
   */
  getAPIKeyConfig() {
    return {
      internalServiceKey: process.env.INTERNAL_SERVICE_API_KEY || 'dev-internal-key-change-me',
      adminAPIKey: process.env.ADMIN_API_KEY || 'dev-admin-key-change-me',
      webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET || 'dev-webhook-secret',
      
      // Key rotation settings
      keyRotationDays: 30,
      requireAPIKeyForInternal: this.isProduction
    };
  }

  /**
   * 📡 IP Whitelisting Configuration
   */
  getIPWhitelistConfig() {
    return {
      adminEndpoints: [
        '127.0.0.1',
        '::1',
        ...(process.env.ADMIN_IP_WHITELIST || '').split(',').filter(Boolean)
      ],
      internalServices: [
        '127.0.0.1',
        '::1',
        ...(process.env.INTERNAL_IP_WHITELIST || '').split(',').filter(Boolean)
      ],
      webhook: [
        '127.0.0.1',
        '::1',
        // Midtrans webhook IPs
        '103.8.221.74',
        '103.8.221.75',
        ...(process.env.WEBHOOK_IP_WHITELIST || '').split(',').filter(Boolean)
      ]
    };
  }

  /**
   * 🔐 Request Signing Configuration
   */
  getRequestSigningConfig() {
    return {
      enabled: this.isProduction,
      secret: process.env.REQUEST_SIGNING_SECRET || 'dev-signing-secret',
      algorithm: 'sha256',
      timestampTolerance: 300, // 5 minutes
      requiredHeaders: ['timestamp', 'nonce'],
      
      // Endpoints yang require signing
      requiredEndpoints: [
        '/api/admin/*',
        '/api/access-transfers/*',
        '/api/payments/*'
      ]
    };
  }

  /**
   * 🔍 Input Validation Configuration
   */
  getValidationConfig() {
    return {
      // Joi validation options
      joi: {
        abortEarly: false,
        allowUnknown: false,
        stripUnknown: true,
        errors: {
          wrap: {
            label: ''
          }
        }
      },
      
      // Content-Type validation
      allowedContentTypes: [
        'application/json',
        'application/x-www-form-urlencoded',
        'multipart/form-data'
      ],
      
      // File upload validation
      fileUpload: {
        maxSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB untuk mobile images
        allowedMimeTypes: [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/heic', // iOS photos
          'image/heif', // iOS photos
          'image/bmp',
          'image/tiff'
        ],
        maxFiles: 10
      }
    };
  }

  /**
   * 📊 Security Monitoring Configuration
   */
  getMonitoringConfig() {
    return {
      enabled: true,
      logSecurityEvents: true,
      alertOnSuspiciousActivity: this.isProduction,
      
      // Thresholds for alerts
      thresholds: {
        failedLoginAttempts: 5,
        consecutiveFailedRequests: 10,
        unusualRequestPatterns: 20
      },
      
      // Event types to monitor
      monitoredEvents: [
        'failed_authentication',
        'rate_limit_exceeded',
        'invalid_token',
        'suspicious_request_pattern',
        'ip_whitelist_violation',
        'request_signature_failure'
      ]
    };
  }

  /**
   * 🔄 Generate secure random values
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * 🔐 Hash sensitive data
   */
  hashSensitiveData(data, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512').toString('hex');
    return { hash, salt };
  }

  /**
   * ✅ Verify hashed data
   */
  verifySensitiveData(data, hash, salt) {
    const verifyHash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }

  /**
   * 📋 Get complete security configuration
   */
  getCompleteConfig() {
    return {
      environment: this.environment,
      jwt: this.getJWTConfig(),
      rateLimit: this.getRateLimitConfig(),
      cors: this.getCORSConfig(),
      helmet: this.getHelmetConfig(),
      apiKey: this.getAPIKeyConfig(),
      ipWhitelist: this.getIPWhitelistConfig(),
      requestSigning: this.getRequestSigningConfig(),
      validation: this.getValidationConfig(),
      monitoring: this.getMonitoringConfig()
    };
  }
}

// Export singleton instance
module.exports = new SecurityConfig();
