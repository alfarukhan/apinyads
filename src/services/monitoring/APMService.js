/**
 * 📊 ENTERPRISE APM MONITORING SERVICE FOR 100K+ USERS
 * 
 * Features:
 * - Real-time performance metrics
 * - Database query monitoring
 * - API endpoint analytics
 * - Memory and CPU tracking
 * - Error rate monitoring
 * - Custom business metrics
 * - Alert system integration
 */

class APMService {
  constructor() {
    this.metrics = {
      requests: new Map(),
      errors: new Map(),
      performance: new Map(),
      database: new Map(),
      cache: new Map(),
      business: new Map(),
    };
    
    this.startTime = Date.now();
    this.alertThresholds = {
      errorRate: 0.05, // 5% error rate threshold
      responseTime: 1000, // 1 second response time threshold
      memoryUsage: 0.9, // 90% memory usage threshold
      dbQueryTime: 500, // 500ms database query threshold
      cacheHitRate: 0.8, // 80% cache hit rate threshold
    };
    
    // ✅ PRODUCTION: Start background monitoring
    this.startBackgroundMonitoring();
  }

  /**
   * ✅ ENTERPRISE: Request performance tracking
   */
  trackRequest(method, route, duration, statusCode, userId = null) {
    const key = `${method}:${route}`;
    const timestamp = Date.now();
    
    if (!this.metrics.requests.has(key)) {
      this.metrics.requests.set(key, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errors: 0,
        errorRate: 0,
        recentRequests: [],
      });
    }
    
