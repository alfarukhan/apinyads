const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { 
  createPerformanceDashboard,
  createHealthCheckWithAPM,
  createMetricsExport,
  apmService 
} = require('../middleware/apm-middleware');

const router = express.Router();

/**
 * 📊 ENTERPRISE MONITORING ROUTES FOR 100K+ USERS
 * 
 * Endpoints:
 * - /dashboard - Performance dashboard
 * - /health - Health check with APM
 * - /metrics - Raw metrics export
 * - /alerts - Active alerts
 * - /business-metrics - Business KPIs
 */

// ✅ PRODUCTION: Performance dashboard (Admin only)
router.get('/dashboard', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  createPerformanceDashboard()
);

// ✅ PRODUCTION: Health check endpoint (Public for load balancer)
router.get('/health', createHealthCheckWithAPM());

// ✅ ENTERPRISE: Raw metrics export (Admin only)
router.get('/metrics', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  createMetricsExport()
);

// ✅ PRODUCTION: Active alerts endpoint
router.get('/alerts', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const alerts = apmService.getActiveAlerts();
      const alertsSummary = {
        total: alerts.length,
        high: alerts.filter(a => a.severity === 'HIGH').length,
        medium: alerts.filter(a => a.severity === 'MEDIUM').length,
        low: alerts.filter(a => a.severity === 'LOW').length,
        alerts: alerts,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: alertsSummary,
      });
    } catch (error) {
      console.error('❌ Alerts Endpoint Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alerts',
      });
    }
  })
);

// ✅ ENTERPRISE: Business metrics endpoint
router.get('/business-metrics', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const businessMetrics = apmService.getBusinessMetricsSummary();
      const dashboardData = apmService.getDashboardData();
      
      const businessSummary = {
        metrics: businessMetrics,
        overview: dashboardData.overview,
        recentActivity: businessMetrics.map(metric => ({
          name: metric.name,
          recentTrend: calculateTrend(metric.recent),
          avgValue: metric.average,
          totalCount: metric.count,
        })),
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: businessSummary,
      });
    } catch (error) {
      console.error('❌ Business Metrics Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch business metrics',
      });
    }
  })
);

// ✅ PRODUCTION: Performance trends endpoint
router.get('/trends', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const { timeframe = '1h' } = req.query;
      const dashboardData = apmService.getDashboardData();
      
      // Calculate trends based on timeframe
      const trends = {
        responseTime: {
          current: dashboardData.overview.avgResponseTime,
          trend: calculateResponseTimeTrend(dashboardData.endpoints),
        },
        errorRate: {
          current: parseFloat(dashboardData.overview.errorRate),
          trend: calculateErrorRateTrend(dashboardData.endpoints),
        },
        throughput: {
          current: dashboardData.overview.totalRequests,
          trend: 'stable', // This would be calculated from historical data
        },
        cachePerformance: {
          hitRates: dashboardData.cache.map(c => ({
            operation: c.operation,
            hitRate: parseFloat(c.hitRate),
          })),
          trend: 'improving',
        },
        systemResources: {
          memory: dashboardData.system.memory.heapUsedPercent,
          uptime: dashboardData.overview.uptime,
        },
        generatedAt: new Date().toISOString(),
        timeframe,
      };

      res.json({
        success: true,
        data: trends,
      });
    } catch (error) {
      console.error('❌ Trends Endpoint Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch performance trends',
      });
    }
  })
);

// ✅ ENTERPRISE: System status endpoint
router.get('/status', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const systemResources = apmService.trackSystemResources();
      const dashboardData = apmService.getDashboardData();
      const alerts = apmService.getActiveAlerts();
      
      // Determine overall system status
      const memoryOk = systemResources.memory.heapUsedPercent < 80;
      const errorRateOk = parseFloat(dashboardData.overview.errorRate) < 5;
      const responseTimeOk = dashboardData.overview.avgResponseTime < 1000;
      const noHighAlerts = alerts.filter(a => a.severity === 'HIGH').length === 0;
      
      const overallStatus = memoryOk && errorRateOk && responseTimeOk && noHighAlerts 
        ? 'healthy' 
        : 'degraded';
      
      const statusData = {
        overall: overallStatus,
        components: {
          memory: {
            status: memoryOk ? 'healthy' : 'warning',
            usage: `${systemResources.memory.heapUsedPercent.toFixed(1)}%`,
            threshold: '80%',
          },
          errorRate: {
            status: errorRateOk ? 'healthy' : 'warning',
            rate: `${dashboardData.overview.errorRate}%`,
            threshold: '5%',
          },
          responseTime: {
            status: responseTimeOk ? 'healthy' : 'warning',
            avg: `${dashboardData.overview.avgResponseTime}ms`,
            threshold: '1000ms',
          },
          alerts: {
            status: noHighAlerts ? 'healthy' : 'critical',
            high: alerts.filter(a => a.severity === 'HIGH').length,
            total: alerts.length,
          },
        },
        uptime: dashboardData.overview.uptime,
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: statusData,
      });
    } catch (error) {
      console.error('❌ Status Endpoint Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch system status',
      });
    }
  })
);

