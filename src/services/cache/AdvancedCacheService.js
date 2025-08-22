const { redisService } = require('../../lib/redis');
const { prisma } = require('../../lib/prisma');
const crypto = require('crypto');

/**
 * 🚀 ADVANCED CACHE SERVICE FOR OFFLINE SUPPORT
 * 
 * Enterprise caching system with offline-first strategy:
 * - Multi-layer caching (Redis + Database + Client)
 * - Smart cache invalidation
 * - Offline content pre-loading
 * - Sync mechanism for cache updates
 * - Cache versioning for consistency
 * - Selective caching policies
 */
class AdvancedCacheService {
  constructor() {
    this.redis = redisService;
    this.prisma = prisma;
    
    // ✅ CACHE POLICIES: Define what can be cached vs real-time only
    this.cachePolicies = {
      // SAFE TO CACHE (Offline-friendly)
      events: { ttl: 300, offlineSupport: true, priority: 'high' }, // 5 minutes
      artists: { ttl: 900, offlineSupport: true, priority: 'high' }, // 15 minutes
      communities: { ttl: 600, offlineSupport: true, priority: 'medium' }, // 10 minutes
      news: { ttl: 1800, offlineSupport: true, priority: 'medium' }, // 30 minutes
      posts: { ttl: 300, offlineSupport: true, priority: 'low' }, // 5 minutes
      users: { ttl: 600, offlineSupport: true, priority: 'medium' }, // 10 minutes
      venues: { ttl: 3600, offlineSupport: true, priority: 'low' }, // 1 hour
      genres: { ttl: 7200, offlineSupport: true, priority: 'low' }, // 2 hours
      cities: { ttl: 7200, offlineSupport: true, priority: 'low' }, // 2 hours
      chatMessages: { ttl: 86400, offlineSupport: true, priority: 'medium' }, // 24 hours
      
      // NEVER CACHE (Always real-time)
      payments: { ttl: 0, offlineSupport: false, priority: 'critical' },
      bookings: { ttl: 60, offlineSupport: false, priority: 'critical' }, // 1 minute only
      accessTokens: { ttl: 0, offlineSupport: false, priority: 'critical' },
      secureOperations: { ttl: 0, offlineSupport: false, priority: 'critical' },
      realTimeChat: { ttl: 0, offlineSupport: false, priority: 'critical' },
      notifications: { ttl: 30, offlineSupport: false, priority: 'high' }, // 30 seconds only
      
      // MEDIUM CACHE (Short-term only)
      search: { ttl: 180, offlineSupport: true, priority: 'low' }, // 3 minutes
      analytics: { ttl: 300, offlineSupport: false, priority: 'medium' }, // 5 minutes
      recommendations: { ttl: 900, offlineSupport: true, priority: 'medium' } // 15 minutes
    };

    // ✅ CACHE VERSIONING: For consistency across updates
    this.cacheVersion = '1.0.0';
    this.versionKey = 'cache:version';
    
    console.log('🚀 AdvancedCacheService initialized with offline support');
    this.initializeCacheVersion();
  }

  /**
   * 🔄 INITIALIZE CACHE VERSION
   */
  async initializeCacheVersion() {
    try {
      const currentVersion = await this.redis.get(this.versionKey);
      if (!currentVersion || currentVersion !== this.cacheVersion) {
        console.log(`🔄 Cache version update: ${currentVersion} → ${this.cacheVersion}`);
        await this.redis.set(this.versionKey, this.cacheVersion);
        // Optionally clear old cache on version change
        // await this.clearAllCache();
      }
    } catch (error) {
      console.error('❌ Failed to initialize cache version:', error);
    }
  }

  /**
   * 🔑 GENERATE CACHE KEY
   */
  generateCacheKey(type, identifier, userId = null, params = {}) {
    const baseKey = `${type}:${identifier}`;
    
    // Add user-specific caching for personalized content
    const userKey = userId ? `:user:${userId}` : '';
    
    // Add parameters hash for parameterized queries
    const paramsHash = Object.keys(params).length > 0 
      ? `:params:${crypto.createHash('md5').update(JSON.stringify(params)).digest('hex')}`
      : '';
    
    return `v${this.cacheVersion}:${baseKey}${userKey}${paramsHash}`;
  }

  /**
   * ✅ CHECK IF CACHEABLE
   */
  isCacheable(type) {
    const policy = this.cachePolicies[type];
    return policy && policy.ttl > 0;
  }

