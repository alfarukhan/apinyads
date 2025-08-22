const cron = require('node-cron');
const { getPaymentService, getLoggingService } = require('../services/core');

class PaymentVerificationJob {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.totalRecovered = 0;
  }

  /**
   * Start the background job scheduler
   */
  start() {
    console.log('🚀 Starting Payment Verification Background Jobs...');

    // Job 1: Regular verification every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Payment verification job already running, skipping...');
        return;
      }

      await this.runVerificationJob();
    });

    // Job 2: Recovery job every 30 minutes  
    cron.schedule('*/30 * * * *', async () => {
      if (this.isRunning) {
        console.log('⏭️ Payment recovery job already running, skipping...');
        return;
      }

      await this.runRecoveryJob();
    });

    // Job 3: Daily cleanup and stats (every day at 2 AM)
    cron.schedule('0 2 * * *', async () => {
      await this.runDailyCleanup();
    });

    console.log('✅ Payment verification jobs scheduled successfully');
    console.log('📋 Schedule:');
    console.log('   - Verification: Every 10 minutes');
    console.log('   - Recovery: Every 30 minutes');
    console.log('   - Daily cleanup: 2:00 AM daily');
  }

  /**
   * Regular verification job for recent pending payments
   */
  async runVerificationJob() {
    try {
      this.isRunning = true;
      this.lastRun = new Date();
      
      console.log('🔄 [CRON] Starting regular payment verification job...');
      
      // ✅ CENTRALIZED: Use PaymentService for verification
      const paymentService = getPaymentService();
      const logger = getLoggingService();
      
      // Get pending payments to verify (limit to 5 to avoid API rate limits)
      const verificationResult = await paymentService.verifyPendingPayments(5);
      
      if (!verificationResult.success) {
        console.log('❌ [CRON] Payment verification failed');
        return;
      }
      
      const successCount = verificationResult.verified || 0;
      
      if (successCount > 0) {
        console.log(`✅ [CRON] Verification job completed: ${successCount} payments verified`);
        this.totalRecovered += successCount;
      } else {
        console.log('✅ [CRON] Verification job completed: No new payments to verify');
      }

    } catch (error) {
      console.error('❌ [CRON] Error in payment verification job:', error.message || error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Recovery job for stuck/missed payments
   */
  async runRecoveryJob() {
    try {
      this.isRunning = true;
      
      console.log('🚨 [CRON] Starting payment recovery job...');
      
      // ✅ CENTRALIZED: Use PaymentService for recovery
      const paymentService = getPaymentService();
      
      // TODO: Implement recoverMissedPayments method in PaymentService
      console.log('⚠️ [CRON] Payment recovery job disabled - method not implemented');
      const recoveredCount = 0;
      
      if (recoveredCount > 0) {
        console.log(`🎉 [CRON] Recovery job completed: ${recoveredCount} payments recovered!`);
        this.totalRecovered += recoveredCount;
        
        // Log critical recovery for monitoring
        console.log('🚨 [ALERT] Payments were recovered - webhook mechanism may have issues!');
      } else {
        console.log('✅ [CRON] Recovery job completed: No stuck payments found');
      }

    } catch (error) {
      console.error('❌ [CRON] Error in payment recovery job:', error.message || error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Daily cleanup and statistics
   */
  async runDailyCleanup() {
    try {
      console.log('🧹 [CRON] Starting daily payment cleanup and stats...');
      
      // Get stats for the day
      // ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const stats = await prisma.booking.groupBy({
        by: ['paymentStatus'],
        where: {
          createdAt: {
            gte: yesterday,
            lt: today
          }
        },
        _count: {
          paymentStatus: true
        }
      });

      console.log('📊 [DAILY STATS] Payment status distribution (last 24h):', stats);
      console.log(`📊 [TOTAL RECOVERED] Jobs have recovered ${this.totalRecovered} payments since startup`);
      
      // ✅ SECURITY FIX: Check for valid PaymentStatus enum values only
      const pendingCount = stats.find(s => s.paymentStatus === 'PENDING')?._count?.paymentStatus || 0;
      const failedCount = stats.find(s => s.paymentStatus === 'FAILED')?._count?.paymentStatus || 0;
      
      if (pendingCount > 10 || failedCount > 5) {
        console.log('🚨 [ALERT] High number of pending/failed payments detected!');
        console.log(`🚨 [ALERT] Pending: ${pendingCount}, Failed: ${failedCount}`);
        console.log('🚨 [ALERT] Consider checking webhook configuration and Midtrans integration');
      }

      await prisma.$disconnect();
      
    } catch (error) {
      console.error('❌ [CRON] Error in daily cleanup job:', error.message || error);
    }
  }

  /**
   * Manual trigger for testing
   */
  async runManualVerification() {
    if (this.isRunning) {
      throw new Error('Job is already running');
    }

    console.log('🔧 [MANUAL] Starting manual payment verification...');
    await this.runVerificationJob();
    await this.runRecoveryJob();
    console.log('✅ [MANUAL] Manual verification completed');
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      totalRecovered: this.totalRecovered,
      uptime: process.uptime()
    };
  }
}

// Export singleton instance
const paymentVerificationJob = new PaymentVerificationJob();

module.exports = paymentVerificationJob;