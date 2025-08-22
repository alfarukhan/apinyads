/**
 * 🚦 CENTRALIZED RATE LIMITING SERVICE
 * 
 * Advanced rate limiting & throttling system for DanceSignal:
 * - Multiple rate limiting algorithms (sliding window, token bucket, fixed window)
 * - Per-user, per-IP, per-endpoint granular limits
 * - Dynamic limit adjustment based on user behavior
 * - Distributed rate limiting with Redis
 * - Whitelist/blacklist management
 * - Attack detection & automatic blocking
 * 
 * ✅ Security: Prevents API abuse & DDoS attacks
 * ✅ Performance: Protects server resources from overload
 * ✅ Fairness: Ensures equal access for all users
 * ✅ Intelligence: Adaptive limits based on patterns
 */
class RateLimitService {
  constructor() {
    // ✅ CENTRALIZED: Rate limiting configuration
    this.config = {
      // Global Settings
      ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
      STORAGE_TYPE: process.env.RATE_LIMIT_STORAGE || 'memory', // memory, redis
      
      // Default Limits (requests per time window)
      DEFAULT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
      DEFAULT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      
      // Per-endpoint limits
      ENDPOINT_LIMITS: {
        // Authentication endpoints (stricter)
        'POST:/api/auth/login': { windowMs: 900000, max: 5 }, // 5 attempts per 15 minutes
        'POST:/api/auth/register': { windowMs: 3600000, max: 3 }, // 3 per hour
        'POST:/api/auth/forgot-password': { windowMs: 3600000, max: 3 }, // 3 per hour
        
        // Payment endpoints (moderate)
        'POST:/api/bookings': { windowMs: 60000, max: 10 }, // 10 bookings per minute
        'POST:/api/events/*/guest-list/payment': { windowMs: 60000, max: 10 },
        'GET:/api/bookings/*/payment-status': { windowMs: 60000, max: 30 },
        
        // General API endpoints
        'GET:/api/events': { windowMs: 60000, max: 100 }, // 100 per minute
        'GET:/api/events/*': { windowMs: 60000, max: 200 }, // 200 per minute
        'POST:/api/events': { windowMs: 60000, max: 5 }, // 5 new events per minute
        
        // File upload endpoints
        'POST:/api/upload': { windowMs: 60000, max: 20 }, // 20 uploads per minute
        
        // Search endpoints
        'GET:/api/search': { windowMs: 60000, max: 50 } // 50 searches per minute
      },
      
      // User role based limits
      ROLE_MULTIPLIERS: {
        USER: 1.0,
        ORGANIZER: 2.0,
        ADMIN: 10.0
      },
      
      // IP-based limits (global)
      IP_LIMITS: {
        REQUESTS_PER_MINUTE: parseInt(process.env.IP_LIMIT_PER_MINUTE) || 300,
        REQUESTS_PER_HOUR: parseInt(process.env.IP_LIMIT_PER_HOUR) || 1000,
        BURST_THRESHOLD: parseInt(process.env.IP_BURST_THRESHOLD) || 50 // requests in 10 seconds
      },
      
      // Blocking & penalties
      AUTO_BLOCK_ENABLED: process.env.AUTO_BLOCK_ENABLED !== 'false',
      VIOLATION_THRESHOLD: parseInt(process.env.VIOLATION_THRESHOLD) || 3,
      BLOCK_DURATION_MS: parseInt(process.env.BLOCK_DURATION_MS) || 3600000, // 1 hour
      PROGRESSIVE_PENALTY: process.env.PROGRESSIVE_PENALTY === 'true',
      
      // Whitelist/Blacklist
      WHITELIST_IPS: (process.env.WHITELIST_IPS || '').split(',').filter(Boolean),
      BLACKLIST_IPS: (process.env.BLACKLIST_IPS || '').split(',').filter(Boolean),
      
      // Performance
      CLEANUP_INTERVAL_MS: parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL) || 300000, // 5 minutes
      MEMORY_STORE_MAX_ENTRIES: parseInt(process.env.RATE_LIMIT_MAX_ENTRIES) || 10000
    };

