const Redis = require('ioredis');

/**
 * 🚀 ENTERPRISE REDIS SERVICE FOR 100K+ USERS
 * 
 * Features:
 * - High-performance caching with TTL
 * - Cluster support for horizontal scaling
 * - Connection pooling and failover
 * - Cache invalidation strategies
 * - Memory optimization for large datasets
 */

class RedisService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 3;
    this.inMemoryCache = new Map(); // ✅ FALLBACK: In-memory cache when Redis unavailable
    
    // ✅ ENTERPRISE: Cache TTL configurations for different data types
    this.cacheTTL = {
      events: 5 * 60, // 5 minutes - events change frequently during booking
      accessTiers: 10 * 60, // 10 minutes - tier pricing stable
      users: 15 * 60, // 15 minutes - user data relatively stable
      venues: 30 * 60, // 30 minutes - venue data rarely changes
      static: 60 * 60, // 1 hour - static configuration data
      session: 24 * 60 * 60, // 24 hours - user sessions
      shortTerm: 2 * 60, // 2 minutes - frequent updates (stock, etc.)
    };
    
    this.connect();
  }

  /**
   * ✅ PRODUCTION: Initialize Redis connection with cluster support
   */
  connect() {
    try {
      // ✅ CHECK: Redis enabled in environment
      if (process.env.REDIS_ENABLED === 'false') {
        console.log('📱 REDIS: Disabled in environment - using in-memory fallback');
        this.isConnected = false;
        this.setupInMemoryFallback();
        return;
      }

      // ✅ ENTERPRISE: Redis configuration optimized for high concurrency
      const redisConfig = {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        
        // ✅ PRODUCTION: Connection pool settings for 100k users
        family: 4,
        connectTimeout: 10000,
        commandTimeout: 5000,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableOfflineQueue: false,
        
        // ✅ ENTERPRISE: Memory and performance optimization
        maxmemoryPolicy: 'allkeys-lru',
        keyPrefix: process.env.NODE_ENV === 'production' ? 'ds:prod:' : 'ds:dev:',
      };

      // ✅ PRODUCTION: Check if clustering is enabled
      if (process.env.REDIS_CLUSTER_ENABLED === 'true') {
        console.log('🔗 REDIS: Initializing cluster mode for high availability');
        
        const clusterNodes = process.env.REDIS_CLUSTER_NODES 
          ? process.env.REDIS_CLUSTER_NODES.split(',')
          : [`${redisConfig.host}:${redisConfig.port}`];
          
        this.redis = new Redis.Cluster(clusterNodes, {
          redisOptions: redisConfig,
          enableOfflineQueue: false,
          maxRedirections: 3,
        });
      } else {
        console.log('🔗 REDIS: Initializing single instance mode');
        this.redis = new Redis(redisConfig);
      }

      // ✅ ENTERPRISE: Connection event handlers
      this.redis.on('connect', () => {
        console.log('✅ REDIS: Connected successfully');
        this.isConnected = true;
        this.connectionAttempts = 0;
      });

      this.redis.on('error', (error) => {
        console.error('❌ REDIS: Connection error:', error.message);
        this.isConnected = false;
        this.handleConnectionError(error);
      });

      this.redis.on('close', () => {
        console.log('🔄 REDIS: Connection closed');
        this.isConnected = false;
      });

      this.redis.on('reconnecting', () => {
        console.log('🔄 REDIS: Attempting to reconnect...');
      });

    } catch (error) {
      console.error('❌ REDIS: Failed to initialize:', error);
      this.handleConnectionError(error);
    }
  }

  /**
   * 📱 SETUP IN-MEMORY FALLBACK
   * When Redis is unavailable, use in-memory cache with TTL simulation
   */
  setupInMemoryFallback() {
    this.isConnected = false;
    console.log('📱 REDIS: Using in-memory cache fallback for development');
    
    // ✅ CLEANUP: Clear expired items every 5 minutes
    setInterval(() => {
      this.cleanupInMemoryCache();
    }, 5 * 60 * 1000);
  }

  /**
   * 🧹 CLEANUP IN-MEMORY CACHE
   */
  cleanupInMemoryCache() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, value] of this.inMemoryCache.entries()) {
      if (value.expiresAt && now > value.expiresAt) {
        this.inMemoryCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 MEMORY CACHE: Cleaned ${cleanedCount} expired items`);
    }
  }

  /**
   * ✅ ENTERPRISE: Handle connection errors with exponential backoff
   */
  handleConnectionError(error) {
    this.connectionAttempts++;
    
    if (this.connectionAttempts <= this.maxRetries) {
      const delay = Math.pow(2, this.connectionAttempts) * 1000; // Exponential backoff
      console.log(`⏳ REDIS: Retrying connection in ${delay}ms (attempt ${this.connectionAttempts}/${this.maxRetries})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error('💥 REDIS: Max retry attempts reached. Operating without cache.');
    }
  }

  /**
   * ✅ PRODUCTION: High-performance SET with automatic serialization
   */
  async set(key, value, ttlSeconds = null) {
    if (!this.isConnected) {
      // ✅ FALLBACK: Use in-memory cache
      const actualTTL = ttlSeconds || this.cacheTTL.static;
      const expiresAt = Date.now() + (actualTTL * 1000);
      
      this.inMemoryCache.set(key, {
        value,
        expiresAt
      });
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`💾 MEMORY CACHE: Cached ${key} (TTL: ${actualTTL}s)`);
      }
      
      return true;
    }

    try {
      const serializedValue = JSON.stringify(value);
      const actualTTL = ttlSeconds || this.cacheTTL.static;
      
      const result = await this.redis.setex(key, actualTTL, serializedValue);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`💾 REDIS: Cached ${key} (TTL: ${actualTTL}s, Size: ${serializedValue.length}b)`);
      }
      
      return result === 'OK';
    } catch (error) {
      console.error(`❌ REDIS: Failed to set ${key}:`, error.message);
      return false;
    }
  }

  /**
   * ✅ PRODUCTION: High-performance GET with automatic deserialization
   */
  async get(key) {
    if (!this.isConnected) {
      // ✅ FALLBACK: Use in-memory cache
      const cached = this.inMemoryCache.get(key);
      
      if (!cached) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`💨 MEMORY CACHE: Cache miss for ${key}`);
        }
        return null;
      }
      
      // Check if expired
      if (cached.expiresAt && Date.now() > cached.expiresAt) {
        this.inMemoryCache.delete(key);
        if (process.env.NODE_ENV === 'development') {
          console.log(`💨 MEMORY CACHE: Expired cache for ${key}`);
        }
        return null;
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎯 MEMORY CACHE: Cache hit for ${key}`);
      }
      
      return cached.value;
    }

    try {
      const value = await this.redis.get(key);
      
      if (value === null) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`💨 REDIS: Cache miss for ${key}`);
        }
        return null;
      }

      const deserializedValue = JSON.parse(value);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎯 REDIS: Cache hit for ${key}`);
      }
      
      return deserializedValue;
    } catch (error) {
      console.error(`❌ REDIS: Failed to get ${key}:`, error.message);
      return null;
    }
  }

  /**
   * ✅ ENTERPRISE: Batch operations for high concurrency
   */
  async mget(keys) {
    if (!this.isConnected || !keys.length) {
      return {};
    }

    try {
      const values = await this.redis.mget(keys);
      const result = {};
      
      keys.forEach((key, index) => {
        if (values[index] !== null) {
          try {
            result[key] = JSON.parse(values[index]);
          } catch (parseError) {
            console.error(`❌ REDIS: Failed to parse ${key}:`, parseError.message);
          }
        }
      });
      
      console.log(`🎯 REDIS: Batch get - ${Object.keys(result).length}/${keys.length} hits`);
      return result;
    } catch (error) {
      console.error('❌ REDIS: Batch get failed:', error.message);
      return {};
    }
  }

  /**
   * ✅ ENTERPRISE: Cache invalidation with pattern support
   */
  async invalidate(pattern) {
    if (!this.isConnected) {
      return false;
    }

    try {
      let cursor = '0';
      let deletedCount = 0;
      
      do {
        const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = newCursor;
        
        if (keys.length > 0) {
          const deleteResult = await this.redis.del(...keys);
          deletedCount += deleteResult;
        }
      } while (cursor !== '0');
      
      console.log(`🗑️ REDIS: Invalidated ${deletedCount} keys matching pattern: ${pattern}`);
      return true;
    } catch (error) {
      console.error(`❌ REDIS: Failed to invalidate ${pattern}:`, error.message);
      return false;
    }
  }

  /**
   * ✅ PRODUCTION: Specialized caching methods for DanceSignal entities
   */
  
  // Events caching (high frequency access)
  async cacheEvent(eventId, eventData) {
    return this.set(`event:${eventId}`, eventData, this.cacheTTL.events);
  }

  async getEvent(eventId) {
    return this.get(`event:${eventId}`);
  }

  async invalidateEvent(eventId) {
    return this.invalidate(`event:${eventId}*`);
  }

  // Access Tiers caching (booking critical data)
  async cacheAccessTier(tierId, tierData) {
    return this.set(`tier:${tierId}`, tierData, this.cacheTTL.accessTiers);
  }

  async getAccessTier(tierId) {
    return this.get(`tier:${tierId}`);
  }

  async invalidateAccessTier(tierId) {
    return this.invalidate(`tier:${tierId}*`);
  }

  // User data caching
  async cacheUser(userId, userData) {
    return this.set(`user:${userId}`, userData, this.cacheTTL.users);
  }

  async getUser(userId) {
    return this.get(`user:${userId}`);
  }

  async invalidateUser(userId) {
    return this.invalidate(`user:${userId}*`);
  }

  // Event list caching (for feed/browse)
  async cacheEventList(filterKey, events) {
    return this.set(`events:list:${filterKey}`, events, this.cacheTTL.shortTerm);
  }

  async getEventList(filterKey) {
    return this.get(`events:list:${filterKey}`);
  }

  // Stock availability caching (very short TTL for accuracy)
  async cacheStockAvailability(tierId, stockData) {
    return this.set(`stock:${tierId}`, stockData, this.cacheTTL.shortTerm);
  }

  async getStockAvailability(tierId) {
    return this.get(`stock:${tierId}`);
  }

  async invalidateStock(tierId) {
    return this.invalidate(`stock:${tierId}*`);
  }

  /**
   * ✅ ENTERPRISE: Cache statistics and monitoring
   */
  async getCacheStats() {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        connected: true,
        memory: this.parseRedisInfo(info),
        keyspace: this.parseRedisInfo(keyspace),
        connectionAttempts: this.connectionAttempts,
      };
    } catch (error) {
      console.error('❌ REDIS: Failed to get stats:', error.message);
      return { connected: false, error: error.message };
    }
  }

  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const result = {};
    
    lines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    });
    
    return result;
  }

  /**
   * ✅ ENTERPRISE: Graceful shutdown
   */
  async disconnect() {
    if (this.redis) {
      console.log('🔄 REDIS: Disconnecting...');
      await this.redis.quit();
      console.log('✅ REDIS: Disconnected successfully');
    }
  }
}

// ✅ PRODUCTION: Export singleton instance for consistent caching
const redisService = new RedisService();

module.exports = redisService;