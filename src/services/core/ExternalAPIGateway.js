const axios = require('axios');
const crypto = require('crypto');

/**
 * 🌐 CENTRALIZED EXTERNAL API GATEWAY
 * 
 * Unified gateway for all external service integrations:
 * - Midtrans payment gateway
 * - Spotify API integration
 * - Firebase Cloud Messaging
 * - Email services (SMTP)
 * - SMS providers (future)
 * - Other third-party APIs
 * 
 * ✅ Security: Credential management & encryption
 * ✅ Reliability: Retry logic & circuit breakers
 * ✅ Performance: Request caching & rate limiting
 * ✅ Monitoring: Request logging & analytics
 */
class ExternalAPIGateway {
  constructor() {
    // ✅ CENTRALIZED: API configurations
    this.services = {
      midtrans: {
        name: 'Midtrans Payment Gateway',
        baseUrl: process.env.MIDTRANS_IS_PRODUCTION === 'true' 
          ? 'https://api.midtrans.com/v2' 
          : 'https://api.sandbox.midtrans.com/v2',
        snapUrl: process.env.MIDTRANS_IS_PRODUCTION === 'true'
          ? 'https://app.midtrans.com/snap/v1'
          : 'https://app.sandbox.midtrans.com/snap/v1',
        auth: {
          serverKey: process.env.MIDTRANS_SERVER_KEY,
          clientKey: process.env.MIDTRANS_CLIENT_KEY
        },
        timeout: 30000,
        retries: 3,
        rateLimitPerMinute: 1000
      },
      
      spotify: {
        name: 'Spotify Web API',
        baseUrl: 'https://api.spotify.com/v1',
        authUrl: 'https://accounts.spotify.com/api/token',
        auth: {
          clientId: process.env.SPOTIFY_CLIENT_ID,
          clientSecret: process.env.SPOTIFY_CLIENT_SECRET
        },
        timeout: 10000,
        retries: 2,
        rateLimitPerMinute: 100
      },
      
      firebase: {
        name: 'Firebase Cloud Messaging',
        baseUrl: 'https://fcm.googleapis.com/v1',
        auth: {
          serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        },
        timeout: 15000,
        retries: 3,
        rateLimitPerMinute: 600
      },
      
      email: {
        name: 'Email SMTP Service',
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        timeout: 20000,
        retries: 2,
        rateLimitPerMinute: 100
      }
    };

    // ✅ Request tracking & analytics
    this.requestStats = new Map();
    this.circuitBreakers = new Map();
    this.rateLimiters = new Map();

    // ✅ Response cache
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

    // ✅ Initialize circuit breakers
    this.initializeCircuitBreakers();

    console.log('🌐 ExternalAPIGateway initialized with services:', Object.keys(this.services));
  }

  /**
   * 🔄 CIRCUIT BREAKER INITIALIZATION
   */
  initializeCircuitBreakers() {
    for (const serviceName of Object.keys(this.services)) {
      this.circuitBreakers.set(serviceName, {
        state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
        failureCount: 0,
        lastFailureTime: null,
        failureThreshold: 5,
        recoveryTimeoutMs: 60000 // 1 minute
      });
    }
  }

  /**
   * 🎯 MIDTRANS API METHODS
   */
  
  async createMidtransTransaction(transactionData) {
    return await this.makeRequest('midtrans', {
      method: 'POST',
      endpoint: '/payment-links',
      data: transactionData,
      requireAuth: true,
      cacheKey: null // Don't cache payment creation
    });
  }

  async getMidtransTransactionStatus(orderId) {
    return await this.makeRequest('midtrans', {
      method: 'GET',
      endpoint: `/${orderId}/status`,
      requireAuth: true,
      cacheKey: `midtrans_status_${orderId}`,
      cacheTTL: 30000 // 30 seconds cache
    });
  }

  async createMidtransSnapToken(transactionData) {
    return await this.makeRequest('midtrans', {
      method: 'POST',
      endpoint: '/transactions',
      baseUrl: this.services.midtrans.snapUrl,
      data: transactionData,
      requireAuth: true,
      cacheKey: null
    });
  }

  /**
   * 🎵 SPOTIFY API METHODS
   */
  
