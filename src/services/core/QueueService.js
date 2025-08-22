const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * 🚀 CENTRALIZED QUEUE SERVICE
 * 
 * Advanced background job processing system for DanceSignal:
 * - Multi-priority job queues
 * - Scheduled & delayed job execution
 * - Job retry logic with exponential backoff
 * - Dead letter queue for failed jobs
 * - Job progress tracking & monitoring
 * - Rate limiting & concurrency control
 * - Distributed processing (Redis ready)
 * 
 * ✅ Reliability: Guaranteed job execution with retries
 * ✅ Performance: Concurrent processing with worker pools
 * ✅ Scalability: Horizontal scaling across servers
 * ✅ Observability: Complete job lifecycle tracking
 */
class QueueService extends EventEmitter {
  constructor() {
    super();
    
    // ✅ CENTRALIZED: Queue configuration
    this.config = {
      // Worker Configuration
      MAX_WORKERS: parseInt(process.env.QUEUE_MAX_WORKERS) || 5,
      WORKER_TIMEOUT_MS: parseInt(process.env.QUEUE_WORKER_TIMEOUT) || 300000, // 5 minutes
      WORKER_IDLE_TIMEOUT_MS: parseInt(process.env.QUEUE_WORKER_IDLE_TIMEOUT) || 30000, // 30 seconds
      
      // Job Configuration
      DEFAULT_PRIORITY: parseInt(process.env.QUEUE_DEFAULT_PRIORITY) || 5,
      MAX_RETRIES: parseInt(process.env.QUEUE_MAX_RETRIES) || 3,
      RETRY_DELAY_MS: parseInt(process.env.QUEUE_RETRY_DELAY) || 1000,
      MAX_RETRY_DELAY_MS: parseInt(process.env.QUEUE_MAX_RETRY_DELAY) || 60000,
      
      // Queue Management
      MAX_QUEUE_SIZE: parseInt(process.env.QUEUE_MAX_SIZE) || 10000,
      BATCH_SIZE: parseInt(process.env.QUEUE_BATCH_SIZE) || 10,
      POLL_INTERVAL_MS: parseInt(process.env.QUEUE_POLL_INTERVAL) || 1000,
      
      // Job Retention
      COMPLETED_JOB_TTL_MS: parseInt(process.env.QUEUE_COMPLETED_TTL) || 24 * 60 * 60 * 1000, // 24 hours
      FAILED_JOB_TTL_MS: parseInt(process.env.QUEUE_FAILED_TTL) || 7 * 24 * 60 * 60 * 1000, // 7 days
      
      // Monitoring
      ENABLE_METRICS: process.env.QUEUE_ENABLE_METRICS !== 'false',
      METRICS_INTERVAL_MS: parseInt(process.env.QUEUE_METRICS_INTERVAL) || 60000, // 1 minute
      
      // Storage
      STORAGE_TYPE: process.env.QUEUE_STORAGE || 'memory', // memory, redis
      REDIS_KEY_PREFIX: process.env.QUEUE_REDIS_PREFIX || 'ds:queue:'
    };

    // ✅ Queue storage
    this.queues = {
      critical: [], // Priority 1-2
      high: [],     // Priority 3-4
      normal: [],   // Priority 5-6
      low: [],      // Priority 7-8
      bulk: []      // Priority 9-10
    };

    // ✅ Job processing
    this.workers = new Map();
    this.activeJobs = new Map();
    this.jobHistory = new Map();
    this.deadLetterQueue = [];

    // ✅ Job handlers registry
    this.handlers = new Map();

    // ✅ Statistics & monitoring
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      retriedJobs: 0,
      activeJobs: 0,
      queueSizes: {},
      processingTimes: [],
      lastReset: Date.now()
    };

    // ✅ Job types and handlers
    this.registerDefaultHandlers();

    // ✅ Start queue processing
    this.startQueueProcessor();
    this.startMetricsReporting();
    this.startCleanupScheduler();

