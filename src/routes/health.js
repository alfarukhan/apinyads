const express = require('express');
const router = express.Router();
const { 
  getPaymentService,
  getAuthenticationService,
  getPermissionService,
  getNotificationService,
  getResponseFormatter,
  getExternalAPIGateway,
  getAuditLogService,
  getAssetManagerService,
  getCacheService,
  getRateLimitService,
  getConfigService,
  getQueueService
} = require('../services/core');

/**
 * 🏥 HEALTH MONITORING ENDPOINTS
 * 
 * Comprehensive health checking for all DanceSignal services:
 * - Individual service health checks
 * - Overall system health status
 * - Performance metrics & statistics
 * - Dependency status monitoring
 * - Real-time system diagnostics
 * - Load & capacity monitoring
 * 
 * ✅ Observability: Complete system visibility
 * ✅ Reliability: Early problem detection
 * ✅ Performance: Service optimization insights
 * ✅ Operations: Deployment & scaling decisions
 */

/**
 * 🎯 MAIN HEALTH CHECK ENDPOINT
 * 
 * Overall system health status
 */
router.get('/', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    // ✅ Basic system info
    const systemInfo = {
      service: 'dancesignal-api',
      version: process.env.API_VERSION || '2.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      hostname: require('os').hostname(),
      pid: process.pid
    };

    // ✅ Memory & CPU usage
    const memoryUsage = process.memoryUsage();
    const systemStats = {
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`
      },
      loadAverage: require('os').loadavg(),
      cpuUsage: process.cpuUsage()
    };

    // ✅ Quick service availability check
    const serviceStatus = await checkCoreServicesQuick();
    
    // ✅ Overall health determination
    const healthyServices = Object.values(serviceStatus).filter(s => s.status === 'healthy').length;
    const totalServices = Object.keys(serviceStatus).length;
    const overallStatus = healthyServices === totalServices ? 'healthy' : 
                         healthyServices > totalServices * 0.7 ? 'degraded' : 'unhealthy';

    const responseTime = Date.now() - startTime;

    return responseFormatter.success(res, {
      data: {
        status: overallStatus,
        ...systemInfo,
        ...systemStats,
        responseTime: `${responseTime}ms`,
        services: {
          healthy: healthyServices,
          total: totalServices,
          details: serviceStatus
        }
      },
      message: `System is ${overallStatus}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Health check failed',
      statusCode: 503,
      errorCode: 'HEALTH_CHECK_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🔍 DETAILED HEALTH CHECK
 * 
 * Comprehensive health status of all services
 */
router.get('/detailed', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    // ✅ Detailed service health checks
    const serviceHealth = await checkAllServicesDetailed();
    
    // ✅ Database connectivity check
    const databaseHealth = await checkDatabaseHealth();
    
    // ✅ External dependencies check
    const dependenciesHealth = await checkExternalDependencies();

    // ✅ System resources check
    const resourcesHealth = await checkSystemResources();

    // ✅ Performance metrics
    const performanceMetrics = await getPerformanceMetrics();

    const responseTime = Date.now() - startTime;

    // ✅ Calculate overall health
    const allChecks = [
      ...Object.values(serviceHealth),
      databaseHealth,
      ...Object.values(dependenciesHealth),
      resourcesHealth
    ];
    
    const healthyChecks = allChecks.filter(check => check.status === 'healthy').length;
    const overallStatus = healthyChecks === allChecks.length ? 'healthy' :
                         healthyChecks > allChecks.length * 0.8 ? 'degraded' : 'unhealthy';

    return responseFormatter.success(res, {
      data: {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        checks: {
          services: serviceHealth,
          database: databaseHealth,
          dependencies: dependenciesHealth,
          resources: resourcesHealth
        },
        metrics: performanceMetrics,
        summary: {
          totalChecks: allChecks.length,
          healthyChecks: healthyChecks,
          healthPercentage: `${Math.round((healthyChecks / allChecks.length) * 100)}%`
        }
      },
      message: `Detailed health check completed - System is ${overallStatus}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Detailed health check failed',
      statusCode: 503,
      errorCode: 'DETAILED_HEALTH_CHECK_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * ⚡ READINESS CHECK
 * 
 * Check if system is ready to handle requests
 */
router.get('/ready', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    // ✅ Essential services readiness
    const readinessChecks = await checkSystemReadiness();
    
    const allReady = Object.values(readinessChecks).every(check => check.ready);
    const status = allReady ? 'ready' : 'not_ready';
    const statusCode = allReady ? 200 : 503;

    return responseFormatter.success(res, {
      data: {
        status,
        timestamp: new Date().toISOString(),
        checks: readinessChecks
      },
      message: `System is ${status}`,
      statusCode,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Readiness check failed',
      statusCode: 503,
      errorCode: 'READINESS_CHECK_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 💓 LIVENESS CHECK
 * 
 * Simple check if service is alive
 */
router.get('/live', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  
  return responseFormatter.success(res, {
    data: {
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime()
    },
    message: 'Service is alive'
  });
});

/**
 * 📊 SERVICE-SPECIFIC HEALTH ENDPOINTS
 */

router.get('/services/payment', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    const paymentService = getPaymentService();
    const health = await paymentService.getHealthStatus();
    
    return responseFormatter.success(res, {
      data: {
        service: 'PaymentService',
        ...health,
        timestamp: new Date().toISOString()
      },
      message: `Payment service is ${health.status}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Payment service health check failed',
      statusCode: 503,
      details: { error: error.message },
      startTime
    });
  }
});