  async getSpotifyAccessToken() {
    const cacheKey = 'spotify_access_token';
    
    // ✅ Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < cached.ttl) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }

    const tokenResponse = await this.makeRequest('spotify', {
      method: 'POST',
      endpoint: '/token',
      baseUrl: this.services.spotify.authUrl,
      data: 'grant_type=client_credentials',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.services.spotify.auth.clientId}:${this.services.spotify.auth.clientSecret}`).toString('base64')}`
      },
      requireAuth: false
    });

    // ✅ Cache token for almost full duration
    if (tokenResponse.access_token) {
      this.cache.set(cacheKey, {
        data: tokenResponse.access_token,
        timestamp: Date.now(),
        ttl: (tokenResponse.expires_in - 60) * 1000 // 1 minute buffer
      });
    }

    return tokenResponse.access_token;
  }

  async searchSpotifyTracks(query, limit = 20) {
    const accessToken = await this.getSpotifyAccessToken();
    
    return await this.makeRequest('spotify', {
      method: 'GET',
      endpoint: `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      requireAuth: false,
      cacheKey: `spotify_search_${query}_${limit}`,
      cacheTTL: 10 * 60 * 1000 // 10 minutes
    });
  }

  async getSpotifyFeaturedPlaylists(limit = 20) {
    const accessToken = await this.getSpotifyAccessToken();
    
    return await this.makeRequest('spotify', {
      method: 'GET',
      endpoint: `/browse/featured-playlists?limit=${limit}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      requireAuth: false,
      cacheKey: `spotify_featured_${limit}`,
      cacheTTL: 30 * 60 * 1000 // 30 minutes
    });
  }

  /**
   * 📱 FIREBASE PUSH NOTIFICATION METHODS - DEPRECATED
   * Use NotificationService.sendPushNotification() instead
   */

  /**
   * 🚀 CORE REQUEST METHOD
   * 
   * Universal request handler with all features
   */
  async makeRequest(serviceName, options) {
    const {
      method = 'GET',
      endpoint,
      baseUrl = null,
      data = null,
      headers = {},
      requireAuth = false,
      cacheKey = null,
      cacheTTL = this.cacheTimeout,
      retryAttempts = null
    } = options;

    const correlationId = this.generateCorrelationId();
    const service = this.services[serviceName];
    
    if (!service) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    console.log(`🌐 [${correlationId}] ${serviceName.toUpperCase()}: ${method} ${endpoint}`);

    try {
      // ✅ STEP 1: Check circuit breaker
      this.checkCircuitBreaker(serviceName);

      // ✅ STEP 2: Check rate limiting
      await this.checkRateLimit(serviceName);

      // ✅ STEP 3: Check cache
      if (cacheKey && method === 'GET') {
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
          console.log(`💾 [${correlationId}] Cache hit for ${cacheKey}`);
          return cached;
        }
      }

      // ✅ STEP 4: Build request configuration
      const requestConfig = {
        method: method.toLowerCase(),
        url: `${baseUrl || service.baseUrl}${endpoint}`,
        timeout: service.timeout,
        headers: {
          'User-Agent': 'DanceSignal-API/2.0',
          'X-Correlation-ID': correlationId,
          ...headers
        }
      };

      // ✅ Add authentication
      if (requireAuth && service.auth) {
        if (serviceName === 'midtrans') {
          requestConfig.auth = {
            username: service.auth.serverKey,
            password: ''
          };
        }
      }

      // ✅ Add request data
      if (data) {
        if (method.toUpperCase() === 'GET') {
          requestConfig.params = data;
        } else {
          requestConfig.data = data;
        }
      }

      // ✅ STEP 5: Make request with retry logic
      const maxRetries = retryAttempts !== null ? retryAttempts : service.retries;
      let lastError;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const startTime = Date.now();
          const response = await axios(requestConfig);
          const responseTime = Date.now() - startTime;

          // ✅ Log successful request
          console.log(`✅ [${correlationId}] ${serviceName.toUpperCase()}: ${response.status} (${responseTime}ms)`);

          // ✅ Update circuit breaker on success
          this.recordSuccess(serviceName);

          // ✅ Cache successful GET responses
          if (cacheKey && method === 'GET' && response.status === 200) {
            this.cacheResponse(cacheKey, response.data, cacheTTL);
          }

          // ✅ Track request statistics
          this.recordRequestStats(serviceName, responseTime, true);

          return response.data;

        } catch (error) {
          lastError = error;
          
          // ✅ Don't retry on client errors (4xx)
          if (error.response && error.response.status >= 400 && error.response.status < 500) {
            break;
          }

          // ✅ Wait before retry
          if (attempt < maxRetries) {
            const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
            console.warn(`⚠️ [${correlationId}] ${serviceName.toUpperCase()}: Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`);
            await this.delay(delayMs);
          }
        }
      }

      // ✅ All retries failed
      this.recordFailure(serviceName);
      this.recordRequestStats(serviceName, 0, false);
      
      throw this.createAPIError(serviceName, lastError, correlationId);

    } catch (error) {
      console.error(`❌ [${correlationId}] ${serviceName.toUpperCase()} request failed:`, error.message);
      throw error;
    }
  }

  /**
   * 🛡️ CIRCUIT BREAKER LOGIC
   */
  
  checkCircuitBreaker(serviceName) {
    const breaker = this.circuitBreakers.get(serviceName);
    
    if (breaker.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
      
      if (timeSinceLastFailure >= breaker.recoveryTimeoutMs) {
        breaker.state = 'HALF_OPEN';
        console.log(`🔄 Circuit breaker for ${serviceName} moved to HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${serviceName}. Service unavailable.`);
      }
    }
  }

  recordSuccess(serviceName) {
    const breaker = this.circuitBreakers.get(serviceName);
    breaker.failureCount = 0;
    breaker.state = 'CLOSED';
  }

  recordFailure(serviceName) {
    const breaker = this.circuitBreakers.get(serviceName);
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();
    
    if (breaker.failureCount >= breaker.failureThreshold) {
      breaker.state = 'OPEN';
      console.warn(`🚨 Circuit breaker OPEN for ${serviceName} after ${breaker.failureCount} failures`);
    }
  }

  /**
   * 🕒 RATE LIMITING
   */
  
  async checkRateLimit(serviceName) {
    const service = this.services[serviceName];
    if (!service.rateLimitPerMinute) return;

    const rateLimiter = this.rateLimiters.get(serviceName) || {
      requests: [],
      windowStart: Date.now()
    };

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute

    // ✅ Clean old requests outside window
    rateLimiter.requests = rateLimiter.requests.filter(time => now - time < windowMs);

    // ✅ Check if limit exceeded
    if (rateLimiter.requests.length >= service.rateLimitPerMinute) {
      const oldestRequest = Math.min(...rateLimiter.requests);
      const waitTime = windowMs - (now - oldestRequest);
      
      console.warn(`🕒 Rate limit exceeded for ${serviceName}. Waiting ${waitTime}ms`);
      await this.delay(waitTime);
    }

    // ✅ Record this request
    rateLimiter.requests.push(now);
    this.rateLimiters.set(serviceName, rateLimiter);
  }

  /**
   * 💾 CACHING METHODS
   */
  
  getCachedResponse(cacheKey) {
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < cached.ttl) {
        return cached.data;
      }
      this.cache.delete(cacheKey);
    }
    return null;
  }

  cacheResponse(cacheKey, data, ttl) {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  clearCache(pattern = null) {
    if (pattern) {
      for (const [key] of this.cache) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * 📊 STATISTICS & MONITORING
   */
  
  recordRequestStats(serviceName, responseTime, success) {
    const stats = this.requestStats.get(serviceName) || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      averageResponseTime: 0
    };

    stats.totalRequests++;
    stats.totalResponseTime += responseTime;
    stats.averageResponseTime = stats.totalResponseTime / stats.totalRequests;

    if (success) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }

    this.requestStats.set(serviceName, stats);
  }

  getServiceStats() {
    const stats = {};
    for (const [serviceName, serviceStats] of this.requestStats) {
      stats[serviceName] = {
        ...serviceStats,
        successRate: serviceStats.totalRequests > 0 
          ? (serviceStats.successfulRequests / serviceStats.totalRequests * 100).toFixed(2) + '%'
          : '0%',
        circuitBreakerState: this.circuitBreakers.get(serviceName).state
      };
    }
    return stats;
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  generateCorrelationId() {
    return `api_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  createAPIError(serviceName, originalError, correlationId) {
    const errorMessage = originalError.response
      ? `${serviceName.toUpperCase()} API Error: ${originalError.response.status} - ${originalError.response.statusText}`
      : `${serviceName.toUpperCase()} Request Failed: ${originalError.message}`;

    const error = new Error(errorMessage);
    error.service = serviceName;
    error.correlationId = correlationId;
    error.originalError = originalError;
    error.statusCode = originalError.response?.status || 500;

    return error;
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    this.cache.clear();
    this.requestStats.clear();
    this.rateLimiters.clear();
    console.log('✅ ExternalAPIGateway cleanup completed');
  }
}

module.exports = ExternalAPIGateway;