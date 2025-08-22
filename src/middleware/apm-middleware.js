const apmService = require('../services/monitoring/APMService');

/**
 * 📊 ENTERPRISE APM MIDDLEWARE FOR 100K+ USERS
 * 
 * Features:
 * - Automatic request/response tracking
 * - Database query monitoring
 * - Error tracking with context
 * - Performance alerts
 * - Business metrics integration
 */

/**
 * ✅ PRODUCTION: Main APM middleware for request tracking
 */
function apmMiddleware(req, res, next) {
  const startTime = Date.now();
  const originalUrl = req.originalUrl;
  const method = req.method;
  
  // Create sanitized route (remove IDs for grouping)
  const sanitizedRoute = sanitizeRoute(originalUrl);
  
  // Override res.end to capture response time and status
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const userId = req.user?.id || null;
    
    // Track the request
    apmService.trackRequest(method, sanitizedRoute, duration, statusCode, userId);
    
    // Track business metrics for important endpoints
    trackBusinessMetrics(req, res, duration);
    
    // Call original end method
    originalEnd.apply(this, args);
  };
  
  // Track request start
  req.apmStartTime = startTime;
  req.apmRoute = sanitizedRoute;
  
  next();
}

/**
 * ✅ ENTERPRISE: Database query monitoring middleware
 */
function databaseMonitoringMiddleware() {
  // This will be used to wrap Prisma operations
  return {
    query: async (params, next) => {
      const startTime = Date.now();
      const { model, action } = params;
      
      try {
        const result = await next(params);
        const duration = Date.now() - startTime;
        
        // Extract record count if possible
        let recordCount = 1;
        if (Array.isArray(result)) {
          recordCount = result.length;
        } else if (result && typeof result.count === 'number') {
          recordCount = result.count;
        }
        
        // Track database operation
        apmService.trackDatabaseQuery(action, model, duration, recordCount);
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        apmService.trackDatabaseQuery(action, model, duration, 0);
        
        // Track database error
        apmService.trackError(error, {
          type: 'DATABASE_ERROR',
          model,
          action,
          duration,
        });
        
        throw error;
      }
    }
  };
}

/**
 * ✅ PRODUCTION: Error tracking middleware
 */
function errorTrackingMiddleware(error, req, res, next) {
  // Extract relevant context
  const context = {
    method: req.method,
    url: req.originalUrl,
    route: req.apmRoute,
    userId: req.user?.id,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    headers: req.headers,
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query,
    params: req.params,
    statusCode: res.statusCode,
    duration: req.apmStartTime ? Date.now() - req.apmStartTime : undefined,
  };
  
  // Track the error
  apmService.trackError(error, context);
  
  // Continue with error handling
  next(error);
}

/**
 * ✅ ENTERPRISE: Cache monitoring integration
 */
function cacheMonitoringWrapper(cacheService) {
  const originalGet = cacheService.get;
  const originalSet = cacheService.set;
  
  cacheService.get = async function(key) {
    const startTime = Date.now();
    
    try {
      const result = await originalGet.call(this, key);
      const duration = Date.now() - startTime;
      const hit = result !== null;
      
      apmService.trackCacheOperation('GET', key, hit, duration);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      apmService.trackCacheOperation('GET', key, false, duration);
      throw error;
    }
  };
  
  cacheService.set = async function(key, value, ttl) {
    const startTime = Date.now();
    
    try {
      const result = await originalSet.call(this, key, value, ttl);
      const duration = Date.now() - startTime;
      
      apmService.trackCacheOperation('SET', key, true, duration);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      apmService.trackCacheOperation('SET', key, false, duration);
      throw error;
    }
  };
  
  return cacheService;
}

/**
 * ✅ PRODUCTION: Business metrics tracking for important operations
 */