    const metric = this.metrics.requests.get(key);
    metric.count++;
    metric.totalDuration += duration;
    metric.avgDuration = metric.totalDuration / metric.count;
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);
    
    if (statusCode >= 400) {
      metric.errors++;
      metric.errorRate = metric.errors / metric.count;
    }
    
    // Keep recent requests for trend analysis (last 100)
    metric.recentRequests.push({
      timestamp,
      duration,
      statusCode,
      userId,
    });
    
    if (metric.recentRequests.length > 100) {
      metric.recentRequests.shift();
    }
    
    // ✅ ENTERPRISE: Check for performance alerts
    this.checkPerformanceAlerts(key, metric, duration);
    
    console.log(`📊 APM: ${method} ${route} - ${duration}ms (${statusCode})`);
  }

  /**
   * ✅ PERFORMANCE: Get appropriate slow query threshold based on operation type
   */
  getSlowQueryThreshold(operation, table) {
    // Higher thresholds for cleanup operations
    const cleanupTables = ['PaymentLock', 'WebhookLog', 'StockReservation', 'Booking', 'AuditLog'];
    const cleanupOperations = ['deleteMany', 'updateMany', 'count', 'findMany'];
    
    if (this.isCleanupOperation(operation, table)) {
      return 2000; // 2 seconds for cleanup operations
    }
    
    // Regular operations
    return this.alertThresholds.dbQueryTime; // 500ms
  }

  /**
   * ✅ PERFORMANCE: Check if operation is a cleanup operation
   */
  isCleanupOperation(operation, table) {
    const cleanupTables = ['PaymentLock', 'WebhookLog', 'StockReservation', 'Booking', 'AuditLog'];
    const cleanupOperations = ['deleteMany', 'updateMany', 'count'];
    
    // Large findMany operations on cleanup tables are also considered cleanup
    if (operation === 'findMany' && cleanupTables.includes(table)) {
      return true;
    }
    
    return cleanupOperations.includes(operation) && cleanupTables.includes(table);
  }

  /**
   * ✅ PRODUCTION: Database query performance tracking
   */
  trackDatabaseQuery(operation, table, duration, recordCount = 1) {
    const key = `db:${operation}:${table}`;
    const timestamp = Date.now();
    
    if (!this.metrics.database.has(key)) {
      this.metrics.database.set(key, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        totalRecords: 0,
        slowQueries: 0,
        recentQueries: [],
      });
    }
    
    const metric = this.metrics.database.get(key);
    metric.count++;
    metric.totalDuration += duration;
    metric.avgDuration = metric.totalDuration / metric.count;
    metric.minDuration = Math.min(metric.minDuration, duration);
    metric.maxDuration = Math.max(metric.maxDuration, duration);
    metric.totalRecords += recordCount;
    
    // ✅ PERFORMANCE: Different thresholds for different operation types
    const slowQueryThreshold = this.getSlowQueryThreshold(operation, table);
    
    if (duration > slowQueryThreshold) {
      metric.slowQueries++;
      
      // Only warn for non-cleanup operations or extremely slow cleanup operations
      if (!this.isCleanupOperation(operation, table) || duration > slowQueryThreshold * 3) {
        console.warn(`⚠️ APM: Slow query detected - ${key}: ${duration}ms`);
      } else {
        console.log(`📊 APM: Cleanup operation - ${key}: ${duration}ms (expected)`);
      }
    }
    
    // Keep recent queries for analysis
    metric.recentQueries.push({
      timestamp,
      duration,
      recordCount,
    });
    
    if (metric.recentQueries.length > 50) {
      metric.recentQueries.shift();
    }
  }

  /**
   * ✅ ENTERPRISE: Cache performance tracking
   */
  trackCacheOperation(operation, key, hit = false, duration = 0) {
    const cacheKey = `cache:${operation}`;
    
    if (!this.metrics.cache.has(cacheKey)) {
      this.metrics.cache.set(cacheKey, {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalDuration: 0,
        avgDuration: 0,
        recentOperations: [],
      });
    }
    
    const metric = this.metrics.cache.get(cacheKey);
    
    if (hit) {
      metric.hits++;
    } else {
      metric.misses++;
    }
    
    const totalOps = metric.hits + metric.misses;
    metric.hitRate = totalOps > 0 ? metric.hits / totalOps : 0;
    
    if (duration > 0) {
      metric.totalDuration += duration;
      metric.avgDuration = metric.totalDuration / totalOps;
    }
    
    // Track recent operations
    metric.recentOperations.push({
      timestamp: Date.now(),
      hit,
      duration,
      key: key.substring(0, 50), // Truncate long keys
    });
    
    if (metric.recentOperations.length > 100) {
      metric.recentOperations.shift();
    }
    
    // Alert on low cache hit rate
    if (totalOps > 100 && metric.hitRate < this.alertThresholds.cacheHitRate) {
      console.warn(`⚠️ APM: Low cache hit rate - ${cacheKey}: ${(metric.hitRate * 100).toFixed(1)}%`);
    }
  }

  /**
   * ✅ ENTERPRISE: Business metrics tracking
   */
  trackBusinessMetric(name, value, tags = {}) {
    const key = `business:${name}`;
    const timestamp = Date.now();
    
    if (!this.metrics.business.has(key)) {
      this.metrics.business.set(key, {
        count: 0,
        total: 0,
        average: 0,
        min: Infinity,
        max: 0,
        recentValues: [],
      });
    }
    
    const metric = this.metrics.business.get(key);
    metric.count++;
    metric.total += value;
    metric.average = metric.total / metric.count;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    
    metric.recentValues.push({
      timestamp,
      value,
      tags,
    });
    
    if (metric.recentValues.length > 1000) {
      metric.recentValues.shift();
    }
    
    console.log(`📈 BUSINESS METRIC: ${name} = ${value}`, tags);
  }

  /**
   * ✅ PRODUCTION: Error tracking with context
   */
  trackError(error, context = {}) {
    const errorKey = error.name || 'Unknown';
    const timestamp = Date.now();
    
    if (!this.metrics.errors.has(errorKey)) {
      this.metrics.errors.set(errorKey, {
        count: 0,
        recentErrors: [],
        firstSeen: timestamp,
        lastSeen: timestamp,
      });
    }
    
    const metric = this.metrics.errors.get(errorKey);
    metric.count++;
    metric.lastSeen = timestamp;
    
    metric.recentErrors.push({
      timestamp,
      message: error.message,
      stack: error.stack,
      context,
    });
    
    if (metric.recentErrors.length > 50) {
      metric.recentErrors.shift();
    }
    
    console.error(`❌ APM ERROR: ${errorKey}`, {
      message: error.message,
      context,
      count: metric.count,
    });
  }

  /**
   * ✅ ENTERPRISE: System resource monitoring
   */
  trackSystemResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    const systemMetrics = {
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        heapUsedPercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
    
    // Alert on high memory usage
    if (systemMetrics.memory.heapUsedPercent > this.alertThresholds.memoryUsage * 100) {
      console.warn(`⚠️ APM: High memory usage: ${systemMetrics.memory.heapUsedPercent.toFixed(1)}%`);
    }
    
    return systemMetrics;
  }

  /**
   * ✅ ENTERPRISE: Performance alert system
   */
  checkPerformanceAlerts(route, metric, currentDuration) {
    // Error rate alerts
    if (metric.errorRate > this.alertThresholds.errorRate) {
      console.warn(`🚨 APM ALERT: High error rate on ${route}: ${(metric.errorRate * 100).toFixed(1)}%`);
    }
    
    // Response time alerts
    if (currentDuration > this.alertThresholds.responseTime) {
      console.warn(`🚨 APM ALERT: Slow response on ${route}: ${currentDuration}ms`);
    }
    
    // Average response time trend alert
    if (metric.avgDuration > this.alertThresholds.responseTime) {
      console.warn(`🚨 APM ALERT: Average response time degraded on ${route}: ${metric.avgDuration.toFixed(0)}ms`);
    }
  }

  /**
   * ✅ PRODUCTION: Get comprehensive performance dashboard data
   */
  getDashboardData() {
    const systemResources = this.trackSystemResources();
    
    // Calculate aggregated metrics
    const totalRequests = Array.from(this.metrics.requests.values())
      .reduce((sum, metric) => sum + metric.count, 0);
    
    const totalErrors = Array.from(this.metrics.errors.values())
      .reduce((sum, metric) => sum + metric.count, 0);
    
    const overallErrorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
    
    const avgResponseTime = Array.from(this.metrics.requests.values())
      .reduce((sum, metric, _, arr) => sum + metric.avgDuration / arr.length, 0);

    const topSlowEndpoints = Array.from(this.metrics.requests.entries())
      .sort(([,a], [,b]) => b.avgDuration - a.avgDuration)
      .slice(0, 10)
      .map(([route, metric]) => ({
        route,
        avgDuration: Math.round(metric.avgDuration),
        count: metric.count,
        errorRate: (metric.errorRate * 100).toFixed(1),
      }));

    const databaseStats = Array.from(this.metrics.database.entries())
      .map(([operation, metric]) => ({
        operation,
        avgDuration: Math.round(metric.avgDuration),
        count: metric.count,
        slowQueries: metric.slowQueries,
      }));

    const cacheStats = Array.from(this.metrics.cache.entries())
      .map(([operation, metric]) => ({
        operation,
        hitRate: (metric.hitRate * 100).toFixed(1),
        avgDuration: Math.round(metric.avgDuration),
      }));

    return {
      system: systemResources,
      overview: {
        totalRequests,
        totalErrors,
        errorRate: (overallErrorRate * 100).toFixed(2),
        avgResponseTime: Math.round(avgResponseTime),
        uptime: this.getUptime(),
      },
      endpoints: topSlowEndpoints,
      database: databaseStats,
      cache: cacheStats,
      business: this.getBusinessMetricsSummary(),
      alerts: this.getActiveAlerts(),
    };
  }

  /**
   * ✅ ENTERPRISE: Business metrics summary
   */
  getBusinessMetricsSummary() {
    return Array.from(this.metrics.business.entries())
      .map(([name, metric]) => ({
        name: name.replace('business:', ''),
        count: metric.count,
        average: Math.round(metric.average * 100) / 100,
        min: metric.min,
        max: metric.max,
        recent: metric.recentValues.slice(-10).map(v => v.value),
      }));
  }

  /**
   * ✅ PRODUCTION: Active alerts summary
   */
  getActiveAlerts() {
    const alerts = [];
    
    // Check for active performance issues
    this.metrics.requests.forEach((metric, route) => {
      if (metric.errorRate > this.alertThresholds.errorRate) {
        alerts.push({
          type: 'ERROR_RATE',
          route,
          value: (metric.errorRate * 100).toFixed(1),
          threshold: (this.alertThresholds.errorRate * 100).toFixed(1),
          severity: 'HIGH',
        });
      }
      
      if (metric.avgDuration > this.alertThresholds.responseTime) {
        alerts.push({
          type: 'RESPONSE_TIME',
          route,
          value: Math.round(metric.avgDuration),
          threshold: this.alertThresholds.responseTime,
          severity: 'MEDIUM',
        });
      }
    });
    
    return alerts;
  }

  /**
   * ✅ PRODUCTION: Application uptime tracking
   */
  getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * ✅ ENTERPRISE: Background monitoring jobs
   */
  startBackgroundMonitoring() {
    // System resource monitoring every 30 seconds
    setInterval(() => {
      this.trackSystemResources();
    }, 30000);
    
    // Cleanup old metrics every 5 minutes
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 5 * 60 * 1000);
    
    console.log('📊 APM: Background monitoring started');
  }

  /**
   * ✅ PRODUCTION: Cleanup old metrics to prevent memory leaks
   */
  cleanupOldMetrics() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    // Cleanup request metrics
    this.metrics.requests.forEach(metric => {
      metric.recentRequests = metric.recentRequests.filter(
        req => req.timestamp > cutoffTime
      );
    });
    
    // Cleanup database metrics
    this.metrics.database.forEach(metric => {
      metric.recentQueries = metric.recentQueries.filter(
        query => query.timestamp > cutoffTime
      );
    });
    
    // Cleanup cache metrics
    this.metrics.cache.forEach(metric => {
      metric.recentOperations = metric.recentOperations.filter(
        op => op.timestamp > cutoffTime
      );
    });
    
    // Cleanup business metrics
    this.metrics.business.forEach(metric => {
      metric.recentValues = metric.recentValues.filter(
        val => val.timestamp > cutoffTime
      );
    });
    
    console.log('🧹 APM: Old metrics cleaned up');
  }

  /**
   * ✅ ENTERPRISE: Export metrics for external monitoring systems
   */
  exportMetrics() {
    return {
      timestamp: Date.now(),
      requests: Object.fromEntries(this.metrics.requests),
      errors: Object.fromEntries(this.metrics.errors),
      database: Object.fromEntries(this.metrics.database),
      cache: Object.fromEntries(this.metrics.cache),
      business: Object.fromEntries(this.metrics.business),
      system: this.trackSystemResources(),
    };
  }
}

// ✅ PRODUCTION: Export singleton instance
const apmService = new APMService();

module.exports = apmService;