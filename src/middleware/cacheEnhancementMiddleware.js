const AdvancedCacheService = require('../services/cache/AdvancedCacheService');

/**
 * 🚀 CACHE ENHANCEMENT MIDDLEWARE
 * 
 * Automatically enhance existing endpoints with caching:
 * - Smart cache detection based on request
 * - Automatic cache invalidation on updates
 * - Offline-first response strategy
 * - Cache-aware response headers
 */

class CacheEnhancementMiddleware {
  constructor() {
    this.cacheService = new AdvancedCacheService();
    
    // ✅ AUTO-CACHE MAPPING: Map routes to cache types
    this.routeCacheMapping = {
      // Events
      '/api/events': { type: 'events', method: 'list' },
      '/api/events/:id': { type: 'events', method: 'single', param: 'id' },
      
      // Artists
      '/api/artists': { type: 'artists', method: 'list' },
      '/api/artists/:id': { type: 'artists', method: 'single', param: 'id' },
      
      // Communities
      '/api/communities': { type: 'communities', method: 'list' },
      '/api/communities/:id': { type: 'communities', method: 'single', param: 'id' },
      
      // News
      '/api/news': { type: 'news', method: 'list' },
      '/api/news/:id': { type: 'news', method: 'single', param: 'id' },
      
      // Users
      '/api/users/:id': { type: 'users', method: 'single', param: 'id' },
      
      // Chat messages
      '/api/chat/rooms/:id/messages': { type: 'chatMessages', method: 'list', param: 'id' }
    };
  }

  /**
   * 🔍 DETECT CACHE TYPE FROM REQUEST
   */
  detectCacheType(req) {
    const path = req.route?.path || req.path;
    const method = req.method.toLowerCase();
    
    // Find matching cache mapping
    for (const [routePattern, config] of Object.entries(this.routeCacheMapping)) {
      if (this.matchRoute(path, routePattern)) {
        return {
          ...config,
          identifier: config.param ? req.params[config.param] : 'list',
          shouldCache: method === 'get' && this.cacheService.isCacheable(config.type),
          shouldInvalidate: ['post', 'put', 'patch', 'delete'].includes(method)
        };
      }
    }
    
    return null;
  }

  /**
   * 🎯 MATCH ROUTE PATTERN
   */
  matchRoute(path, pattern) {
    // Convert Express route pattern to regex
    const regexPattern = pattern
      .replace(/:[^/]+/g, '[^/]+')
      .replace(/\//g, '\\/');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * 📖 CACHE READ MIDDLEWARE
   * Check cache before processing request
   */
  cacheRead() {
    return async (req, res, next) => {
      try {
        // Only cache GET requests
        if (req.method !== 'GET') {
          return next();
        }

        const cacheInfo = this.detectCacheType(req);
        if (!cacheInfo || !cacheInfo.shouldCache) {
          return next();
        }

        const userId = req.user?.id || null;
        const cached = await this.cacheService.getCache(
          cacheInfo.type, 
          cacheInfo.identifier, 
          userId,
          req.query
        );

        if (cached) {
          // ✅ CACHE HIT: Return cached data
          res.set({
            'X-Cache': 'HIT',
            'X-Cache-Type': cacheInfo.type,
            'X-Cache-Expires': cached.metadata.expiresAt,
            'X-Offline-Supported': cached.metadata.offlineSupported ? 'true' : 'false'
          });

          return res.json({
            success: true,
            data: cached.data,
            fromCache: true,
            cachedAt: cached.metadata.cachedAt,
            expiresAt: cached.metadata.expiresAt
          });
        }

        // ✅ CACHE MISS: Continue to actual endpoint
        req.cacheInfo = cacheInfo;
        req.shouldCache = true;
        next();
      } catch (error) {
        console.error('❌ Cache read error:', error);
        next(); // Continue without cache
      }
    };
  }

  /**
   * 💾 CACHE WRITE MIDDLEWARE
   * Cache response after processing
   */
  cacheWrite() {
    return async (req, res, next) => {
      try {
        if (!req.shouldCache || !req.cacheInfo) {
          return next();
        }

        // ✅ OVERRIDE: Intercept res.json to cache the response
        const originalJson = res.json.bind(res);
        
        res.json = async function(data) {
          try {
            // Cache successful responses only
            if (res.statusCode === 200 && data.success && data.data) {
              const userId = req.user?.id || null;
              
              await req.app.locals.cacheService.setCache(
                req.cacheInfo.type,
                req.cacheInfo.identifier,
                data.data,
                userId
              );

              // Add cache headers
              res.set({
                'X-Cache': 'MISS',
                'X-Cache-Type': req.cacheInfo.type,
                'X-Cached': 'true',
                'X-Offline-Supported': req.app.locals.cacheService.isOfflineSupported(req.cacheInfo.type) ? 'true' : 'false'
              });

              console.log(`💾 Cached ${req.cacheInfo.type}:${req.cacheInfo.identifier} for user ${userId || 'anonymous'}`);
            }
          } catch (cacheError) {
            console.error('❌ Cache write error:', cacheError);
          }
          
          return originalJson(data);
        };

        next();
      } catch (error) {
        console.error('❌ Cache write middleware error:', error);
        next();
      }
    };
  }

  /**
   * 🗑️ CACHE INVALIDATION MIDDLEWARE
   * Invalidate cache on data modifications
   */
  cacheInvalidate() {
    return async (req, res, next) => {
      try {
        const cacheInfo = this.detectCacheType(req);
        
        if (cacheInfo && cacheInfo.shouldInvalidate) {
          // ✅ OVERRIDE: Intercept res.json to invalidate cache after successful update
          const originalJson = res.json.bind(res);
          
          res.json = async function(data) {
            try {
              // Invalidate cache on successful modifications
              if ([200, 201].includes(res.statusCode) && data.success) {
                const userId = req.user?.id || null;
                
                // Invalidate specific item and list caches
                await req.app.locals.cacheService.invalidateCache(cacheInfo.type, cacheInfo.identifier, userId);
                await req.app.locals.cacheService.invalidateCache(cacheInfo.type, 'list', userId);
                
                console.log(`🗑️ Invalidated cache for ${cacheInfo.type}:${cacheInfo.identifier}`);
              }
            } catch (invalidateError) {
              console.error('❌ Cache invalidation error:', invalidateError);
            }
            
            return originalJson(data);
          };
        }

        next();
      } catch (error) {
        console.error('❌ Cache invalidate middleware error:', error);
        next();
      }
    };
  }

  /**
   * 🎯 SELECTIVE CACHE MIDDLEWARE
   * Apply to specific routes that need caching
   */
  applyToRoute() {
    return [
      this.cacheRead(),
      this.cacheWrite(),
      this.cacheInvalidate()
    ];
  }
}

// ✅ EXPORT: Ready-to-use middleware functions
const cacheMiddleware = new CacheEnhancementMiddleware();

module.exports = {
  CacheEnhancementMiddleware,
  cacheRead: cacheMiddleware.cacheRead(),
  cacheWrite: cacheMiddleware.cacheWrite(),
  cacheInvalidate: cacheMiddleware.cacheInvalidate(),
  cacheAll: cacheMiddleware.applyToRoute()
};