function trackBusinessMetrics(req, res, duration) {
  const route = req.apmRoute;
  const method = req.method;
  const statusCode = res.statusCode;
  
  // Track booking-related metrics
  if (route.includes('/bookings') && method === 'POST' && statusCode === 201) {
    apmService.trackBusinessMetric('booking_created', 1, {
      userId: req.user?.id,
      eventId: req.body?.eventId,
      duration,
    });
  }
  
  // Track payment-related metrics
  if (route.includes('/payments') && method === 'POST' && statusCode === 200) {
    apmService.trackBusinessMetric('payment_processed', 1, {
      userId: req.user?.id,
      paymentId: req.params?.paymentId,
      duration,
    });
  }
  
  // Track user registration metrics
  if (route.includes('/auth/register') && method === 'POST' && statusCode === 201) {
    apmService.trackBusinessMetric('user_registered', 1, {
      duration,
    });
  }
  
  // Track login metrics
  if (route.includes('/auth/login') && method === 'POST' && statusCode === 200) {
    apmService.trackBusinessMetric('user_login', 1, {
      duration,
    });
  }
  
  // Track event creation metrics
  if (route.includes('/events') && method === 'POST' && statusCode === 201) {
    apmService.trackBusinessMetric('event_created', 1, {
      organizerId: req.user?.id,
      duration,
    });
  }
  
  // Track follow metrics
  if (route.includes('/follow') && method === 'POST' && statusCode === 200) {
    apmService.trackBusinessMetric('user_followed', 1, {
      followerId: req.user?.id,
      followingId: req.params?.id,
      duration,
    });
  }
  
  // Track API response times by category
  if (statusCode < 400) {
    const category = categorizeRoute(route);
    apmService.trackBusinessMetric(`response_time_${category}`, duration, {
      route,
      method,
      statusCode,
    });
  }
}

/**
 * ✅ ENTERPRISE: Route sanitization for better grouping
 */
function sanitizeRoute(url) {
  // Remove query parameters
  const baseUrl = url.split('?')[0];
  
  // Replace UUIDs and IDs with placeholders
  return baseUrl
    .replace(/\/[a-f0-9-]{36}/g, '/:id') // UUIDs
    .replace(/\/[0-9]+/g, '/:id') // Numeric IDs
    .replace(/\/cl[a-z0-9]+/g, '/:id') // Prisma CUID
    .replace(/\/[a-zA-Z0-9_-]{10,}/g, '/:id') // Other long IDs
    .replace(/\/+/g, '/') // Multiple slashes
    .replace(/\/$/, '') || '/'; // Trailing slash
}

/**
 * ✅ PRODUCTION: Route categorization for metrics
 */
function categorizeRoute(route) {
  if (route.includes('/auth')) return 'auth';
  if (route.includes('/users')) return 'users';
  if (route.includes('/events')) return 'events';
  if (route.includes('/bookings')) return 'bookings';
  if (route.includes('/payments')) return 'payments';
  if (route.includes('/access-tiers')) return 'access_tiers';
  if (route.includes('/search')) return 'search';
  if (route.includes('/notifications')) return 'notifications';
  if (route.includes('/health')) return 'health';
  if (route.includes('/monitoring')) return 'monitoring';
  
  return 'other';
}

/**
 * ✅ ENTERPRISE: Performance monitoring dashboard endpoint
 */
function createPerformanceDashboard() {
  return (req, res) => {
    try {
      const dashboardData = apmService.getDashboardData();
      
      res.json({
        success: true,
        data: dashboardData,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ APM Dashboard Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate dashboard data',
      });
    }
  };
}

/**
 * ✅ PRODUCTION: Health check with APM integration
 */
function createHealthCheckWithAPM() {
  return async (req, res) => {
    const startTime = Date.now();
    
    try {
      // Basic health checks
      const systemResources = apmService.trackSystemResources();
      const uptime = apmService.getUptime();
      const alerts = apmService.getActiveAlerts();
      
      // Determine health status
      const isHealthy = systemResources.memory.heapUsedPercent < 90 && 
                       alerts.filter(a => a.severity === 'HIGH').length === 0;
      
      const healthData = {
        status: isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime,
        memory: {
          heapUsed: `${(systemResources.memory.heapUsed / 1024 / 1024).toFixed(1)}MB`,
          heapUsedPercent: `${systemResources.memory.heapUsedPercent.toFixed(1)}%`,
        },
        alerts: alerts.length,
        highSeverityAlerts: alerts.filter(a => a.severity === 'HIGH').length,
      };
      
      const duration = Date.now() - startTime;
      apmService.trackBusinessMetric('health_check_duration', duration);
      
      res.status(isHealthy ? 200 : 503).json({
        success: true,
        data: healthData,
      });
    } catch (error) {
      apmService.trackError(error, { endpoint: '/health' });
      
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: 'Health check failed',
      });
    }
  };
}

/**
 * ✅ ENTERPRISE: Metrics export endpoint for external monitoring
 */
function createMetricsExport() {
  return (req, res) => {
    try {
      const metrics = apmService.exportMetrics();
      
      res.json({
        success: true,
        data: metrics,
        exportedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Metrics Export Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export metrics',
      });
    }
  };
}

module.exports = {
  apmMiddleware,
  databaseMonitoringMiddleware,
  errorTrackingMiddleware,
  cacheMonitoringWrapper,
  createPerformanceDashboard,
  createHealthCheckWithAPM,
  createMetricsExport,
  sanitizeRoute,
  categorizeRoute,
  apmService, // Export for direct access
};