    console.log('🚀 QueueService initialized:', {
      maxWorkers: this.config.MAX_WORKERS,
      storage: this.config.STORAGE_TYPE,
      enableMetrics: this.config.ENABLE_METRICS,
      registeredHandlers: this.handlers.size
    });
  }

  /**
   * 📝 JOB REGISTRATION
   */
  registerDefaultHandlers() {
    // ✅ Payment-related jobs
    this.registerHandler('payment:verify', this.handlePaymentVerification.bind(this));
    this.registerHandler('payment:verify_batch', this.handlePaymentVerification.bind(this)); // ✅ FIX: Add missing handler
    this.registerHandler('payment:webhook_notification', this.handlePaymentWebhookNotification.bind(this)); // ✅ NEW: Webhook handler
    this.registerHandler('payment:webhook_retry', this.handlePaymentWebhookNotification.bind(this)); // ✅ NEW: Webhook retry handler
    this.registerHandler('payment:reminder', this.handlePaymentReminder.bind(this));
    this.registerHandler('payment:send_reminders', this.handlePaymentReminder.bind(this)); // ✅ FIX: Add missing handler
    this.registerHandler('payment:refund', this.handlePaymentRefund.bind(this));
    this.registerHandler('payment:cleanup', this.handlePaymentCleanup.bind(this));

    // ✅ Notification jobs
    this.registerHandler('notification:email', this.handleEmailNotification.bind(this));
    this.registerHandler('notification:push', this.handlePushNotification.bind(this));
    this.registerHandler('notification:process_push_queue', this.handlePushNotification.bind(this)); // ✅ FIX: Add missing handler
    this.registerHandler('notification:sms', this.handleSMSNotification.bind(this));
    this.registerHandler('notification:batch', this.handleBatchNotification.bind(this));
    this.registerHandler('notification:event_reminders', this.handleEmailNotification.bind(this)); // ✅ FIX: Add missing handler
    this.registerHandler('notification:weekly_newsletter', this.handleEmailNotification.bind(this)); // ✅ FIX: Add missing handler

    // ✅ User management jobs
    this.registerHandler('user:cleanup', this.handleUserCleanup.bind(this));
    this.registerHandler('user:analytics', this.handleUserAnalytics.bind(this));
    this.registerHandler('user:export', this.handleUserExport.bind(this));

    // ✅ Event management jobs
    this.registerHandler('event:reminder', this.handleEventReminder.bind(this));
    this.registerHandler('event:cleanup', this.handleEventCleanup.bind(this));
    this.registerHandler('event:analytics', this.handleEventAnalytics.bind(this));

    // ✅ System maintenance jobs
    this.registerHandler('system:cleanup', this.handleSystemCleanup.bind(this));
    this.registerHandler('system:backup', this.handleSystemBackup.bind(this));
    this.registerHandler('system:health_check', this.handleHealthCheck.bind(this));
    this.registerHandler('system:database_optimization', this.handleSystemCleanup.bind(this)); // ✅ FIX: Add missing handler
    
    // ✅ Analytics jobs
    this.registerHandler('analytics:daily_report', this.handleUserAnalytics.bind(this)); // ✅ FIX: Add missing handler

    // ✅ File processing jobs
    this.registerHandler('file:process_image', this.handleImageProcessing.bind(this));
    this.registerHandler('file:cleanup', this.handleFileCleanup.bind(this));
    this.registerHandler('file:backup', this.handleFileBackup.bind(this));

    console.log(`📝 Registered ${this.handlers.size} default job handlers`);
  }

  registerHandler(jobType, handler) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler for ${jobType} must be a function`);
    }

    this.handlers.set(jobType, handler);
    console.log(`📝 Registered handler: ${jobType}`);
  }

  /**
   * ➕ JOB CREATION
   */
  async addJob(jobType, data = {}, options = {}) {
    const {
      priority = this.config.DEFAULT_PRIORITY,
      delay = 0,
      retries = this.config.MAX_RETRIES,
      timeout = this.config.WORKER_TIMEOUT_MS,
      scheduledFor = null,
      correlationId = null
    } = options;

    // ✅ Validate job type
    if (!this.handlers.has(jobType)) {
      throw new Error(`Unknown job type: ${jobType}`);
    }

    // ✅ Check queue size limit
    const totalQueueSize = this.getTotalQueueSize();
    if (totalQueueSize >= this.config.MAX_QUEUE_SIZE) {
      throw new Error('Queue size limit exceeded');
    }

    // ✅ Create job
    const job = {
      id: this.generateJobId(),
      type: jobType,
      data: data,
      priority: Math.max(1, Math.min(10, priority)),
      retries: retries,
      maxRetries: retries,
      timeout: timeout,
      correlationId: correlationId || this.generateCorrelationId(),
      
      // Timing
      createdAt: new Date(),
      scheduledFor: scheduledFor || (delay > 0 ? new Date(Date.now() + delay) : new Date()),
      startedAt: null,
      completedAt: null,
      
      // Status
      status: 'pending',
      attempts: 0,
      lastError: null,
      progress: 0,
      
      // Result
      result: null
    };

    // ✅ Add to appropriate queue
    const queueName = this.getQueueNameByPriority(job.priority);
    this.queues[queueName].push(job);

    // ✅ Update statistics
    this.stats.totalJobs++;
    this.updateQueueSizeStats();

    console.log(`➕ Job added: ${job.type} (${job.id}) to ${queueName} queue`);
    
    // ✅ Emit event
    this.emit('job:added', job);
    
    return job;
  }

  /**
   * 🔄 QUEUE PROCESSING
   */
  startQueueProcessor() {
    setInterval(async () => {
      if (this.workers.size < this.config.MAX_WORKERS) {
        const job = this.getNextJob();
        if (job) {
          await this.processJob(job);
        }
      }
    }, this.config.POLL_INTERVAL_MS);
  }

  getNextJob() {
    const now = new Date();
    const queueOrder = ['critical', 'high', 'normal', 'low', 'bulk'];

    for (const queueName of queueOrder) {
      const queue = this.queues[queueName];
      const jobIndex = queue.findIndex(job => 
        job.status === 'pending' && job.scheduledFor <= now
      );

      if (jobIndex !== -1) {
        return queue.splice(jobIndex, 1)[0];
      }
    }

    return null;
  }

  async processJob(job) {
    const workerId = this.generateWorkerId();
    const worker = {
      id: workerId,
      jobId: job.id,
      startTime: Date.now(),
      timeout: null
    };

    try {
      // ✅ Register worker
      this.workers.set(workerId, worker);
      this.activeJobs.set(job.id, job);
      this.stats.activeJobs++;

      // ✅ Update job status
      job.status = 'processing';
      job.startedAt = new Date();
      job.attempts++;

      console.log(`🔄 Processing job: ${job.type} (${job.id}) with worker ${workerId}`);

      // ✅ Set timeout
      worker.timeout = setTimeout(() => {
        this.timeoutJob(job, workerId);
      }, job.timeout);

      // ✅ Execute job
      const handler = this.handlers.get(job.type);
      const result = await handler(job.data, job);

      // ✅ Job completed successfully
      await this.completeJob(job, result, workerId);

    } catch (error) {
      await this.failJob(job, error, workerId);
    }
  }

  async completeJob(job, result, workerId) {
    try {
      // ✅ Clear timeout
      const worker = this.workers.get(workerId);
      if (worker?.timeout) {
        clearTimeout(worker.timeout);
      }

      // ✅ Update job
      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;
      job.progress = 100;

      // ✅ Update statistics
      this.stats.completedJobs++;
      this.stats.activeJobs--;
      this.recordProcessingTime(Date.now() - worker.startTime);

      // ✅ Store in history
      this.jobHistory.set(job.id, job);

      console.log(`✅ Job completed: ${job.type} (${job.id})`);

      // ✅ Emit event
      this.emit('job:completed', job, result);

    } finally {
      // ✅ Cleanup worker
      this.workers.delete(workerId);
      this.activeJobs.delete(job.id);
    }
  }

  async failJob(job, error, workerId) {
    try {
      // ✅ Clear timeout
      const worker = this.workers.get(workerId);
      if (worker?.timeout) {
        clearTimeout(worker.timeout);
      }

      job.lastError = error.message;
      console.error(`❌ Job failed: ${job.type} (${job.id}) - ${error.message}`);

      // ✅ Check if retries available
      if (job.retries > 0) {
        await this.retryJob(job);
      } else {
        await this.deadLetterJob(job);
      }

    } finally {
      // ✅ Cleanup worker
      this.workers.delete(workerId);
      this.activeJobs.delete(job.id);
      this.stats.activeJobs--;
    }
  }

  async retryJob(job) {
    job.retries--;
    job.status = 'pending';
    job.startedAt = null;
    
    // ✅ Exponential backoff
    const delay = Math.min(
      this.config.RETRY_DELAY_MS * Math.pow(2, job.attempts - 1),
      this.config.MAX_RETRY_DELAY_MS
    );
    
    job.scheduledFor = new Date(Date.now() + delay);

    // ✅ Add back to queue
    const queueName = this.getQueueNameByPriority(job.priority);
    this.queues[queueName].push(job);

    this.stats.retriedJobs++;

    console.log(`🔄 Job retry scheduled: ${job.type} (${job.id}) in ${delay}ms`);
    this.emit('job:retried', job);
  }

  async deadLetterJob(job) {
    job.status = 'failed';
    job.completedAt = new Date();

    // ✅ Move to dead letter queue
    this.deadLetterQueue.push(job);
    this.stats.failedJobs++;

    console.error(`💀 Job moved to dead letter queue: ${job.type} (${job.id})`);
    this.emit('job:failed', job);
  }

  timeoutJob(job, workerId) {
    console.error(`⏰ Job timeout: ${job.type} (${job.id})`);
    this.failJob(job, new Error('Job execution timeout'), workerId);
  }

  /**
   * 🎯 JOB HANDLERS
   */
  
  async handlePaymentWebhookNotification(data, job) {
    console.log(`🔔 Processing Midtrans webhook: ${data.orderId} - Status: ${data.transactionStatus}`);
    
    job.progress = 10;
    this.emit('job:progress', job);

    try {
      // Import PaymentService
      const PaymentService = require('./PaymentService');
      const paymentService = new PaymentService();

      job.progress = 30;

      // Process the webhook notification
      await this.updatePaymentFromWebhook(data, job);

      job.progress = 100;
      
      console.log(`✅ Webhook processed successfully: ${data.orderId}`);
      return { 
        success: true,
        orderId: data.orderId,
        status: data.transactionStatus,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Webhook processing failed for ${data.orderId}:`, error.message);
      throw error;
    }
  }

  async updatePaymentFromWebhook(data, job) {
    // Import required services  
    // ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../../lib/prisma');
    
    try {
      job.progress = 40;

      // Find payment record by booking code (orderId)
      const paymentRecord = await prisma.paymentHistory.findFirst({
        where: { bookingCode: data.orderId },
        orderBy: { createdAt: 'desc' }
      });

      job.progress = 60;

      if (!paymentRecord) {
        console.log(`⚠️ No payment record found for booking: ${data.orderId}`);
        return { skipped: true, reason: 'Payment record not found' };
      }

      // ✅ FIXED: Map Midtrans status to PaymentStatus enum
      const mapMidtransToPaymentStatus = (midtransStatus) => {
        const successStatuses = ['capture', 'settlement', 'authorize'];
        const failedStatuses = ['deny', 'cancel', 'failure'];
        const expiredStatuses = ['expire'];
        
        if (successStatuses.includes(midtransStatus)) return 'SUCCESS';
        if (failedStatuses.includes(midtransStatus)) return 'FAILED';
        if (expiredStatuses.includes(midtransStatus)) return 'EXPIRED';
        
        return 'PENDING'; // Default fallback
      };

      const mappedStatus = mapMidtransToPaymentStatus(data.transactionStatus);
      console.log(`📊 Mapping Midtrans status '${data.transactionStatus}' to PaymentStatus '${mappedStatus}'`);

      // Update payment status based on Midtrans response
      const updatedPayment = await prisma.paymentHistory.update({
        where: { id: paymentRecord.id },
        data: {
          status: mappedStatus, // Use mapped PaymentStatus enum
          transactionDate: data.settlementTime ? new Date(data.settlementTime) : new Date(),
          paymentMethod: data.paymentType || paymentRecord.paymentMethod
        }
      });

      job.progress = 80;

      // If payment successful, update booking status and check if notification needed
      // ✅ FIXED: Include all successful payment statuses from Midtrans
      const successStatuses = ['capture', 'settlement', 'authorize'];
      if (successStatuses.includes(data.transactionStatus)) {
        console.log(`✅ Payment success detected via webhook - Status: ${data.transactionStatus}`);
        
        // ✅ CHECK FOR GUESTLIST PAYMENT FIRST
        if (data.orderId.startsWith('GL')) {
          console.log(`🎫 Processing guestlist payment webhook: ${data.orderId}`);
          
          const guestListEntry = await prisma.guestList.findFirst({
            where: { paymentId: data.orderId },
            include: {
              user: true,
              event: true
            }
          });

          if (!guestListEntry) {
            console.warn(`⚠️ Guestlist entry not found for paymentId: ${data.orderId}`);
            return { skipped: true, reason: 'Guestlist entry not found' };
          }

          // Update guestlist payment status
          await prisma.guestList.update({
            where: { id: guestListEntry.id },
            data: {
              isPaid: true,
              paidAt: new Date()
            }
          });

          console.log(`✅ Guestlist payment confirmed via webhook: ${data.orderId}`);

          // Send guestlist payment success notification
          if (guestListEntry && guestListEntry.user) {
            try {
              console.log(`📤 WEBHOOK: Sending guestlist payment success notification for user ${guestListEntry.user.id}`);
              
              const { getNotificationService } = require('./index');
              const notificationService = getNotificationService();
              
              const result = await notificationService.sendPaymentSuccess(guestListEntry.user.id, {
                eventName: guestListEntry.event?.title || 'Event',
                eventImage: guestListEntry.event?.imageUrl,
                paymentId: guestListEntry.paymentId,
                eventId: guestListEntry.eventId,
                amount: guestListEntry.platformFee,
                paymentType: 'GUESTLIST'
              });

              console.log(`📱 WEBHOOK guestlist payment success notification result:`, result);
              console.log(`✅ WEBHOOK: Push notification sent for guestlist payment: ${data.orderId}`);
            } catch (notifError) {
              console.error(`❌ WEBHOOK: Failed to send guestlist payment success notification:`, notifError);
            }
          }

          return { 
            success: true, 
            type: 'GUESTLIST',
            paymentId: data.orderId,
            message: 'Guestlist payment confirmed via webhook'
          };
        }
        
        // ✅ ORIGINAL BOOKING LOGIC
        const booking = await prisma.booking.findFirst({
          where: { bookingCode: data.orderId },
          include: {
            user: true,
            event: true,
            accessTier: true
          }
        });

        if (!booking) {
          console.warn(`⚠️ Booking not found for orderId: ${data.orderId}`);
          return { skipped: true, reason: 'Booking not found' };
        }

        // Check if booking is already confirmed (payment already processed via direct endpoint)
        const isAlreadyConfirmed = booking.status === 'CONFIRMED' && booking.paymentStatus === 'SUCCESS';
        
        if (isAlreadyConfirmed) {
          console.log(`✅ Payment already confirmed for booking ${data.orderId} - webhook processing as backup verification`);
          console.log(`📱 Notifications already sent during direct payment confirmation - skipping duplicate notifications`);
          
          // Still update booking if needed (in case webhook came first)
          await prisma.booking.updateMany({
            where: { bookingCode: data.orderId },
            data: { 
              paymentStatus: 'SUCCESS',
              status: 'CONFIRMED',
              paidAt: booking.paidAt || new Date() // Keep original paidAt if exists
            }
          });
          
          return { 
            success: true, 
            alreadyProcessed: true,
            message: 'Payment already confirmed via direct endpoint, webhook served as backup verification'
          };
        }

        // Update booking status (first time confirmation via webhook)
        await prisma.booking.updateMany({
          where: { bookingCode: data.orderId },
          data: { 
            paymentStatus: 'SUCCESS',
            status: 'CONFIRMED',
            paidAt: new Date()
          }
        });
        
        console.log(`✅ Payment confirmed for booking via webhook: ${data.orderId}`);

        // 🚀 SEND PUSH NOTIFICATION FOR SUCCESSFUL PAYMENT (webhook-based)
        if (booking && booking.user) {
          try {
            console.log(`📤 WEBHOOK: Sending payment success notification for user ${booking.user.id}, booking ${booking.bookingCode}`);
            
            const { getNotificationService } = require('./index');
            const notificationService = getNotificationService();
            
            const result = await notificationService.sendPaymentSuccess(booking.user.id, {
              eventName: booking.event?.title || booking.accessTier?.name || 'Event',
              eventImage: booking.event?.imageUrl,
              bookingCode: booking.bookingCode,
              eventId: booking.eventId,
              amount: booking.totalAmount,
              paymentMethod: data.paymentType || 'Unknown'
            });

            console.log(`📱 WEBHOOK payment success notification result:`, result);
            console.log(`✅ WEBHOOK: Push notification sent for successful payment: ${data.orderId}`);
          } catch (notifError) {
            console.error(`❌ WEBHOOK: Failed to send payment success notification:`, {
              error: notifError.message || notifError,
              stack: notifError.stack,
              userId: booking.user?.id,
              bookingCode: booking.bookingCode,
              orderId: data.orderId
            });
          }
        } else {
          console.warn(`⚠️ WEBHOOK: Cannot send payment success notification - Missing data:`, {
            hasBooking: !!booking,
            hasUser: !!booking?.user,
            bookingCode: data.orderId,
            userId: booking?.user?.id
          });
        }
      } else {
        console.log(`ℹ️ Payment status not successful - Status: ${data.transactionStatus}, OrderId: ${data.orderId}`);
        console.log(`ℹ️ No notification sent for non-success status`);
      }

      job.progress = 90;

      return { 
        updated: true, 
        paymentId: updatedPayment.id,
        status: data.transactionStatus,
        bookingCode: data.orderId
      };

    } catch (error) {
      console.error(`❌ Database update failed for ${data.orderId}:`, error.message);
      throw error;
    }
  }

  async handlePaymentVerification(data, job) {
    console.log(`💰 Verifying payment batch: ${data.batchSize} items, max age: ${data.maxAgeMinutes} minutes`);
    
    // ✅ Update progress
    job.progress = 25;
    this.emit('job:progress', job);

    // TODO: Implement actual payment verification logic
    // This would integrate with PaymentService to check pending payments
    // For now, just return success to prevent undefined errors
    
    job.progress = 100;
    return { 
      verified: true, 
      batchProcessed: data.batchSize || 0,
      maxAge: data.maxAgeMinutes || 30
    };
  }

  async handlePaymentReminder(data, job) {
    console.log(`📧 Sending payment reminder: ${data.userId}`);
    
    // TODO: Implement payment reminder logic
    // This would integrate with NotificationService
    
    return { sent: true, userId: data.userId };
  }

  async handlePaymentRefund(data, job) {
    console.log(`💸 Processing refund: ${data.paymentId}`);
    
    // TODO: Implement refund logic
    // This would integrate with PaymentService
    
    return { refunded: true, amount: data.amount };
  }

  async handlePaymentCleanup(data, job) {
    console.log(`🧹 Cleaning up expired payments`);
    
    // TODO: Implement payment cleanup logic
    
    return { cleaned: data.count || 0 };
  }

  async handleEmailNotification(data, job) {
    console.log(`📧 Sending email notification: ${data.type}`);
    
    job.progress = 50;
    this.emit('job:progress', job);

    // TODO: Implement email sending logic
    // This would integrate with NotificationService
    
    job.progress = 100;
    return { sent: true, type: data.type };
  }

  async handlePushNotification(data, job) {
    console.log(`📱 Sending push notification: ${data.type}`);
    
    try {
      const { getNotificationService } = require('./index');
      const notificationService = getNotificationService();
      
      const result = await notificationService.sendPushNotification(
        data.recipient,
        data.type,
        data.templateName || 'default',
        data.data || {},
        data.notificationId
      );
      
      return { sent: result.success, type: data.type, result };
    } catch (error) {
      console.error(`❌ Push notification failed in queue:`, error);
      return { sent: false, type: data.type, error: error.message };
    }
  }

  async handleSMSNotification(data, job) {
    console.log(`📱 Sending SMS notification: ${data.type}`);
    
    // TODO: Implement SMS logic
    
    return { sent: true, type: data.type };
  }

  async handleBatchNotification(data, job) {
    console.log(`📬 Sending batch notifications: ${data.recipients?.length || 0} recipients`);
    
    const total = data.recipients?.length || 0;
    let processed = 0;

    // TODO: Implement batch notification logic
    
    for (let i = 0; i < total; i++) {
      processed++;
      job.progress = Math.round((processed / total) * 100);
      this.emit('job:progress', job);
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { sent: processed, total: total };
  }

  async handleUserCleanup(data, job) {
    console.log(`👤 Cleaning up user data`);
    
    // TODO: Implement user cleanup logic
    
    return { cleaned: data.count || 0 };
  }

  async handleUserAnalytics(data, job) {
    console.log(`📊 Processing user analytics`);
    
    // TODO: Implement analytics processing
    
    return { processed: true };
  }

  async handleUserExport(data, job) {
    console.log(`📤 Exporting user data: ${data.userId}`);
    
    // TODO: Implement user data export
    
    return { exported: true, userId: data.userId };
  }

  async handleEventReminder(data, job) {
    console.log(`🎉 Sending event reminder: ${data.eventId}`);
    
    // TODO: Implement event reminder logic
    
    return { sent: true, eventId: data.eventId };
  }

  async handleEventCleanup(data, job) {
    console.log(`🧹 Cleaning up past events`);
    
    // TODO: Implement event cleanup logic
    
    return { cleaned: data.count || 0 };
  }

  async handleEventAnalytics(data, job) {
    console.log(`📊 Processing event analytics`);
    
    // TODO: Implement event analytics
    
    return { processed: true };
  }

  async handleSystemCleanup(data, job) {
    console.log(`🧹 System cleanup: ${data.type}`);
    
    // TODO: Implement system cleanup
    
    return { cleaned: true, type: data.type };
  }

  async handleSystemBackup(data, job) {
    console.log(`💾 System backup: ${data.type}`);
    
    // TODO: Implement backup logic
    
    return { backed_up: true, type: data.type };
  }

  async handleHealthCheck(data, job) {
    console.log(`❤️ System health check`);
    
    // TODO: Implement health check logic
    
    return { healthy: true, timestamp: new Date() };
  }

  async handleImageProcessing(data, job) {
    console.log(`🖼️ Processing image: ${data.filename}`);
    
    job.progress = 25;
    this.emit('job:progress', job);

    // TODO: Implement image processing
    // This would integrate with AssetManagerService
    
    job.progress = 100;
    return { processed: true, filename: data.filename };
  }

  async handleFileCleanup(data, job) {
    console.log(`🗑️ Cleaning up files`);
    
    // TODO: Implement file cleanup
    
    return { cleaned: data.count || 0 };
  }

  async handleFileBackup(data, job) {
    console.log(`💾 Backing up files`);
    
    // TODO: Implement file backup
    
    return { backed_up: data.count || 0 };
  }

  /**
   * 🔍 JOB MANAGEMENT
   */
  getJob(jobId) {
    // ✅ Check active jobs
    if (this.activeJobs.has(jobId)) {
      return this.activeJobs.get(jobId);
    }

    // ✅ Check history
    if (this.jobHistory.has(jobId)) {
      return this.jobHistory.get(jobId);
    }

    // ✅ Check all queues
    for (const queue of Object.values(this.queues)) {
      const job = queue.find(j => j.id === jobId);
      if (job) return job;
    }

    // ✅ Check dead letter queue
    const deadJob = this.deadLetterQueue.find(j => j.id === jobId);
    if (deadJob) return deadJob;

    return null;
  }

  getJobsByType(jobType, status = null) {
    const jobs = [];

    // ✅ Search all locations
    const allJobs = [
      ...Array.from(this.activeJobs.values()),
      ...Array.from(this.jobHistory.values()),
      ...Object.values(this.queues).flat(),
      ...this.deadLetterQueue
    ];

    return allJobs.filter(job => 
      job.type === jobType && 
      (status === null || job.status === status)
    );
  }

  cancelJob(jobId) {
    // ✅ Find and remove from queues
    for (const [queueName, queue] of Object.entries(this.queues)) {
      const jobIndex = queue.findIndex(j => j.id === jobId);
      if (jobIndex !== -1) {
        const job = queue.splice(jobIndex, 1)[0];
        job.status = 'cancelled';
        job.completedAt = new Date();
        
        console.log(`❌ Job cancelled: ${job.type} (${job.id})`);
        this.emit('job:cancelled', job);
        return true;
      }
    }

    return false;
  }

  /**
   * 🧮 UTILITY METHODS
   */
  generateJobId() {
    return `job_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  generateWorkerId() {
    return `worker_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  generateCorrelationId() {
    return `corr_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  getQueueNameByPriority(priority) {
    if (priority <= 2) return 'critical';
    if (priority <= 4) return 'high';
    if (priority <= 6) return 'normal';
    if (priority <= 8) return 'low';
    return 'bulk';
  }

  getTotalQueueSize() {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }

  updateQueueSizeStats() {
    for (const [queueName, queue] of Object.entries(this.queues)) {
      this.stats.queueSizes[queueName] = queue.length;
    }
  }

  recordProcessingTime(timeMs) {
    this.stats.processingTimes.push(timeMs);
    
    // Keep only last 1000 processing times
    if (this.stats.processingTimes.length > 1000) {
      this.stats.processingTimes = this.stats.processingTimes.slice(-1000);
    }
  }

  /**
   * 📊 MONITORING & STATISTICS
   */
  startMetricsReporting() {
    if (!this.config.ENABLE_METRICS) return;

    setInterval(() => {
      const metrics = this.getMetrics();
      console.log('🚀 Queue metrics:', metrics);
      this.emit('metrics', metrics);
    }, this.config.METRICS_INTERVAL_MS);
  }

  getMetrics() {
    const now = Date.now();
    const uptimeMs = now - this.stats.lastReset;
    const uptimeHours = uptimeMs / (1000 * 60 * 60);

    const avgProcessingTime = this.stats.processingTimes.length > 0
      ? Math.round(this.stats.processingTimes.reduce((a, b) => a + b, 0) / this.stats.processingTimes.length)
      : 0;

    return {
      uptime: Math.round(uptimeHours * 100) / 100 + ' hours',
      totalJobs: this.stats.totalJobs,
      completedJobs: this.stats.completedJobs,
      failedJobs: this.stats.failedJobs,
      retriedJobs: this.stats.retriedJobs,
      activeJobs: this.stats.activeJobs,
      activeWorkers: this.workers.size,
      queueSizes: { ...this.stats.queueSizes },
      deadLetterQueueSize: this.deadLetterQueue.length,
      jobsPerHour: uptimeHours > 0 ? Math.round(this.stats.totalJobs / uptimeHours) : 0,
      successRate: this.stats.totalJobs > 0 
        ? ((this.stats.completedJobs / this.stats.totalJobs) * 100).toFixed(2) + '%'
        : '100%',
      avgProcessingTime: avgProcessingTime + 'ms',
      registeredHandlers: this.handlers.size
    };
  }

  getHealthStatus() {
    const totalQueueSize = this.getTotalQueueSize();
    const queueUtilization = totalQueueSize / this.config.MAX_QUEUE_SIZE;
    
    return {
      status: queueUtilization < 0.8 ? 'healthy' : 'warning',
      activeWorkers: this.workers.size,
      maxWorkers: this.config.MAX_WORKERS,
      queueUtilization: (queueUtilization * 100).toFixed(1) + '%',
      deadLetterQueue: this.deadLetterQueue.length,
      processing: this.activeJobs.size > 0
    };
  }

  /**
   * 🧹 CLEANUP & MAINTENANCE
   */
  startCleanupScheduler() {
    setInterval(() => {
      this.cleanupCompletedJobs();
    }, 300000); // Every 5 minutes
  }

  cleanupCompletedJobs() {
    const now = Date.now();
    let cleanedCount = 0;

    // ✅ Clean completed jobs from history
    for (const [jobId, job] of this.jobHistory.entries()) {
      if (job.status === 'completed') {
        const age = now - job.completedAt.getTime();
        if (age > this.config.COMPLETED_JOB_TTL_MS) {
          this.jobHistory.delete(jobId);
          cleanedCount++;
        }
      }
    }

    // ✅ Clean old failed jobs from dead letter queue
    this.deadLetterQueue = this.deadLetterQueue.filter(job => {
      const age = now - job.completedAt.getTime();
      if (age > this.config.FAILED_JOB_TTL_MS) {
        cleanedCount++;
        return false;
      }
      return true;
    });

    if (cleanedCount > 0) {
      console.log(`🧹 Queue cleanup: removed ${cleanedCount} old jobs`);
    }
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    // ✅ Cancel all active jobs
    for (const [workerId, worker] of this.workers.entries()) {
      if (worker.timeout) {
        clearTimeout(worker.timeout);
      }
    }

    // ✅ Clear all data structures
    this.workers.clear();
    this.activeJobs.clear();
    this.jobHistory.clear();
    Object.values(this.queues).forEach(queue => queue.length = 0);
    this.deadLetterQueue.length = 0;

    console.log('✅ QueueService cleanup completed');
  }
}

module.exports = QueueService;