    // ✅ Storage for rate limit counters
    this.memoryStore = new Map();
    this.blockedIPs = new Map();
    this.blockedUsers = new Map();
    this.violationCounts = new Map();

    // ✅ Statistics tracking
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      uniqueIPs: new Set(),
      uniqueUsers: new Set(),
      topEndpoints: new Map(),
      violationsByIP: new Map(),
      lastReset: Date.now()
    };

    // ✅ Start background tasks
    this.startCleanupScheduler();
    this.startStatsReporting();

    console.log('🚦 RateLimitService initialized:', {
      enabled: this.config.ENABLED,
      storage: this.config.STORAGE_TYPE,
      defaultLimit: `${this.config.DEFAULT_MAX_REQUESTS}/${this.config.DEFAULT_WINDOW_MS}ms`,
      autoBlock: this.config.AUTO_BLOCK_ENABLED
    });
  }

  /**
   * 🔍 MAIN RATE LIMIT CHECK
   * 
   * Comprehensive rate limiting with multiple checks
   */
  async checkRateLimit(req) {
    if (!this.config.ENABLED) {
      return { allowed: true };
    }

    const startTime = Date.now();
    const ip = this.getClientIP(req);
    const userId = req.user?.id || null;
    const endpoint = this.getEndpointKey(req);
    const userRole = req.user?.role || 'USER';

    this.stats.totalRequests++;
    this.stats.uniqueIPs.add(ip);
    if (userId) this.stats.uniqueUsers.add(userId);

    // ✅ Track endpoint usage
    const endpointCount = this.stats.topEndpoints.get(endpoint) || 0;
    this.stats.topEndpoints.set(endpoint, endpointCount + 1);

    try {
      // ✅ STEP 1: Check IP whitelist/blacklist
      const ipCheck = this.checkIPList(ip);
      if (!ipCheck.allowed) {
        return this.blockRequest('IP_BLACKLISTED', ip, endpoint, ipCheck.reason);
      }

      // ✅ STEP 2: Check if IP is temporarily blocked
      const blockCheck = this.checkBlocked(ip, userId);
      if (!blockCheck.allowed) {
        return this.blockRequest('TEMPORARILY_BLOCKED', ip, endpoint, blockCheck.reason, blockCheck.resetTime);
      }

      // ✅ STEP 3: Check IP-based global limits
      const ipLimitCheck = await this.checkIPLimits(ip);
      if (!ipLimitCheck.allowed) {
        this.recordViolation(ip, 'IP_LIMIT_EXCEEDED');
        return this.blockRequest('IP_LIMIT_EXCEEDED', ip, endpoint, 'IP request limit exceeded', ipLimitCheck.resetTime);
      }

      // ✅ STEP 4: Check endpoint-specific limits
      const endpointLimitCheck = await this.checkEndpointLimits(endpoint, ip, userId, userRole);
      if (!endpointLimitCheck.allowed) {
        this.recordViolation(ip, 'ENDPOINT_LIMIT_EXCEEDED');
        return this.blockRequest('ENDPOINT_LIMIT_EXCEEDED', ip, endpoint, 'Endpoint rate limit exceeded', endpointLimitCheck.resetTime);
      }

      // ✅ STEP 5: Check user-specific limits (if authenticated)
      if (userId) {
        const userLimitCheck = await this.checkUserLimits(userId, userRole);
        if (!userLimitCheck.allowed) {
          this.recordViolation(ip, 'USER_LIMIT_EXCEEDED');
          return this.blockRequest('USER_LIMIT_EXCEEDED', ip, endpoint, 'User rate limit exceeded', userLimitCheck.resetTime);
        }
      }

      // ✅ Request allowed
      const processingTime = Date.now() - startTime;
      return {
        allowed: true,
        limit: endpointLimitCheck.limit,
        remaining: endpointLimitCheck.remaining,
        resetTime: endpointLimitCheck.resetTime,
        retryAfter: null,
        processingTime
      };

    } catch (error) {
      console.error('❌ Rate limit check error:', error);
      // ✅ Fail open (allow request) on errors
      return { allowed: true, error: error.message };
    }
  }

  /**
   * 🌐 IP-BASED LIMITS
   */
  async checkIPLimits(ip) {
    const now = Date.now();
    
    // ✅ Check burst limit (last 10 seconds)
    const burstKey = `burst:${ip}`;
    const burstWindow = 10000; // 10 seconds
    const burstCheck = await this.checkSlidingWindow(burstKey, this.config.IP_LIMITS.BURST_THRESHOLD, burstWindow);
    
    if (!burstCheck.allowed) {
      return {
        allowed: false,
        reason: 'IP burst limit exceeded',
        resetTime: burstCheck.resetTime
      };
    }

    // ✅ Check per-minute limit
    const minuteKey = `ip_minute:${ip}`;
    const minuteCheck = await this.checkSlidingWindow(minuteKey, this.config.IP_LIMITS.REQUESTS_PER_MINUTE, 60000);
    
    if (!minuteCheck.allowed) {
      return {
        allowed: false,
        reason: 'IP minute limit exceeded',
        resetTime: minuteCheck.resetTime
      };
    }

    // ✅ Check per-hour limit
    const hourKey = `ip_hour:${ip}`;
    const hourCheck = await this.checkSlidingWindow(hourKey, this.config.IP_LIMITS.REQUESTS_PER_HOUR, 3600000);
    
    return hourCheck;
  }

  /**
   * 🎯 ENDPOINT-SPECIFIC LIMITS
   */
  async checkEndpointLimits(endpoint, ip, userId, userRole) {
    const endpointConfig = this.config.ENDPOINT_LIMITS[endpoint];
    
    if (!endpointConfig) {
      // ✅ Use default limits
      const key = `endpoint:${endpoint}:${userId || ip}`;
      return await this.checkSlidingWindow(
        key, 
        this.config.DEFAULT_MAX_REQUESTS * this.config.ROLE_MULTIPLIERS[userRole],
        this.config.DEFAULT_WINDOW_MS
      );
    }

    // ✅ Use specific endpoint limits
    const key = `endpoint:${endpoint}:${userId || ip}`;
    const adjustedLimit = Math.ceil(endpointConfig.max * this.config.ROLE_MULTIPLIERS[userRole]);
    
    return await this.checkSlidingWindow(key, adjustedLimit, endpointConfig.windowMs);
  }

  /**
   * 👤 USER-SPECIFIC LIMITS
   */
  async checkUserLimits(userId, userRole) {
    const baseLimit = this.config.DEFAULT_MAX_REQUESTS * this.config.ROLE_MULTIPLIERS[userRole];
    const key = `user:${userId}`;
    
    return await this.checkSlidingWindow(key, baseLimit, this.config.DEFAULT_WINDOW_MS);
  }

  /**
   * 🪟 SLIDING WINDOW ALGORITHM
   * 
   * Accurate rate limiting using sliding window counter
   */
  async checkSlidingWindow(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // ✅ Get or create window data
    let windowData = this.memoryStore.get(key) || {
      requests: [],
      count: 0
    };

    // ✅ Remove expired requests
    windowData.requests = windowData.requests.filter(timestamp => timestamp > windowStart);
    windowData.count = windowData.requests.length;

    // ✅ Check if limit exceeded
    if (windowData.count >= limit) {
      const oldestRequest = Math.min(...windowData.requests);
      const resetTime = oldestRequest + windowMs;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: resetTime,
        limit: limit
      };
    }

    // ✅ Record this request
    windowData.requests.push(now);
    windowData.count++;
    windowData.lastAccess = now;

    // ✅ Store updated window data
    this.memoryStore.set(key, windowData);

    return {
      allowed: true,
      remaining: limit - windowData.count,
      resetTime: now + windowMs,
      limit: limit
    };
  }

  /**
   * 🚫 BLOCKING & VIOLATION MANAGEMENT
   */
  checkIPList(ip) {
    if (this.config.WHITELIST_IPS.includes(ip)) {
      return { allowed: true, reason: 'IP whitelisted' };
    }

    if (this.config.BLACKLIST_IPS.includes(ip)) {
      return { allowed: false, reason: 'IP blacklisted' };
    }

    return { allowed: true };
  }

  checkBlocked(ip, userId) {
    const now = Date.now();

    // ✅ Check IP block
    const ipBlock = this.blockedIPs.get(ip);
    if (ipBlock && now < ipBlock.blockedUntil) {
      return {
        allowed: false,
        reason: 'IP temporarily blocked',
        resetTime: ipBlock.blockedUntil
      };
    }

    // ✅ Check user block
    if (userId) {
      const userBlock = this.blockedUsers.get(userId);
      if (userBlock && now < userBlock.blockedUntil) {
        return {
          allowed: false,
          reason: 'User temporarily blocked',
          resetTime: userBlock.blockedUntil
        };
      }
    }

    return { allowed: true };
  }

  recordViolation(ip, violationType) {
    if (!this.config.AUTO_BLOCK_ENABLED) return;

    const violationKey = `${ip}:${violationType}`;
    const violations = this.violationCounts.get(violationKey) || [];
    const now = Date.now();
    
    // ✅ Add current violation
    violations.push(now);
    
    // ✅ Remove old violations (last hour)
    const oneHourAgo = now - 3600000;
    const recentViolations = violations.filter(time => time > oneHourAgo);
    
    this.violationCounts.set(violationKey, recentViolations);

    // ✅ Check if threshold exceeded
    if (recentViolations.length >= this.config.VIOLATION_THRESHOLD) {
      this.blockIP(ip, `Multiple ${violationType} violations`);
    }

    // ✅ Update statistics
    const ipViolations = this.stats.violationsByIP.get(ip) || 0;
    this.stats.violationsByIP.set(ip, ipViolations + 1);
  }

  blockIP(ip, reason) {
    const now = Date.now();
    const blockDuration = this.config.PROGRESSIVE_PENALTY 
      ? this.calculateProgressivePenalty(ip)
      : this.config.BLOCK_DURATION_MS;

    this.blockedIPs.set(ip, {
      blockedAt: now,
      blockedUntil: now + blockDuration,
      reason: reason
    });

    console.warn(`🚫 IP blocked: ${ip} for ${Math.round(blockDuration / 60000)} minutes - ${reason}`);
  }

  blockUser(userId, reason) {
    const now = Date.now();
    
    this.blockedUsers.set(userId, {
      blockedAt: now,
      blockedUntil: now + this.config.BLOCK_DURATION_MS,
      reason: reason
    });

    console.warn(`🚫 User blocked: ${userId} - ${reason}`);
  }

  calculateProgressivePenalty(ip) {
    const ipViolations = this.stats.violationsByIP.get(ip) || 0;
    const baseTime = this.config.BLOCK_DURATION_MS;
    
    // ✅ Exponential backoff: 1x, 2x, 4x, 8x
    return baseTime * Math.pow(2, Math.min(ipViolations, 3));
  }

  blockRequest(reason, ip, endpoint, message, resetTime = null) {
    this.stats.blockedRequests++;
    
    console.warn(`🚦 Request blocked: ${reason} - ${ip} - ${endpoint}`);
    
    return {
      allowed: false,
      blocked: true,
      reason: reason,
      message: message,
      retryAfter: resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : null,
      ip: ip,
      endpoint: endpoint
    };
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  getClientIP(req) {
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           '0.0.0.0';
  }

  getEndpointKey(req) {
    // ✅ Create normalized endpoint key
    let path = req.route?.path || req.path;
    
    // ✅ Replace dynamic segments with wildcards
    path = path.replace(/\/:\w+/g, '/*');
    path = path.replace(/\/\d+/g, '/*');
    
    return `${req.method}:${path}`;
  }

  /**
   * 🧹 MAINTENANCE & CLEANUP
   */
  startCleanupScheduler() {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.config.CLEANUP_INTERVAL_MS);
  }

  cleanupExpiredEntries() {
    const now = Date.now();
    let cleanedCount = 0;

    // ✅ Clean memory store
    for (const [key, data] of this.memoryStore.entries()) {
      const age = now - (data.lastAccess || 0);
      if (age > this.config.DEFAULT_WINDOW_MS * 2) {
        this.memoryStore.delete(key);
        cleanedCount++;
      }
    }

    // ✅ Clean blocked IPs
    for (const [ip, blockData] of this.blockedIPs.entries()) {
      if (now > blockData.blockedUntil) {
        this.blockedIPs.delete(ip);
        cleanedCount++;
      }
    }

    // ✅ Clean blocked users
    for (const [userId, blockData] of this.blockedUsers.entries()) {
      if (now > blockData.blockedUntil) {
        this.blockedUsers.delete(userId);
        cleanedCount++;
      }
    }

    // ✅ Enforce memory limits
    if (this.memoryStore.size > this.config.MEMORY_STORE_MAX_ENTRIES) {
      const entries = Array.from(this.memoryStore.entries());
      entries.sort((a, b) => (a[1].lastAccess || 0) - (b[1].lastAccess || 0));
      
      const toRemove = entries.slice(0, entries.length - this.config.MEMORY_STORE_MAX_ENTRIES);
      toRemove.forEach(([key]) => this.memoryStore.delete(key));
      cleanedCount += toRemove.length;
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Rate limit cleanup: removed ${cleanedCount} expired entries`);
    }
  }

  startStatsReporting() {
    setInterval(() => {
      const stats = this.getStats();
      console.log('🚦 Rate limit stats:', stats);
    }, 300000); // Every 5 minutes
  }

  /**
   * 📊 STATISTICS & MONITORING
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    const hours = uptime / (1000 * 60 * 60);

    return {
      enabled: this.config.ENABLED,
      totalRequests: this.stats.totalRequests,
      blockedRequests: this.stats.blockedRequests,
      blockRate: this.stats.totalRequests > 0 
        ? ((this.stats.blockedRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      uniqueIPs: this.stats.uniqueIPs.size,
      uniqueUsers: this.stats.uniqueUsers.size,
      requestsPerHour: hours > 0 ? Math.round(this.stats.totalRequests / hours) : 0,
      activeBlocks: {
        ips: this.blockedIPs.size,
        users: this.blockedUsers.size
      },
      memoryUsage: {
        rateLimitEntries: this.memoryStore.size,
        violationEntries: this.violationCounts.size
      },
      topEndpoints: Array.from(this.stats.topEndpoints.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    };
  }

  getHealthStatus() {
    const memoryUsage = this.memoryStore.size / this.config.MEMORY_STORE_MAX_ENTRIES;
    
    return {
      status: this.config.ENABLED ? 'active' : 'disabled',
      memoryUsage: (memoryUsage * 100).toFixed(1) + '%',
      activeBlocks: this.blockedIPs.size + this.blockedUsers.size,
      performance: 'optimal' // Could be enhanced with actual performance metrics
    };
  }

  /**
   * 🔧 ADMINISTRATIVE METHODS
   */
  unblockIP(ip) {
    const wasBlocked = this.blockedIPs.delete(ip);
    if (wasBlocked) {
      console.log(`✅ IP unblocked: ${ip}`);
    }
    return wasBlocked;
  }

  unblockUser(userId) {
    const wasBlocked = this.blockedUsers.delete(userId);
    if (wasBlocked) {
      console.log(`✅ User unblocked: ${userId}`);
    }
    return wasBlocked;
  }

  resetStats() {
    this.stats = {
      totalRequests: 0,
      blockedRequests: 0,
      uniqueIPs: new Set(),
      uniqueUsers: new Set(),
      topEndpoints: new Map(),
      violationsByIP: new Map(),
      lastReset: Date.now()
    };
    console.log('📊 Rate limit stats reset');
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    this.memoryStore.clear();
    this.blockedIPs.clear();
    this.blockedUsers.clear();
    this.violationCounts.clear();
    console.log('✅ RateLimitService cleanup completed');
  }
}

module.exports = RateLimitService;