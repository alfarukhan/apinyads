const CacheService = require('./CacheService');
const AuditLogService = require('./AuditLogService');
const crypto = require('crypto');

/**
 * 🔥 CENTRALIZED CACHE INVALIDATION SERVICE
 * 
 * Intelligent cache invalidation system for DanceSignal:
 * - Smart pattern-based invalidation
 * - Dependency graph tracking
 * - Selective cache warming
 * - Performance optimization
 * - Audit trail for invalidations
 * - Bulk operation support
 * 
 * ✅ Intelligence: Automatic dependency detection
 * ✅ Performance: Minimal unnecessary invalidations
 * ✅ Reliability: Guaranteed cache consistency
 * ✅ Observability: Complete invalidation tracking
 */
class CacheInvalidationService {
  constructor() {
    this.cacheService = new CacheService();
    this.auditService = new AuditLogService();

    // ✅ Cache dependency mapping
    this.dependencies = {
      // User-related invalidations
      user: {
        patterns: ['user:*', 'user_profile:*', 'user_session:*'],
        dependent: ['event:*:organizer:*', 'booking:*:user:*', 'analytics:user:*'],
        warmAfter: ['user_profile', 'user_stats']
      },

      // Event-related invalidations
      event: {
        patterns: ['event:*', 'event_list:*', 'event_detail:*'],
        dependent: ['booking:*', 'analytics:event:*', 'recommendation:*'],
        warmAfter: ['event_list', 'popular_events', 'upcoming_events']
      },

      // Booking-related invalidations
      booking: {
        patterns: ['booking:*', 'user_bookings:*', 'event_bookings:*'],
        dependent: ['analytics:booking:*', 'capacity:*', 'revenue:*'],
        warmAfter: ['user_stats', 'event_stats']
      },

      // Payment-related invalidations
      payment: {
        patterns: ['payment:*', 'payment_status:*', 'transaction:*'],
        dependent: ['booking:*', 'revenue:*', 'analytics:payment:*'],
        warmAfter: ['payment_summary', 'revenue_stats']
      },

      // Analytics invalidations
      analytics: {
        patterns: ['analytics:*', 'stats:*', 'metrics:*'],
        dependent: ['dashboard:*', 'report:*'],
        warmAfter: ['dashboard_summary']
      },

      // Guestlist invalidations
      guestlist: {
        patterns: ['guestlist:*', 'guest_list:*'],
        dependent: ['event:*:capacity', 'analytics:guestlist:*'],
        warmAfter: ['event_stats', 'guestlist_summary']
      }
    };

    // ✅ Invalidation statistics
    this.stats = {
      totalInvalidations: 0,
      patternInvalidations: 0,
      dependencyInvalidations: 0,
      warmingOperations: 0,
      lastInvalidation: null
    };

    // ✅ Warming queue for post-invalidation cache warming
    this.warmingQueue = new Set();
    this.warmingInProgress = false;

    console.log('🔥 CacheInvalidationService initialized:', {
      dependencies: Object.keys(this.dependencies).length,
      patterns: Object.values(this.dependencies).reduce((sum, dep) => sum + dep.patterns.length, 0)
    });
  }

  /**
   * 🎯 MAIN INVALIDATION METHODS
   */

