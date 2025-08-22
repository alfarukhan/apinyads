const { getQueueService, getPaymentService, getNotificationService, getAuditLogService } = require('../services/core');
const { prisma } = require('../lib/prisma');

/**
 * 🚀 QUEUE JOB MANAGER
 * 
 * Centralized background job management for DanceSignal:
 * - Payment verification automation
 * - Notification delivery processing
 * - Analytics data aggregation
 * - System maintenance tasks
 * - Performance optimization jobs
 * - Data cleanup operations
 * 
 * ✅ Reliability: Guaranteed job execution with retries
 * ✅ Performance: Concurrent processing with worker pools
 * ✅ Scalability: Distributed job processing
 * ✅ Monitoring: Complete job lifecycle tracking
 */
class QueueJobManager {
  constructor() {
    this.queueService = getQueueService();
    this.paymentService = getPaymentService();
    this.notificationService = getNotificationService();
    this.auditService = getAuditLogService();
    this.prisma = prisma;

    // ✅ Job scheduling configuration
    this.config = {
      // Payment jobs
      PAYMENT_VERIFICATION_INTERVAL: parseInt(process.env.PAYMENT_VERIFICATION_INTERVAL) || 30000, // 30 seconds
      PAYMENT_REMINDER_INTERVAL: parseInt(process.env.PAYMENT_REMINDER_INTERVAL) || 300000, // 5 minutes
      PAYMENT_CLEANUP_INTERVAL: parseInt(process.env.PAYMENT_CLEANUP_INTERVAL) || 3600000, // 1 hour
      
      // Notification jobs
      NOTIFICATION_BATCH_SIZE: parseInt(process.env.NOTIFICATION_BATCH_SIZE) || 100,
      NOTIFICATION_RETRY_DELAY: parseInt(process.env.NOTIFICATION_RETRY_DELAY) || 60000, // 1 minute
      
      // Analytics jobs
      ANALYTICS_AGGREGATION_INTERVAL: parseInt(process.env.ANALYTICS_INTERVAL) || 1800000, // 30 minutes
      USER_ANALYTICS_INTERVAL: parseInt(process.env.USER_ANALYTICS_INTERVAL) || 3600000, // 1 hour
      
      // Maintenance jobs
      SYSTEM_CLEANUP_INTERVAL: parseInt(process.env.SYSTEM_CLEANUP_INTERVAL) || 86400000, // 24 hours
      LOG_CLEANUP_INTERVAL: parseInt(process.env.LOG_CLEANUP_INTERVAL) || 604800000, // 7 days
      
      // Performance settings
      ENABLE_JOB_SCHEDULING: process.env.ENABLE_JOB_SCHEDULING !== 'false',
      MAX_CONCURRENT_JOBS: parseInt(process.env.MAX_CONCURRENT_JOBS) || 10
    };

    console.log('🚀 QueueJobManager initialized:', {
      scheduling: this.config.ENABLE_JOB_SCHEDULING,
      maxConcurrent: this.config.MAX_CONCURRENT_JOBS,
      paymentInterval: `${this.config.PAYMENT_VERIFICATION_INTERVAL}ms`,
      notificationBatch: this.config.NOTIFICATION_BATCH_SIZE
    });
  }

  /**
   * 🎯 START JOB SCHEDULING
   */
  async startScheduledJobs() {
    if (!this.config.ENABLE_JOB_SCHEDULING) {
      console.log('📋 Job scheduling disabled');
      return;
    }

    console.log('🚀 Starting scheduled background jobs...');

    // ✅ Payment-related jobs
    await this.schedulePaymentJobs();
    
    // ✅ Notification jobs
    await this.scheduleNotificationJobs();
    
    // ✅ Analytics jobs
    await this.scheduleAnalyticsJobs();
    
    // ✅ Maintenance jobs
    await this.scheduleMaintenanceJobs();

    console.log('✅ All scheduled jobs started successfully');
  }

