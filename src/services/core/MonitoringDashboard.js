const PaymentService = require('./PaymentService');
const SessionManager = require('./SessionManager');
const UnifiedErrorHandler = require('./UnifiedErrorHandler');
const RateLimitService = require('./RateLimitService');
const CacheService = require('./CacheService');
const TransactionManager = require('./TransactionManager');
const LoggingService = require('./LoggingService');
const AuditLogService = require('./AuditLogService');
const NotificationService = require('./NotificationService');
const ConfigService = require('./ConfigService');

/**
 * 📊 ENTERPRISE MONITORING DASHBOARD SERVICE
 * 
 * Real-time monitoring and analytics dashboard for DanceSignal:
 * - Service health monitoring with alerting
 * - Payment metrics & fraud detection analytics
 * - Performance monitoring & optimization insights
 * - Error tracking & trend analysis
 * - User behavior & security analytics
 * - Real-time system metrics & alerts
 * 
 * ✅ Observability: Complete system visibility & insights
 * ✅ Performance: Real-time metrics with minimal overhead
 * ✅ Alerting: Proactive issue detection & notification
 * ✅ Analytics: Business intelligence & optimization data
 */
class MonitoringDashboard {
  constructor() {
    this.logger = new LoggingService();
    this.configService = new ConfigService();

    // ✅ Dashboard configuration
    this.config = {
      // Update intervals
      METRICS_UPDATE_INTERVAL_MS: parseInt(process.env.METRICS_UPDATE_INTERVAL_MS) || 30000, // 30 seconds
      HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 60000, // 1 minute
      ALERT_CHECK_INTERVAL_MS: parseInt(process.env.ALERT_CHECK_INTERVAL_MS) || 60000, // 1 minute
      
      // Data retention
      METRICS_RETENTION_HOURS: parseInt(process.env.METRICS_RETENTION_HOURS) || 24, // 24 hours
      DETAILED_METRICS_RETENTION_HOURS: parseInt(process.env.DETAILED_METRICS_RETENTION_HOURS) || 6, // 6 hours
      
      // Alert thresholds
      ERROR_RATE_THRESHOLD: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 5.0, // 5%
      RESPONSE_TIME_THRESHOLD_MS: parseInt(process.env.RESPONSE_TIME_THRESHOLD_MS) || 2000, // 2 seconds
      PAYMENT_FAILURE_THRESHOLD: parseFloat(process.env.PAYMENT_FAILURE_THRESHOLD) || 10.0, // 10%
      MEMORY_USAGE_THRESHOLD: parseFloat(process.env.MEMORY_USAGE_THRESHOLD) || 80.0, // 80%
      CPU_USAGE_THRESHOLD: parseFloat(process.env.CPU_USAGE_THRESHOLD) || 80.0, // 80%
      
      // Dashboard settings
      ENABLE_REAL_TIME_UPDATES: process.env.ENABLE_REAL_TIME_UPDATES !== 'false',
      ENABLE_ALERTING: process.env.ENABLE_MONITORING_ALERTS !== 'false',
      ENABLE_METRICS_EXPORT: process.env.ENABLE_METRICS_EXPORT === 'true'
    };

    // ✅ Metrics storage
    this.metrics = {
      system: new Map(),
      payments: new Map(),
      errors: new Map(),
      performance: new Map(),
      security: new Map(),
      business: new Map()
    };

    // ✅ Alert tracking
    this.alerts = {
      active: new Map(),
      history: [],
      lastCheck: null
    };

    // ✅ Dashboard state
    this.lastUpdate = null;
    this.isCollecting = false;

    // ✅ Initialize monitoring
    this.initializeMonitoring();

    console.log('📊 MonitoringDashboard initialized:', {
      metricsInterval: `${this.config.METRICS_UPDATE_INTERVAL_MS}ms`,
      healthCheckInterval: `${this.config.HEALTH_CHECK_INTERVAL_MS}ms`,
      alerting: this.config.ENABLE_ALERTING,
      realTimeUpdates: this.config.ENABLE_REAL_TIME_UPDATES
    });
  }

  /**
   * 🚀 MONITORING INITIALIZATION
   */