  /**
   * 📱 CHECK IF OFFLINE SUPPORTED
   */
  isOfflineSupported(type) {
    const policy = this.cachePolicies[type];
    return policy && policy.offlineSupport === true;
  }

  /**
   * 💾 SET CACHE WITH METADATA
   */
  async setCache(type, identifier, data, userId = null, customTTL = null) {
    try {
      if (!this.isCacheable(type)) {
        console.log(`⚠️ Type '${type}' is not cacheable by policy`);
        return false;
      }

      const policy = this.cachePolicies[type];
      const ttl = customTTL || policy.ttl;
      const cacheKey = this.generateCacheKey(type, identifier, userId);
      
      // ✅ ENHANCED: Store with metadata for offline support
      const cacheData = {
        data,
        metadata: {
          type,
          identifier,
          userId,
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString(),
          version: this.cacheVersion,
          offlineSupported: policy.offlineSupported,
          priority: policy.priority
        }
      };

      await this.redis.set(cacheKey, cacheData, ttl);
      
      // ✅ OFFLINE INDEX: Track offline-supported content
      if (policy.offlineSupport) {
        await this.addToOfflineIndex(type, identifier, userId, policy.priority);
      }

      console.log(`💾 Cached '${type}:${identifier}' for ${ttl}s (offline: ${policy.offlineSupport})`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to set cache for ${type}:${identifier}:`, error);
      return false;
    }
  }

  /**
   * 📖 GET CACHE WITH METADATA
   */
  async getCache(type, identifier, userId = null, params = {}) {
    try {
      if (!this.isCacheable(type)) {
        return null;
      }

      const cacheKey = this.generateCacheKey(type, identifier, userId, params);
      const parsed = await this.redis.get(cacheKey);
      
      if (!parsed) {
        return null;
      }
      
      // ✅ VALIDATION: Check cache version consistency
      if (parsed.metadata.version !== this.cacheVersion) {
        console.log(`🔄 Cache version mismatch for ${cacheKey}, invalidating...`);
        await this.redis.invalidate(cacheKey);
        return null;
      }

      console.log(`✅ Cache hit for '${type}:${identifier}' (expires: ${parsed.metadata.expiresAt})`);
      return parsed;
    } catch (error) {
      console.error(`❌ Failed to get cache for ${type}:${identifier}:`, error);
      return null;
    }
  }

  /**
   * 📱 ADD TO OFFLINE INDEX
   */
  async addToOfflineIndex(type, identifier, userId, priority) {
    try {
      const indexKey = userId ? `offline:user:${userId}` : `offline:global`;
      const indexItem = {
        type,
        identifier,
        priority,
        indexedAt: new Date().toISOString()
      };

      // Use sorted set with priority scoring
      const priorityScore = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
      if (this.redis.redis && this.redis.redis.zadd) {
        await this.redis.redis.zadd(indexKey, priorityScore, JSON.stringify(indexItem));
      }
      
      // Keep only top 1000 items per user to manage storage
      if (this.redis.redis && this.redis.redis.zremrangebyrank) {
        await this.redis.redis.zremrangebyrank(indexKey, 0, -1001);
      }
    } catch (error) {
      console.error(`❌ Failed to add to offline index:`, error);
    }
  }

  /**
   * 📱 GET OFFLINE CACHE MANIFEST FOR USER
   */
  async getOfflineCacheManifest(userId, limit = 100) {
    try {
      const indexKey = `offline:user:${userId}`;
      const items = this.redis.redis && this.redis.redis.zrevrange 
        ? await this.redis.redis.zrevrange(indexKey, 0, limit - 1)
        : [];
      
      const manifest = [];
      for (const item of items) {
        const parsed = JSON.parse(item);
        const cacheKey = this.generateCacheKey(parsed.type, parsed.identifier, userId);
        const cacheItem = await this.redis.get(cacheKey);
        
        if (cacheItem) {
          manifest.push({
            type: parsed.type,
            identifier: parsed.identifier,
            priority: parsed.priority,
            data: cacheItem.data,
            metadata: cacheItem.metadata
          });
        }
      }

      console.log(`📱 Generated offline manifest for user ${userId}: ${manifest.length} items`);
      return manifest;
    } catch (error) {
      console.error(`❌ Failed to get offline manifest for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * 🔄 INVALIDATE CACHE
   */
  async invalidateCache(type, identifier = '*', userId = null) {
    try {
      const pattern = this.generateCacheKey(type, identifier, userId);
      const result = await this.redis.invalidate(pattern);
      console.log(`🗑️ Invalidated cache for pattern: ${pattern}`);

      // Also remove from offline index if applicable
      if (this.isOfflineSupported(type) && userId) {
        await this.removeFromOfflineIndex(type, identifier, userId);
      }

      return result ? 1 : 0;
    } catch (error) {
      console.error(`❌ Failed to invalidate cache for ${type}:${identifier}:`, error);
      return 0;
    }
  }

  /**
   * 📱 REMOVE FROM OFFLINE INDEX
   */
  async removeFromOfflineIndex(type, identifier, userId) {
    try {
      const indexKey = `offline:user:${userId}`;
      const items = this.redis.redis && this.redis.redis.zrange 
        ? await this.redis.redis.zrange(indexKey, 0, -1)
        : [];
      
      for (const item of items) {
        const parsed = JSON.parse(item);
        if (parsed.type === type && (identifier === '*' || parsed.identifier === identifier)) {
          if (this.redis.redis && this.redis.redis.zrem) {
            await this.redis.redis.zrem(indexKey, item);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Failed to remove from offline index:`, error);
    }
  }

  /**
   * 🔄 BULK CACHE OPERATIONS
   */
  async bulkSetCache(items) {
    try {
      let successCount = 0;

      for (const item of items) {
        const { type, identifier, data, userId, customTTL } = item;
        
        if (!this.isCacheable(type)) continue;

        const policy = this.cachePolicies[type];
        const ttl = customTTL || policy.ttl;
        const cacheKey = this.generateCacheKey(type, identifier, userId);
        
        const cacheData = {
          data,
          metadata: {
            type,
            identifier,
            userId,
            cachedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString(),
            version: this.cacheVersion,
            offlineSupported: policy.offlineSupport,
            priority: policy.priority
          }
        };

        // Note: For bulk operations, we'll do individual sets since RedisService doesn't expose pipeline
        await this.redis.set(cacheKey, cacheData, ttl);
        successCount++;
      }

      // Pipeline exec not needed since we're doing individual operations
      console.log(`💾 Bulk cached ${successCount}/${items.length} items`);
      return successCount;
    } catch (error) {
      console.error(`❌ Failed to bulk set cache:`, error);
      return 0;
    }
  }

  /**
   * 📊 GET CACHE STATISTICS
   */
  async getCacheStats(userId = null) {
    try {
      // Simplified stats since we can't easily scan all keys with current RedisService
      const stats = {
        totalKeys: 0,
        byType: {},
        offlineSupported: 0,
        memoryUsage: 0,
        note: 'Limited stats due to RedisService API constraints'
      };

      // Test a few sample keys to estimate stats
      const sampleTypes = ['events', 'artists', 'news'];
      for (const type of sampleTypes) {
        const testKey = this.generateCacheKey(type, 'test', userId);
        const data = await this.redis.get(testKey);
        if (data) {
          stats.totalKeys++;
          stats.byType[type] = 1;
          if (this.isOfflineSupported(type)) {
            stats.offlineSupported++;
          }
        }
      }

      return stats;
    } catch (error) {
      console.error(`❌ Failed to get cache stats:`, error);
      return { totalKeys: 0, byType: {}, offlineSupported: 0, memoryUsage: 0 };
    }
  }

  /**
   * 🧹 CLEANUP EXPIRED CACHE
   */
  async cleanupExpiredCache() {
    try {
      // Redis automatically cleans up expired keys, so this is mostly for logging
      console.log(`🧹 Cache cleanup requested (Redis handles expiry automatically)`);
      return 0;
    } catch (error) {
      console.error(`❌ Failed to cleanup expired cache:`, error);
      return 0;
    }
  }

  /**
   * 🔄 SYNC CACHE (For when app comes back online)
   */
  async syncUserCache(userId, lastSyncTimestamp) {
    try {
      const updates = [];
      
      // Check for updates since last sync
      const cutoffDate = new Date(lastSyncTimestamp);
      
      // Get updated events
      const updatedEvents = await this.prisma.event.findMany({
        where: { updatedAt: { gte: cutoffDate } },
        take: 50 // Limit for performance
      });

      for (const event of updatedEvents) {
        updates.push({
          type: 'events',
          identifier: event.id,
          action: 'update',
          data: event,
          timestamp: event.updatedAt
        });
      }

      // Similar for other cacheable types...
      
      console.log(`🔄 Sync found ${updates.length} updates for user ${userId}`);
      return updates;
    } catch (error) {
      console.error(`❌ Failed to sync cache for user ${userId}:`, error);
      return [];
    }
  }
}

module.exports = AdvancedCacheService;