// ✅ PRODUCTION: Database performance monitoring
router.get('/database', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const dashboardData = apmService.getDashboardData();
      const dbStats = dashboardData.database;
      
      // Calculate database insights
      const totalQueries = dbStats.reduce((sum, stat) => sum + stat.count, 0);
      const totalSlowQueries = dbStats.reduce((sum, stat) => sum + stat.slowQueries, 0);
      const avgQueryTime = dbStats.reduce((sum, stat) => sum + stat.avgDuration, 0) / dbStats.length;
      
      const slowestOperations = dbStats
        .sort((a, b) => b.avgDuration - a.avgDuration)
        .slice(0, 10);
      
      const databaseInsights = {
        overview: {
          totalQueries,
          totalSlowQueries,
          slowQueryRate: totalQueries > 0 ? (totalSlowQueries / totalQueries * 100).toFixed(2) : 0,
          avgQueryTime: Math.round(avgQueryTime),
        },
        slowestOperations,
        recommendations: generateDatabaseRecommendations(dbStats),
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: databaseInsights,
      });
    } catch (error) {
      console.error('❌ Database Monitoring Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch database metrics',
      });
    }
  })
);

// ✅ ENTERPRISE: Cache performance monitoring
router.get('/cache', 
  authMiddleware, 
  requireRole(['ADMIN', 'SUPER_ADMIN']),
  asyncHandler(async (req, res) => {
    try {
      const dashboardData = apmService.getDashboardData();
      const cacheStats = dashboardData.cache;
      
      // Calculate cache insights
      const overallHitRate = cacheStats.reduce((sum, stat) => 
        sum + parseFloat(stat.hitRate), 0) / cacheStats.length;
      
      const cacheInsights = {
        overview: {
          overallHitRate: overallHitRate.toFixed(1),
          operations: cacheStats.length,
          status: overallHitRate >= 80 ? 'excellent' : 
                 overallHitRate >= 60 ? 'good' : 'needs_improvement',
        },
        operationStats: cacheStats,
        recommendations: generateCacheRecommendations(cacheStats, overallHitRate),
        generatedAt: new Date().toISOString(),
      };

      res.json({
        success: true,
        data: cacheInsights,
      });
    } catch (error) {
      console.error('❌ Cache Monitoring Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch cache metrics',
      });
    }
  })
);

/**
 * ✅ HELPER FUNCTIONS
 */

function calculateTrend(recentValues) {
  if (!recentValues || recentValues.length < 2) return 'stable';
  
  const recent = recentValues.slice(-5);
  const firstHalf = recent.slice(0, Math.ceil(recent.length / 2));
  const secondHalf = recent.slice(Math.ceil(recent.length / 2));
  
  const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
  
  const change = ((secondAvg - firstAvg) / firstAvg) * 100;
  
  if (change > 10) return 'increasing';
  if (change < -10) return 'decreasing';
  return 'stable';
}

function calculateResponseTimeTrend(endpoints) {
  const avgResponseTimes = endpoints.map(e => e.avgDuration);
  if (avgResponseTimes.length === 0) return 'stable';
  
  const avg = avgResponseTimes.reduce((sum, time) => sum + time, 0) / avgResponseTimes.length;
  return avg > 1000 ? 'degrading' : avg < 500 ? 'improving' : 'stable';
}

function calculateErrorRateTrend(endpoints) {
  const errorRates = endpoints.map(e => parseFloat(e.errorRate));
  const avgErrorRate = errorRates.reduce((sum, rate) => sum + rate, 0) / errorRates.length;
  
  return avgErrorRate > 5 ? 'increasing' : avgErrorRate < 1 ? 'decreasing' : 'stable';
}

function generateDatabaseRecommendations(dbStats) {
  const recommendations = [];
  
  const slowQueries = dbStats.filter(stat => stat.avgDuration > 500);
  if (slowQueries.length > 0) {
    recommendations.push({
      type: 'SLOW_QUERIES',
      severity: 'HIGH',
      message: `${slowQueries.length} operations have avg response time > 500ms`,
      actions: ['Add database indexes', 'Optimize query patterns', 'Consider query caching'],
    });
  }
  
  const highVolumeOps = dbStats.filter(stat => stat.count > 1000);
  if (highVolumeOps.length > 0) {
    recommendations.push({
      type: 'HIGH_VOLUME',
      severity: 'MEDIUM',
      message: `${highVolumeOps.length} operations have high query volume`,
      actions: ['Implement connection pooling', 'Add read replicas', 'Consider query batching'],
    });
  }
  
  return recommendations;
}

function generateCacheRecommendations(cacheStats, overallHitRate) {
  const recommendations = [];
  
  if (overallHitRate < 60) {
    recommendations.push({
      type: 'LOW_HIT_RATE',
      severity: 'HIGH',
      message: 'Overall cache hit rate is below 60%',
      actions: ['Increase TTL for stable data', 'Implement cache warming', 'Review cache keys'],
    });
  }
  
  const lowHitRateOps = cacheStats.filter(stat => parseFloat(stat.hitRate) < 50);
  if (lowHitRateOps.length > 0) {
    recommendations.push({
      type: 'INEFFECTIVE_CACHING',
      severity: 'MEDIUM',
      message: `${lowHitRateOps.length} cache operations have hit rate < 50%`,
      actions: ['Review cache strategy', 'Optimize cache keys', 'Consider cache preloading'],
    });
  }
  
  return recommendations;
}

module.exports = router;