  initializeMonitoring() {
    // ✅ Start metrics collection
    if (this.config.ENABLE_REAL_TIME_UPDATES) {
      this.startMetricsCollection();
    }

    // ✅ Start health monitoring
    this.startHealthMonitoring();

    // ✅ Start alert monitoring
    if (this.config.ENABLE_ALERTING) {
      this.startAlertMonitoring();
    }

    // ✅ Start cleanup routine
    this.startCleanupRoutine();
  }

  startMetricsCollection() {
    setInterval(async () => {
      if (!this.isCollecting) {
        this.isCollecting = true;
        try {
          await this.collectAllMetrics();
        } catch (error) {
          console.error('Metrics collection failed:', error);
        } finally {
          this.isCollecting = false;
        }
      }
    }, this.config.METRICS_UPDATE_INTERVAL_MS);

    // ✅ Initial collection
    setImmediate(() => this.collectAllMetrics());
  }

  startHealthMonitoring() {
    setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        console.error('Health monitoring failed:', error);
      }
    }, this.config.HEALTH_CHECK_INTERVAL_MS);
  }

  startAlertMonitoring() {
    setInterval(async () => {
      try {
        await this.checkAlerts();
      } catch (error) {
        console.error('Alert monitoring failed:', error);
      }
    }, this.config.ALERT_CHECK_INTERVAL_MS);
  }

  startCleanupRoutine() {
    // ✅ Cleanup old metrics every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * 📊 METRICS COLLECTION
   */

  async collectAllMetrics() {
    const timestamp = Date.now();
    
    try {
      // ✅ Collect system metrics
      const systemMetrics = await this.collectSystemMetrics();
      this.storeMetrics('system', timestamp, systemMetrics);

      // ✅ Collect payment metrics
      const paymentMetrics = await this.collectPaymentMetrics();
      this.storeMetrics('payments', timestamp, paymentMetrics);

      // ✅ Collect error metrics
      const errorMetrics = await this.collectErrorMetrics();
      this.storeMetrics('errors', timestamp, errorMetrics);

      // ✅ Collect performance metrics
      const performanceMetrics = await this.collectPerformanceMetrics();
      this.storeMetrics('performance', timestamp, performanceMetrics);

      // ✅ Collect security metrics
      const securityMetrics = await this.collectSecurityMetrics();
      this.storeMetrics('security', timestamp, securityMetrics);

      // ✅ Collect business metrics
      const businessMetrics = await this.collectBusinessMetrics();
      this.storeMetrics('business', timestamp, businessMetrics);

      this.lastUpdate = new Date();

    } catch (error) {
      this.logger.error('Failed to collect metrics', {
        error: error.message,
        timestamp: new Date(timestamp).toISOString()
      });
    }
  }

  async collectSystemMetrics() {
    try {
      // ✅ System resource usage
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      // ✅ Get service health statuses
      const transactionManager = getTransactionManager();
          const cacheService = new CacheService();
    const rateLimitService = new RateLimitService();

      return {
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
          usagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
          usagePercent: ((cpuUsage.user + cpuUsage.system) / 1000000) * 100
        },
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development',
        services: {
          transactions: transactionManager.getHealthStatus(),
          cache: cacheService.getHealthStatus(),
          rateLimit: rateLimitService.getHealthStatus()
        }
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async collectPaymentMetrics() {
    try {
      const paymentService = new PaymentService();
      const stats = paymentService.getPaymentStats();

      return {
        total: stats.totalPayments || 0,
        successful: stats.successfulPayments || 0,
        failed: stats.failedPayments || 0,
        pending: stats.pendingPayments || 0,
        successRate: stats.successRate || '100%',
        averageAmount: stats.averageAmount || 0,
        totalRevenue: stats.totalRevenue || 0,
        fraudDetected: stats.fraudDetected || 0,
        refunds: stats.refunds || 0,
        chargebacks: stats.chargebacks || 0,
        averageProcessingTime: stats.averageProcessingTime || 0,
        peakVolume: stats.peakVolume || 0,
        hourlyVolume: stats.hourlyVolume || 0
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async collectErrorMetrics() {
    try {
      const errorHandler = getUnifiedErrorHandler();
      const stats = errorHandler.getErrorStats();

      return {
        total: stats.totalErrors || 0,
        byCategory: stats.errorsByCategory || {},
        byStatus: stats.errorsByStatus || {},
        rate: stats.errorRate || '0/sec',
        topErrors: stats.topErrorCategories || {},
        criticalErrors: stats.criticalErrors || 0,
        lastError: stats.lastError,
        trends: {
          last24h: stats.last24h || 0,
          lastHour: stats.lastHour || 0,
          lastMinute: stats.lastMinute || 0
        }
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async collectPerformanceMetrics() {
    try {
      const transactionManager = getTransactionManager();
          const cacheService = new CacheService();
    const rateLimitService = new RateLimitService();

      const transactionStats = transactionManager.getTransactionStats();
      const cacheStats = cacheService.getCacheStats();
      const rateLimitStats = rateLimitService.getRateLimitStats();

      return {
        transactions: {
          total: transactionStats.total || 0,
          successful: transactionStats.successful || 0,
          failed: transactionStats.failed || 0,
          averageDuration: transactionStats.averageDurationMs || 0,
          slowTransactions: transactionStats.slowTransactions || 0,
          successRate: transactionStats.successRate || '100%'
        },
        cache: {
          hits: cacheStats.hits || 0,
          misses: cacheStats.misses || 0,
          hitRate: cacheStats.hitRate || '0%',
          size: cacheStats.size || 0,
          memory: cacheStats.memoryUsage || 0
        },
        rateLimit: {
          requests: rateLimitStats.totalRequests || 0,
          throttled: rateLimitStats.throttledRequests || 0,
          blocked: rateLimitStats.blockedRequests || 0,
          throttleRate: rateLimitStats.throttleRate || '0%'
        },
        api: {
          totalRequests: 0, // TODO: Implement API request tracking
          averageResponseTime: 0,
          p95ResponseTime: 0,
          p99ResponseTime: 0,
          slowestEndpoints: []
        }
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async collectSecurityMetrics() {
    try {
      const sessionManager = new SessionManager();
      const auditService = new AuditLogService();

      const sessionStats = sessionManager.getSessionStats();
      
      return {
        sessions: {
          active: sessionStats.activeSessions || 0,
          total: sessionStats.totalSessionsCreated || 0,
          suspicious: sessionStats.suspiciousActivities || 0,
          deviceFingerprints: sessionStats.deviceFingerprints || 0
        },
        threats: {
          ddosAttempts: 0, // TODO: Implement DDoS tracking
          bruteForceAttempts: 0,
          suspiciousIPs: 0,
          blockedRequests: 0,
          failedLogins: 0
        },
        compliance: {
          auditEvents: 0, // TODO: Get from audit service
          dataAccess: 0,
          sensitiveOperations: 0,
          policyViolations: 0
        }
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  async collectBusinessMetrics() {
    try {
      // ✅ TODO: Collect business metrics from database
      // This would include user engagement, event popularity, revenue trends, etc.

      return {
        users: {
          active: 0,
          new: 0,
          retention: '0%',
          engagement: 0
        },
        events: {
          total: 0,
          active: 0,
          soldOut: 0,
          revenue: 0
        },
        bookings: {
          total: 0,
          pending: 0,
          confirmed: 0,
          cancelled: 0,
          conversionRate: '0%'
        },
        revenue: {
          total: 0,
          today: 0,
          thisWeek: 0,
          thisMonth: 0,
          growth: '0%'
        }
      };

    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * 🏥 HEALTH MONITORING
   */

  async performHealthChecks() {
    const healthStatus = {
      overall: 'healthy',
      services: {},
      timestamp: new Date(),
      issues: []
    };

    try {
      // ✅ Check core services
      const services = [
        { name: 'payments', service: new PaymentService() },
        { name: 'sessions', service: new SessionManager() },
        { name: 'errors', service: new UnifiedErrorHandler() },
        { name: 'transactions', service: new TransactionManager() },
              { name: 'cache', service: new CacheService() },
      { name: 'rateLimit', service: new RateLimitService() },
      { name: 'notifications', service: (() => { 
        const { getNotificationService } = require('./index'); 
        return getNotificationService(); 
      })() },
      { name: 'audit', service: new AuditLogService() }
      ];

      for (const { name, service } of services) {
        try {
          const status = service.getHealthStatus();
          healthStatus.services[name] = status;

          if (status.status !== 'healthy') {
            healthStatus.issues.push({
              service: name,
              status: status.status,
              message: status.message || 'Service degraded'
            });

            if (status.status === 'critical' || status.status === 'unhealthy') {
              healthStatus.overall = 'degraded';
            }
          }

        } catch (error) {
          healthStatus.services[name] = {
            status: 'error',
            message: error.message
          };
          healthStatus.issues.push({
            service: name,
            status: 'error',
            message: error.message
          });
          healthStatus.overall = 'degraded';
        }
      }

    } catch (error) {
      healthStatus.overall = 'critical';
      healthStatus.issues.push({
        service: 'monitoring',
        status: 'error',
        message: error.message
      });
    }

    // ✅ Store health status
    this.storeMetrics('health', Date.now(), healthStatus);

    return healthStatus;
  }

  /**
   * 🚨 ALERT MONITORING
   */

  async checkAlerts() {
    const alerts = [];
    this.alerts.lastCheck = new Date();

    try {
      // ✅ Get latest metrics
      const latestMetrics = this.getLatestMetrics();

      // ✅ Check system resource alerts
      if (latestMetrics.system) {
        if (latestMetrics.system.memory.usagePercent > this.config.MEMORY_USAGE_THRESHOLD) {
          alerts.push(this.createAlert('HIGH_MEMORY_USAGE', 'critical', {
            current: latestMetrics.system.memory.usagePercent,
            threshold: this.config.MEMORY_USAGE_THRESHOLD
          }));
        }

        if (latestMetrics.system.cpu.usagePercent > this.config.CPU_USAGE_THRESHOLD) {
          alerts.push(this.createAlert('HIGH_CPU_USAGE', 'critical', {
            current: latestMetrics.system.cpu.usagePercent,
            threshold: this.config.CPU_USAGE_THRESHOLD
          }));
        }
      }

      // ✅ Check error rate alerts
      if (latestMetrics.errors) {
        const errorRate = parseFloat(latestMetrics.errors.rate) || 0;
        if (errorRate > this.config.ERROR_RATE_THRESHOLD) {
          alerts.push(this.createAlert('HIGH_ERROR_RATE', 'warning', {
            current: errorRate,
            threshold: this.config.ERROR_RATE_THRESHOLD
          }));
        }
      }

      // ✅ Check payment failure alerts
      if (latestMetrics.payments) {
        const successRate = parseFloat(latestMetrics.payments.successRate) || 100;
        const failureRate = 100 - successRate;
        
        if (failureRate > this.config.PAYMENT_FAILURE_THRESHOLD) {
          alerts.push(this.createAlert('HIGH_PAYMENT_FAILURE_RATE', 'critical', {
            current: failureRate,
            threshold: this.config.PAYMENT_FAILURE_THRESHOLD
          }));
        }
      }

      // ✅ Check performance alerts
      if (latestMetrics.performance && latestMetrics.performance.api) {
        if (latestMetrics.performance.api.averageResponseTime > this.config.RESPONSE_TIME_THRESHOLD_MS) {
          alerts.push(this.createAlert('SLOW_RESPONSE_TIME', 'warning', {
            current: latestMetrics.performance.api.averageResponseTime,
            threshold: this.config.RESPONSE_TIME_THRESHOLD_MS
          }));
        }
      }

      // ✅ Process new alerts
      for (const alert of alerts) {
        await this.processAlert(alert);
      }

      // ✅ Check for resolved alerts
      await this.checkResolvedAlerts(latestMetrics);

    } catch (error) {
      this.logger.error('Alert checking failed', {
        error: error.message
      });
    }
  }

  createAlert(type, severity, data) {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type,
      severity,
      message: this.getAlertMessage(type, data),
      data,
      timestamp: new Date(),
      status: 'active'
    };
  }

  getAlertMessage(type, data) {
    const messages = {
      HIGH_MEMORY_USAGE: `Memory usage is ${data.current.toFixed(1)}% (threshold: ${data.threshold}%)`,
      HIGH_CPU_USAGE: `CPU usage is ${data.current.toFixed(1)}% (threshold: ${data.threshold}%)`,
      HIGH_ERROR_RATE: `Error rate is ${data.current.toFixed(2)}/sec (threshold: ${data.threshold}/sec)`,
      HIGH_PAYMENT_FAILURE_RATE: `Payment failure rate is ${data.current.toFixed(1)}% (threshold: ${data.threshold}%)`,
      SLOW_RESPONSE_TIME: `Average response time is ${data.current}ms (threshold: ${data.threshold}ms)`
    };

    return messages[type] || `Alert: ${type}`;
  }

  async processAlert(alert) {
    try {
      // ✅ Check if alert already exists
      if (this.alerts.active.has(alert.type)) {
        return; // Don't duplicate active alerts
      }

      // ✅ Add to active alerts
      this.alerts.active.set(alert.type, alert);
      this.alerts.history.push(alert);

      // ✅ Send notification
      await this.sendAlertNotification(alert);

      this.logger.warn('Alert triggered', {
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        data: alert.data
      });

    } catch (error) {
      this.logger.error('Failed to process alert', {
        alert: alert.type,
        error: error.message
      });
    }
  }

  async checkResolvedAlerts(currentMetrics) {
    for (const [alertType, alert] of this.alerts.active.entries()) {
      let isResolved = false;

      // ✅ Check if alert conditions are no longer met
      switch (alertType) {
        case 'HIGH_MEMORY_USAGE':
          isResolved = currentMetrics.system?.memory.usagePercent <= this.config.MEMORY_USAGE_THRESHOLD;
          break;
        case 'HIGH_CPU_USAGE':
          isResolved = currentMetrics.system?.cpu.usagePercent <= this.config.CPU_USAGE_THRESHOLD;
          break;
        case 'HIGH_ERROR_RATE':
          isResolved = parseFloat(currentMetrics.errors?.rate) <= this.config.ERROR_RATE_THRESHOLD;
          break;
        case 'HIGH_PAYMENT_FAILURE_RATE':
          const successRate = parseFloat(currentMetrics.payments?.successRate) || 100;
          isResolved = (100 - successRate) <= this.config.PAYMENT_FAILURE_THRESHOLD;
          break;
        case 'SLOW_RESPONSE_TIME':
          isResolved = currentMetrics.performance?.api?.averageResponseTime <= this.config.RESPONSE_TIME_THRESHOLD_MS;
          break;
      }

      if (isResolved) {
        await this.resolveAlert(alertType, alert);
      }
    }
  }

  async resolveAlert(alertType, alert) {
    try {
      // ✅ Remove from active alerts
      this.alerts.active.delete(alertType);

      // ✅ Update alert status
      alert.status = 'resolved';
      alert.resolvedAt = new Date();

      // ✅ Send resolution notification
      await this.sendAlertResolutionNotification(alert);

      this.logger.info('Alert resolved', {
        type: alertType,
        duration: alert.resolvedAt - alert.timestamp
      });

    } catch (error) {
      this.logger.error('Failed to resolve alert', {
        alertType,
        error: error.message
      });
    }
  }

  async sendAlertNotification(alert) {
    try {
      const { getNotificationService } = require('./index');
      const notificationService = getNotificationService();
      
      // ✅ TODO: Send alert to designated channels (email, slack, etc.)
      // For now, just log the alert
      
      this.logger.warn('ALERT NOTIFICATION', {
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp
      });

    } catch (error) {
      this.logger.error('Failed to send alert notification', {
        error: error.message
      });
    }
  }

  async sendAlertResolutionNotification(alert) {
    try {
      this.logger.info('ALERT RESOLVED', {
        type: alert.type,
        resolvedAt: alert.resolvedAt,
        duration: alert.resolvedAt - alert.timestamp
      });

    } catch (error) {
      this.logger.error('Failed to send alert resolution notification', {
        error: error.message
      });
    }
  }

  /**
   * 💾 DATA MANAGEMENT
   */

  storeMetrics(category, timestamp, data) {
    if (!this.metrics[category]) {
      this.metrics[category] = new Map();
    }

    this.metrics[category].set(timestamp, {
      timestamp: new Date(timestamp),
      data
    });
  }

  getLatestMetrics() {
    const latest = {};

    for (const [category, metrics] of Object.entries(this.metrics)) {
      if (metrics.size > 0) {
        const latestEntry = Array.from(metrics.entries()).pop();
        latest[category] = latestEntry[1].data;
      }
    }

    return latest;
  }

  getMetricsHistory(category, hours = 1) {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    const categoryMetrics = this.metrics[category];

    if (!categoryMetrics) {
      return [];
    }

    return Array.from(categoryMetrics.entries())
      .filter(([timestamp]) => timestamp >= cutoffTime)
      .map(([timestamp, entry]) => ({
        timestamp,
        ...entry.data
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  cleanupOldMetrics() {
    const retentionTime = this.config.METRICS_RETENTION_HOURS * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionTime;

    for (const [category, metrics] of Object.entries(this.metrics)) {
      for (const [timestamp] of metrics.entries()) {
        if (timestamp < cutoffTime) {
          metrics.delete(timestamp);
        }
      }
    }

    // ✅ Cleanup alert history
    this.alerts.history = this.alerts.history.filter(
      alert => (Date.now() - alert.timestamp.getTime()) < retentionTime
    );
  }

  /**
   * 📊 PUBLIC API METHODS
   */

  getDashboardData() {
    const latestMetrics = this.getLatestMetrics();
    const healthStatus = latestMetrics.health || { overall: 'unknown', services: {} };

    return {
      overview: {
        status: healthStatus.overall,
        lastUpdate: this.lastUpdate,
        alerts: {
          active: this.alerts.active.size,
          total: this.alerts.history.length
        }
      },
      system: latestMetrics.system || {},
      payments: latestMetrics.payments || {},
      errors: latestMetrics.errors || {},
      performance: latestMetrics.performance || {},
      security: latestMetrics.security || {},
      business: latestMetrics.business || {},
      health: healthStatus,
      alerts: {
        active: Array.from(this.alerts.active.values()),
        recent: this.alerts.history.slice(-10)
      }
    };
  }

  getServiceHealth() {
    const latestMetrics = this.getLatestMetrics();
    return latestMetrics.health || { overall: 'unknown', services: {} };
  }

  getPaymentAnalytics() {
    const paymentHistory = this.getMetricsHistory('payments', 24);
    const latest = this.getLatestMetrics().payments || {};

    return {
      current: latest,
      trends: paymentHistory,
      analytics: {
        hourlyVolume: this.calculateHourlyTrends(paymentHistory, 'total'),
        successRateTrend: this.calculateTrend(paymentHistory, 'successRate'),
        revenueTrend: this.calculateTrend(paymentHistory, 'totalRevenue')
      }
    };
  }

  getPerformanceAnalytics() {
    const performanceHistory = this.getMetricsHistory('performance', 6);
    const latest = this.getLatestMetrics().performance || {};

    return {
      current: latest,
      trends: performanceHistory,
      analytics: {
        responseTimeTrend: this.calculateTrend(performanceHistory, 'api.averageResponseTime'),
        cacheHitRateTrend: this.calculateTrend(performanceHistory, 'cache.hitRate'),
        transactionSuccessRateTrend: this.calculateTrend(performanceHistory, 'transactions.successRate')
      }
    };
  }

  calculateTrend(history, field) {
    if (history.length < 2) return 'stable';

    const values = history.map(entry => this.getNestedValue(entry, field)).filter(v => v !== null);
    if (values.length < 2) return 'stable';

    const recent = values.slice(-5);
    const older = values.slice(-10, -5);

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (changePercent > 5) return 'increasing';
    if (changePercent < -5) return 'decreasing';
    return 'stable';
  }

  calculateHourlyTrends(history, field) {
    const hourlyData = {};
    
    history.forEach(entry => {
      const hour = new Date(entry.timestamp).getHours();
      if (!hourlyData[hour]) {
        hourlyData[hour] = [];
      }
      const value = this.getNestedValue(entry, field);
      if (value !== null) {
        hourlyData[hour].push(value);
      }
    });

    const result = {};
    for (const [hour, values] of Object.entries(hourlyData)) {
      result[hour] = values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    return result;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  getHealthStatus() {
    const healthData = this.getServiceHealth();
    return {
      status: healthData.overall || 'unknown',
      services: Object.keys(healthData.services || {}).length,
      activeAlerts: this.alerts.active.size,
      lastUpdate: this.lastUpdate,
      isCollecting: this.isCollecting
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    // ✅ Clear all metrics
    for (const metrics of Object.values(this.metrics)) {
      metrics.clear();
    }

    // ✅ Clear alerts
    this.alerts.active.clear();
    this.alerts.history = [];

    console.log('✅ MonitoringDashboard cleanup completed');
  }
}

module.exports = MonitoringDashboard;