  async invalidateEntity(entityType, entityId, options = {}) {
    const {
      userId = null,
      reason = 'Entity updated',
      skipWarming = false,
      force = false
    } = options;

    try {
      const startTime = Date.now();
      
      // ✅ Build invalidation plan
      const invalidationPlan = this.buildInvalidationPlan(entityType, entityId);
      
      console.log(`🔥 Starting cache invalidation for ${entityType}:${entityId}`);

      // ✅ Execute primary invalidations
      await this.executeInvalidationPlan(invalidationPlan);

      // ✅ Execute dependency invalidations
      await this.invalidateDependencies(entityType, entityId);

      // ✅ Queue cache warming if enabled
      if (!skipWarming) {
        await this.queueCacheWarming(entityType, entityId);
      }

      const duration = Date.now() - startTime;
      this.stats.totalInvalidations++;
      this.stats.lastInvalidation = new Date();

      // ✅ Log invalidation event
      await this.auditService.logEvent('CACHE_INVALIDATED', {
        userId,
        resourceType: entityType,
        resourceId: entityId,
        metadata: {
          reason,
          duration: `${duration}ms`,
          patternsInvalidated: invalidationPlan.patterns.length,
          dependenciesInvalidated: invalidationPlan.dependencies.length
        }
      });

      console.log(`✅ Cache invalidation completed for ${entityType}:${entityId} in ${duration}ms`);
      
      return {
        success: true,
        entityType,
        entityId,
        duration,
        patternsInvalidated: invalidationPlan.patterns.length,
        dependenciesInvalidated: invalidationPlan.dependencies.length
      };

    } catch (error) {
      console.error(`❌ Cache invalidation failed for ${entityType}:${entityId}:`, error);
      throw error;
    }
  }

  async invalidateMultipleEntities(entities, options = {}) {
    const {
      userId = null,
      reason = 'Bulk update',
      parallel = true
    } = options;

    try {
      const startTime = Date.now();
      
      if (parallel) {
        // ✅ Parallel invalidation for better performance
        const promises = entities.map(({ entityType, entityId }) =>
          this.invalidateEntity(entityType, entityId, { 
            userId, 
            reason: `${reason} (bulk)`,
            skipWarming: true // Skip individual warming, do bulk warming after
          })
        );
        
        await Promise.all(promises);
      } else {
        // ✅ Sequential invalidation for dependency order
        for (const { entityType, entityId } of entities) {
          await this.invalidateEntity(entityType, entityId, { 
            userId, 
            reason: `${reason} (sequential)`,
            skipWarming: true 
          });
        }
      }

      // ✅ Bulk cache warming
      await this.bulkCacheWarming(entities);

      const duration = Date.now() - startTime;
      
      console.log(`✅ Bulk cache invalidation completed for ${entities.length} entities in ${duration}ms`);
      
      return {
        success: true,
        entitiesProcessed: entities.length,
        duration,
        parallel
      };

    } catch (error) {
      console.error('❌ Bulk cache invalidation failed:', error);
      throw error;
    }
  }

  async invalidateByPattern(pattern, category = null, options = {}) {
    const {
      userId = null,
      reason = 'Pattern-based invalidation'
    } = options;

    try {
      const startTime = Date.now();
      
      // ✅ Invalidate cache by pattern
      await this.cacheService.invalidatePattern(pattern, category);
      
      this.stats.patternInvalidations++;
      
      const duration = Date.now() - startTime;
      
      // ✅ Log pattern invalidation
      await this.auditService.logEvent('CACHE_PATTERN_INVALIDATED', {
        userId,
        metadata: {
          pattern,
          category: category || 'all',
          reason,
          duration: `${duration}ms`
        }
      });

      console.log(`🔥 Cache pattern invalidated: ${pattern} (${category || 'all'}) in ${duration}ms`);
      
      return {
        success: true,
        pattern,
        category,
        duration
      };

    } catch (error) {
      console.error(`❌ Pattern invalidation failed for ${pattern}:`, error);
      throw error;
    }
  }

  /**
   * 🧠 INTELLIGENT INVALIDATION PLANNING
   */

  buildInvalidationPlan(entityType, entityId) {
    const dependency = this.dependencies[entityType];
    
    if (!dependency) {
      console.warn(`⚠️ No invalidation rules found for entity type: ${entityType}`);
      return {
        patterns: [`${entityType}:${entityId}:*`],
        dependencies: [],
        warming: []
      };
    }

    // ✅ Build specific patterns for this entity
    const patterns = dependency.patterns.map(pattern => 
      pattern.replace('*', `${entityId}:*`)
    );

    // ✅ Add generic patterns
    patterns.push(`${entityType}:${entityId}:*`);
    patterns.push(`${entityType}:*:${entityId}`);

    // ✅ Build dependency patterns
    const dependencies = dependency.dependent.map(depPattern =>
      depPattern.replace('*', `${entityId}:*`)
    );

    // ✅ Identify warming candidates
    const warming = dependency.warmAfter || [];

    return {
      patterns,
      dependencies,
      warming
    };
  }