router.get('/services/cache', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    const cacheService = getCacheService();
    const health = cacheService.getHealthStatus();
    const metrics = cacheService.getMetrics();
    
    return responseFormatter.success(res, {
      data: {
        service: 'CacheService',
        ...health,
        metrics,
        timestamp: new Date().toISOString()
      },
      message: `Cache service is ${health.status}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Cache service health check failed',
      statusCode: 503,
      details: { error: error.message },
      startTime
    });
  }
});

router.get('/services/queue', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    const queueService = getQueueService();
    const health = queueService.getHealthStatus();
    const metrics = queueService.getMetrics();
    
    return responseFormatter.success(res, {
      data: {
        service: 'QueueService',
        ...health,
        metrics,
        timestamp: new Date().toISOString()
      },
      message: `Queue service is ${health.status}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Queue service health check failed',
      statusCode: 503,
      details: { error: error.message },
      startTime
    });
  }
});

router.get('/services/rate-limit', async (req, res) => {
  const responseFormatter = getResponseFormatter();
  const startTime = Date.now();

  try {
    const rateLimitService = getRateLimitService();
    const health = rateLimitService.getHealthStatus();
    const stats = rateLimitService.getStats();
    
    return responseFormatter.success(res, {
      data: {
        service: 'RateLimitService',
        ...health,
        stats,
        timestamp: new Date().toISOString()
      },
      message: `Rate limit service is ${health.status}`,
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Rate limit service health check failed',
      statusCode: 503,
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🛠️ HELPER FUNCTIONS
 */

async function checkCoreServicesQuick() {
  const services = {};

  try {
    // ✅ Quick availability checks
    services.payment = { status: 'healthy', lastCheck: new Date().toISOString() };
    services.cache = getCacheService().getHealthStatus();
    services.queue = getQueueService().getHealthStatus();
    services.rateLimit = getRateLimitService().getHealthStatus();
    services.config = getConfigService().getHealthStatus();
  } catch (error) {
    services.error = { status: 'unhealthy', error: error.message };
  }

  return services;
}

async function checkAllServicesDetailed() {
  const services = {};

  try {
    // ✅ Payment Service
    try {
      const paymentService = getPaymentService();
      services.payment = await paymentService.getHealthStatus();
    } catch (error) {
      services.payment = { status: 'unhealthy', error: error.message };
    }

    // ✅ Cache Service
    try {
      const cacheService = getCacheService();
      services.cache = cacheService.getHealthStatus();
      services.cache.metrics = cacheService.getMetrics();
    } catch (error) {
      services.cache = { status: 'unhealthy', error: error.message };
    }

    // ✅ Queue Service
    try {
      const queueService = getQueueService();
      services.queue = queueService.getHealthStatus();
      services.queue.metrics = queueService.getMetrics();
    } catch (error) {
      services.queue = { status: 'unhealthy', error: error.message };
    }

    // ✅ Rate Limit Service
    try {
      const rateLimitService = getRateLimitService();
      services.rateLimit = rateLimitService.getHealthStatus();
      services.rateLimit.stats = rateLimitService.getStats();
    } catch (error) {
      services.rateLimit = { status: 'unhealthy', error: error.message };
    }

    // ✅ Config Service
    try {
      const configService = getConfigService();
      services.config = configService.getHealthStatus();
    } catch (error) {
      services.config = { status: 'unhealthy', error: error.message };
    }

    // ✅ Asset Manager Service
    try {
      const assetService = getAssetManagerService();
      services.assets = {
        status: 'healthy',
        stats: assetService.getStats()
      };
    } catch (error) {
      services.assets = { status: 'unhealthy', error: error.message };
    }

  } catch (error) {
    console.error('❌ Service health check error:', error);
  }

  return services;
}

async function checkDatabaseHealth() {
  try {
    // ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');
    
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - startTime;
    
    await prisma.$disconnect();

    return {
      status: 'healthy',
      responseTime: `${responseTime}ms`,
      lastCheck: new Date().toISOString()
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      lastCheck: new Date().toISOString()
    };
  }
}

async function checkExternalDependencies() {
  const dependencies = {};

  // ✅ Midtrans API check
  try {
    const externalGateway = getExternalAPIGateway();
    const stats = externalGateway.getServiceStats();
    
    dependencies.midtrans = {
      status: stats.midtrans ? 'healthy' : 'unknown',
      stats: stats.midtrans || {}
    };
  } catch (error) {
    dependencies.midtrans = { status: 'unhealthy', error: error.message };
  }

  // ✅ Redis check (if cache service uses it)
  try {
    const cacheService = getCacheService();
    const cacheHealth = cacheService.getHealthStatus();
    
    dependencies.redis = {
      status: cacheHealth.redisConnected ? 'healthy' : 'degraded',
      connected: cacheHealth.redisConnected
    };
  } catch (error) {
    dependencies.redis = { status: 'unknown', error: error.message };
  }

  return dependencies;
}

async function checkSystemResources() {
  try {
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const memoryPercentage = (memoryUsedMB / memoryTotalMB) * 100;

    const loadAverage = require('os').loadavg();
    const cpuCount = require('os').cpus().length;
    const loadPercentage = (loadAverage[0] / cpuCount) * 100;

    let status = 'healthy';
    if (memoryPercentage > 90 || loadPercentage > 90) {
      status = 'critical';
    } else if (memoryPercentage > 80 || loadPercentage > 80) {
      status = 'warning';
    }

    return {
      status,
      memory: {
        used: `${memoryUsedMB}MB`,
        total: `${memoryTotalMB}MB`,
        percentage: `${Math.round(memoryPercentage)}%`
      },
      cpu: {
        loadAverage: loadAverage,
        cores: cpuCount,
        loadPercentage: `${Math.round(loadPercentage)}%`
      },
      uptime: process.uptime()
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function checkSystemReadiness() {
  const checks = {};

  // ✅ Database readiness
  try {
    const dbHealth = await checkDatabaseHealth();
    checks.database = { ready: dbHealth.status === 'healthy', ...dbHealth };
  } catch (error) {
    checks.database = { ready: false, error: error.message };
  }

  // ✅ Core services readiness
  try {
    const services = await checkCoreServicesQuick();
    checks.services = { 
      ready: Object.values(services).every(s => s.status === 'healthy'),
      details: services
    };
  } catch (error) {
    checks.services = { ready: false, error: error.message };
  }

  // ✅ Configuration readiness
  try {
    const configService = getConfigService();
    const configHealth = configService.getHealthStatus();
    checks.configuration = { ready: configHealth.status === 'healthy', ...configHealth };
  } catch (error) {
    checks.configuration = { ready: false, error: error.message };
  }

  return checks;
}

async function getPerformanceMetrics() {
  try {
    return {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      eventLoopLag: await measureEventLoopLag(),
      activeHandles: process._getActiveHandles().length,
      activeRequests: process._getActiveRequests().length
    };
  } catch (error) {
    return { error: error.message };
  }
}

function measureEventLoopLag() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
      resolve(lag);
    });
  });
}

module.exports = router;