  /**
   * 💰 PAYMENT JOBS
   */
  async schedulePaymentJobs() {
    // ✅ Payment verification job - runs every 30 seconds
    setInterval(async () => {
      try {
        await this.queueService.addJob('payment:verify_batch', {
          batchSize: 50,
          maxAgeMinutes: 30
        }, {
          priority: 3, // High priority
          retries: 2
        });
      } catch (error) {
        console.error('❌ Failed to queue payment verification job:', error);
      }
    }, this.config.PAYMENT_VERIFICATION_INTERVAL);

    // ✅ Payment reminder job - runs every 5 minutes
    setInterval(async () => {
      try {
        await this.queueService.addJob('payment:send_reminders', {
          reminderTypes: ['EXPIRING_SOON', 'ABANDONED'],
          batchSize: 100
        }, {
          priority: 4, // Medium priority
          retries: 3
        });
      } catch (error) {
        console.error('❌ Failed to queue payment reminder job:', error);
      }
    }, this.config.PAYMENT_REMINDER_INTERVAL);

    // ✅ Payment cleanup job - runs every hour
    setInterval(async () => {
      try {
        await this.queueService.addJob('payment:cleanup', {
          expiredAgeMinutes: 60,
          batchSize: 200
        }, {
          priority: 6, // Low priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue payment cleanup job:', error);
      }
    }, this.config.PAYMENT_CLEANUP_INTERVAL);

    console.log('💰 Payment jobs scheduled');
  }

  /**
   * 📧 NOTIFICATION JOBS
   */
  async scheduleNotificationJobs() {
    // ✅ Event reminder notifications - runs every 10 minutes
    setInterval(async () => {
      try {
        await this.queueService.addJob('notification:event_reminders', {
          reminderTypes: ['24_HOURS', '1_HOUR', '15_MINUTES'],
          batchSize: this.config.NOTIFICATION_BATCH_SIZE
        }, {
          priority: 4, // Medium priority
          retries: 2
        });
      } catch (error) {
        console.error('❌ Failed to queue event reminder job:', error);
      }
    }, 600000); // 10 minutes

    // ✅ Weekly newsletter job - runs daily at 9 AM
    this.scheduleDaily(9, 0, async () => {
      try {
        await this.queueService.addJob('notification:weekly_newsletter', {
          userSegments: ['ACTIVE', 'ORGANIZERS'],
          personalize: true
        }, {
          priority: 7, // Low priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue newsletter job:', error);
      }
    });

    // ✅ Push notification batch processing - runs every 2 minutes
    setInterval(async () => {
      try {
        await this.queueService.addJob('notification:process_push_queue', {
          batchSize: this.config.NOTIFICATION_BATCH_SIZE,
          priority: 'HIGH'
        }, {
          priority: 3, // High priority
          retries: 2
        });
      } catch (error) {
        console.error('❌ Failed to queue push notification job:', error);
      }
    }, 120000); // 2 minutes

    console.log('📧 Notification jobs scheduled');
  }

  /**
   * 📊 ANALYTICS JOBS
   */
  async scheduleAnalyticsJobs() {
    // ✅ Event analytics aggregation - runs every 30 minutes
    setInterval(async () => {
      try {
        await this.queueService.addJob('event:analytics', {
          aggregationType: 'INCREMENTAL',
          timeWindow: '30_MINUTES'
        }, {
          priority: 5, // Medium-low priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue event analytics job:', error);
      }
    }, this.config.ANALYTICS_AGGREGATION_INTERVAL);

    // ✅ User engagement analytics - runs every hour
    setInterval(async () => {
      try {
        await this.queueService.addJob('user:analytics', {
          metricsTypes: ['ENGAGEMENT', 'ACTIVITY', 'RETENTION'],
          timeWindow: '1_HOUR'
        }, {
          priority: 6, // Low priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue user analytics job:', error);
      }
    }, this.config.USER_ANALYTICS_INTERVAL);

    // ✅ Daily report generation - runs daily at 6 AM
    this.scheduleDaily(6, 0, async () => {
      try {
        await this.queueService.addJob('analytics:daily_report', {
          reportTypes: ['REVENUE', 'EVENTS', 'USERS', 'PERFORMANCE'],
          recipients: ['ADMIN', 'ORGANIZERS']
        }, {
          priority: 5, // Medium-low priority
          retries: 2
        });
      } catch (error) {
        console.error('❌ Failed to queue daily report job:', error);
      }
    });

    console.log('📊 Analytics jobs scheduled');
  }

  /**
   * 🧹 MAINTENANCE JOBS
   */
  async scheduleMaintenanceJobs() {
    // ✅ System cleanup - runs daily at 2 AM
    this.scheduleDaily(2, 0, async () => {
      try {
        await this.queueService.addJob('system:cleanup', {
          cleanupTypes: ['EXPIRED_SESSIONS', 'OLD_LOGS', 'TEMP_FILES'],
          retentionDays: 30
        }, {
          priority: 8, // Very low priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue system cleanup job:', error);
      }
    });

    // ✅ Database optimization - runs weekly on Sunday at 3 AM
    this.scheduleWeekly(0, 3, 0, async () => {
      try {
        await this.queueService.addJob('system:database_optimization', {
          operations: ['ANALYZE', 'VACUUM', 'REINDEX'],
          tables: ['events', 'users', 'bookings', 'payments']
        }, {
          priority: 9, // Lowest priority
          retries: 1,
          timeout: 1800000 // 30 minutes
        });
      } catch (error) {
        console.error('❌ Failed to queue database optimization job:', error);
      }
    });

    // ✅ Health check job - runs every 5 minutes
    setInterval(async () => {
      try {
        await this.queueService.addJob('system:health_check', {
          checks: ['DATABASE', 'REDIS', 'EXTERNAL_APIS'],
          alertOnFailure: true
        }, {
          priority: 2, // Very high priority
          retries: 1
        });
      } catch (error) {
        console.error('❌ Failed to queue health check job:', error);
      }
    }, 300000); // 5 minutes

    console.log('🧹 Maintenance jobs scheduled');
  }

  /**
   * 🎯 MANUAL JOB TRIGGERS
   */
  
  async triggerPaymentVerification(options = {}) {
    const {
      paymentId = null,
      orderIds = [],
      priority = 2
    } = options;

    try {
      const jobData = paymentId 
        ? { paymentId }
        : { orderIds, batchSize: orderIds.length };

      const job = await this.queueService.addJob('payment:verify', jobData, {
        priority,
        retries: 3,
        correlationId: `manual_payment_verification_${Date.now()}`
      });

      console.log(`🔄 Manual payment verification queued: ${job.id}`);
      return job;

    } catch (error) {
      console.error('❌ Failed to trigger payment verification:', error);
      throw error;
    }
  }

  async triggerNotificationBatch(notificationType, recipients, data = {}) {
    try {
      const job = await this.queueService.addJob('notification:batch', {
        type: notificationType,
        recipients,
        data,
        priority: 'IMMEDIATE'
      }, {
        priority: 1, // Critical priority
        retries: 2,
        correlationId: `manual_notification_${notificationType}_${Date.now()}`
      });

      console.log(`📧 Manual notification batch queued: ${job.id}`);
      return job;

    } catch (error) {
      console.error('❌ Failed to trigger notification batch:', error);
      throw error;
    }
  }

  async triggerEventAnalytics(eventId, analyticsType = 'FULL') {
    try {
      const job = await this.queueService.addJob('event:analytics', {
        eventId,
        analyticsType,
        manual: true
      }, {
        priority: 4, // Medium priority
        retries: 1,
        correlationId: `manual_event_analytics_${eventId}_${Date.now()}`
      });

      console.log(`📊 Manual event analytics queued: ${job.id}`);
      return job;

    } catch (error) {
      console.error('❌ Failed to trigger event analytics:', error);
      throw error;
    }
  }

  async triggerSystemMaintenance(maintenanceType, options = {}) {
    try {
      const job = await this.queueService.addJob(`system:${maintenanceType}`, {
        ...options,
        manual: true,
        triggeredBy: 'ADMIN'
      }, {
        priority: 6, // Low priority
        retries: 1,
        timeout: 3600000, // 1 hour
        correlationId: `manual_maintenance_${maintenanceType}_${Date.now()}`
      });

      console.log(`🧹 Manual system maintenance queued: ${job.id}`);
      return job;

    } catch (error) {
      console.error('❌ Failed to trigger system maintenance:', error);
      throw error;
    }
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  scheduleDaily(hour, minute, callback) {
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(hour, minute, 0, 0);

    // If the scheduled time has passed today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }

    const initialDelay = scheduledTime.getTime() - now.getTime();

    setTimeout(() => {
      callback();
      // Then run daily
      setInterval(callback, 24 * 60 * 60 * 1000);
    }, initialDelay);
  }

  scheduleWeekly(dayOfWeek, hour, minute, callback) {
    const now = new Date();
    const scheduledTime = new Date();
    
    // Calculate days until the target day
    const daysUntilTarget = (dayOfWeek - now.getDay() + 7) % 7;
    scheduledTime.setDate(now.getDate() + daysUntilTarget);
    scheduledTime.setHours(hour, minute, 0, 0);

    // If the scheduled time has passed this week, schedule for next week
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 7);
    }

    const initialDelay = scheduledTime.getTime() - now.getTime();

    setTimeout(() => {
      callback();
      // Then run weekly
      setInterval(callback, 7 * 24 * 60 * 60 * 1000);
    }, initialDelay);
  }

  /**
   * 📊 JOB MONITORING & STATISTICS
   */
  async getJobStatistics() {
    try {
      const queueMetrics = this.queueService.getMetrics();
      const healthStatus = this.queueService.getHealthStatus();

      return {
        queue: queueMetrics,
        health: healthStatus,
        config: {
          schedulingEnabled: this.config.ENABLE_JOB_SCHEDULING,
          maxConcurrent: this.config.MAX_CONCURRENT_JOBS,
          intervals: {
            paymentVerification: this.config.PAYMENT_VERIFICATION_INTERVAL,
            paymentReminder: this.config.PAYMENT_REMINDER_INTERVAL,
            analytics: this.config.ANALYTICS_AGGREGATION_INTERVAL
          }
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Failed to get job statistics:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getActiveJobs() {
    try {
      // ✅ Get jobs by type from queue service
      const paymentJobs = this.queueService.getJobsByType('payment:verify');
      const notificationJobs = this.queueService.getJobsByType('notification:batch');
      const analyticsJobs = this.queueService.getJobsByType('event:analytics');

      return {
        payment: paymentJobs.filter(job => job.status === 'processing' || job.status === 'pending'),
        notification: notificationJobs.filter(job => job.status === 'processing' || job.status === 'pending'),
        analytics: analyticsJobs.filter(job => job.status === 'processing' || job.status === 'pending'),
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Failed to get active jobs:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.prisma.$disconnect();
    console.log('✅ QueueJobManager cleanup completed');
  }
}

module.exports = QueueJobManager;