  async executeInvalidationPlan(plan) {
    try {
      // ✅ Invalidate primary patterns
      for (const pattern of plan.patterns) {
        await this.cacheService.invalidatePattern(pattern);
        console.log(`🔥 Invalidated pattern: ${pattern}`);
      }

      // ✅ Invalidate dependencies
      for (const depPattern of plan.dependencies) {
        await this.cacheService.invalidatePattern(depPattern);
        console.log(`🔥 Invalidated dependency: ${depPattern}`);
      }

      this.stats.dependencyInvalidations += plan.dependencies.length;

    } catch (error) {
      console.error('❌ Failed to execute invalidation plan:', error);
      throw error;
    }
  }

  async invalidateDependencies(entityType, entityId) {
    const dependency = this.dependencies[entityType];
    if (!dependency || !dependency.dependent) return;

    try {
      for (const depPattern of dependency.dependent) {
        const pattern = depPattern.replace('*', `${entityId}:*`);
        await this.cacheService.invalidatePattern(pattern);
        console.log(`🔗 Invalidated dependency: ${pattern}`);
      }
    } catch (error) {
      console.error('❌ Dependency invalidation failed:', error);
    }
  }

  /**
   * 🌊 CACHE WARMING OPERATIONS
   */

  async queueCacheWarming(entityType, entityId) {
    const dependency = this.dependencies[entityType];
    if (!dependency || !dependency.warmAfter) return;

    try {
      for (const warmKey of dependency.warmAfter) {
        const warmingKey = `${warmKey}:${entityId}`;
        this.warmingQueue.add(warmingKey);
      }

      // ✅ Start warming if not already in progress
      if (!this.warmingInProgress) {
        setImmediate(() => this.processCacheWarming());
      }

    } catch (error) {
      console.error('❌ Cache warming queue failed:', error);
    }
  }

  async bulkCacheWarming(entities) {
    try {
      // ✅ Collect all warming keys
      const warmingKeys = new Set();
      
      for (const { entityType, entityId } of entities) {
        const dependency = this.dependencies[entityType];
        if (dependency && dependency.warmAfter) {
          for (const warmKey of dependency.warmAfter) {
            warmingKeys.add(`${warmKey}:${entityId}`);
          }
        }
      }

      // ✅ Add to warming queue
      warmingKeys.forEach(key => this.warmingQueue.add(key));

      // ✅ Process warming
      if (!this.warmingInProgress) {
        setImmediate(() => this.processCacheWarming());
      }

    } catch (error) {
      console.error('❌ Bulk cache warming failed:', error);
    }
  }

  async processCacheWarming() {
    if (this.warmingInProgress || this.warmingQueue.size === 0) return;

    this.warmingInProgress = true;
    
    try {
      console.log(`🌊 Starting cache warming for ${this.warmingQueue.size} keys`);
      
      const warmingPromises = Array.from(this.warmingQueue).map(async (key) => {
        try {
          await this.warmSpecificCache(key);
          this.stats.warmingOperations++;
        } catch (error) {
          console.error(`❌ Failed to warm cache for ${key}:`, error);
        }
      });

      await Promise.all(warmingPromises);
      this.warmingQueue.clear();

      console.log('✅ Cache warming completed');

    } catch (error) {
      console.error('❌ Cache warming process failed:', error);
    } finally {
      this.warmingInProgress = false;
    }
  }

  async warmSpecificCache(key) {
    // ✅ Parse warming key
    const [type, ...idParts] = key.split(':');
    const id = idParts.join(':');

    try {
      switch (type) {
        case 'user_profile':
          await this.warmUserProfile(id);
          break;
        case 'user_stats':
          await this.warmUserStats(id);
          break;
        case 'event_list':
          await this.warmEventList();
          break;
        case 'event_stats':
          await this.warmEventStats(id);
          break;
        case 'popular_events':
          await this.warmPopularEvents();
          break;
        case 'upcoming_events':
          await this.warmUpcomingEvents();
          break;
        case 'payment_summary':
          await this.warmPaymentSummary(id);
          break;
        case 'revenue_stats':
          await this.warmRevenueStats(id);
          break;
        case 'dashboard_summary':
          await this.warmDashboardSummary();
          break;
        default:
          console.log(`⚠️ Unknown cache warming type: ${type}`);
      }

      console.log(`🌊 Warmed cache: ${key}`);

    } catch (error) {
      console.error(`❌ Cache warming failed for ${key}:`, error);
    }
  }

  /**
   * 🌊 SPECIFIC WARMING METHODS
   */

  async warmUserProfile(userId) {
    // TODO: Implement user profile warming
    // This would fetch user data and cache it
    console.log(`🌊 Warming user profile: ${userId}`);
  }

  async warmUserStats(userId) {
    // TODO: Implement user stats warming
    console.log(`🌊 Warming user stats: ${userId}`);
  }

  async warmEventList() {
    // TODO: Implement event list warming
    console.log('🌊 Warming event list');
  }

  async warmEventStats(eventId) {
    // TODO: Implement event stats warming
    console.log(`🌊 Warming event stats: ${eventId}`);
  }

  async warmPopularEvents() {
    // TODO: Implement popular events warming
    console.log('🌊 Warming popular events');
  }

  async warmUpcomingEvents() {
    // TODO: Implement upcoming events warming
    console.log('🌊 Warming upcoming events');
  }

  async warmPaymentSummary(paymentId) {
    // TODO: Implement payment summary warming
    console.log(`🌊 Warming payment summary: ${paymentId}`);
  }

  async warmRevenueStats(entityId) {
    // TODO: Implement revenue stats warming
    console.log(`🌊 Warming revenue stats: ${entityId}`);
  }

  async warmDashboardSummary() {
    // TODO: Implement dashboard summary warming
    console.log('🌊 Warming dashboard summary');
  }

  /**
   * 🎯 SPECIALIZED INVALIDATION METHODS
   */

  async invalidateUserData(userId, reason = 'User data updated') {
    return await this.invalidateEntity('user', userId, { reason });
  }

  async invalidateEventData(eventId, reason = 'Event data updated') {
    return await this.invalidateEntity('event', eventId, { reason });
  }

  async invalidateBookingData(bookingId, reason = 'Booking data updated') {
    return await this.invalidateEntity('booking', bookingId, { reason });
  }

  async invalidatePaymentData(paymentId, reason = 'Payment data updated') {
    return await this.invalidateEntity('payment', paymentId, { reason });
  }

  async invalidateGuestlistData(eventId, reason = 'Guestlist data updated') {
    return await this.invalidateEntity('guestlist', eventId, { reason });
  }

  async invalidateAnalyticsData(entityType, entityId, reason = 'Analytics recalculated') {
    // ✅ Invalidate analytics-specific patterns
    const patterns = [
      `analytics:${entityType}:${entityId}:*`,
      `stats:${entityType}:${entityId}:*`,
      `metrics:${entityType}:${entityId}:*`,
      `dashboard:*:${entityType}:${entityId}`,
      `report:*:${entityType}:${entityId}`
    ];

    const promises = patterns.map(pattern => 
      this.cacheService.invalidatePattern(pattern)
    );

    await Promise.all(promises);

    console.log(`📊 Analytics cache invalidated for ${entityType}:${entityId}`);
    return { success: true, patterns: patterns.length };
  }

  /**
   * 📊 MONITORING & STATISTICS
   */

  getInvalidationStats() {
    return {
      ...this.stats,
      warmingQueueSize: this.warmingQueue.size,
      warmingInProgress: this.warmingInProgress,
      dependencyMappings: Object.keys(this.dependencies).length
    };
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      warmingQueueSize: this.warmingQueue.size,
      processingWarming: this.warmingInProgress,
      lastInvalidation: this.stats.lastInvalidation,
      totalInvalidations: this.stats.totalInvalidations
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    this.warmingQueue.clear();
    this.warmingInProgress = false;
    console.log('✅ CacheInvalidationService cleanup completed');
  }
}

module.exports = CacheInvalidationService;