const PaymentIntentService = require('../services/secure/PaymentIntentService');
const StockReservationService = require('../services/secure/StockReservationService');
const { prisma } = require('../lib/prisma');

/**
 * ⚙️ SECURITY CLEANUP JOB
 * 
 * Automated background tasks for:
 * - Expired payment intent cleanup
 * - Expired stock reservation release
 * - Payment lock cleanup
 * - Webhook log maintenance
 * - Security audit log rotation
 */
class SecurityCleanupJob {
  constructor() {
    this.paymentIntentService = new PaymentIntentService();
    this.stockReservationService = new StockReservationService();
    this.isRunning = false;
    this.jobInterval = null;
  }

  /**
   * 🚀 START SECURITY CLEANUP JOB
   * Runs every 2 minutes for critical security maintenance
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Security cleanup job already running');
      return;
    }

    console.log('🚀 Starting security cleanup job (every 2 minutes)');
    this.isRunning = true;

    // Run immediately on start
    this.runCleanupCycle();

    // Schedule periodic cleanup
    this.jobInterval = setInterval(() => {
      this.runCleanupCycle();
    }, 2 * 60 * 1000); // Every 2 minutes
  }

  /**
   * 🛑 STOP SECURITY CLEANUP JOB
   */
  stop() {
    if (this.jobInterval) {
      clearInterval(this.jobInterval);
      this.jobInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Security cleanup job stopped');
  }

  /**
   * 🔄 RUN COMPLETE CLEANUP CYCLE
   */
  async runCleanupCycle() {
    const startTime = Date.now();
    console.log('🧹 Starting security cleanup cycle...');

    try {
      // Run all cleanup tasks in parallel for efficiency
      const [
        paymentLockCleanup,
        stockReservationCleanup,
        webhookLogCleanup,
        expiredBookingCleanup,
        auditLogCleanup
      ] = await Promise.allSettled([
        this.cleanupExpiredPaymentLocks(),
        this.cleanupExpiredStockReservations(),
        this.cleanupOldWebhookLogs(),
        this.cleanupExpiredBookings(),
        this.rotateAuditLogs()
      ]);

      // Log results
      const duration = Date.now() - startTime;
      console.log(`✅ Security cleanup cycle completed in ${duration}ms`);
      
      this.logCleanupResults({
        paymentLockCleanup,
        stockReservationCleanup,
        webhookLogCleanup,
        expiredBookingCleanup,
        auditLogCleanup,
        duration
      });

    } catch (error) {
      console.error('❌ Security cleanup cycle failed:', error);
    }
  }

  /**
   * 🔓 CLEANUP EXPIRED PAYMENT LOCKS
   */
  async cleanupExpiredPaymentLocks() {
    try {
      await this.paymentIntentService.cleanupExpiredLocks();
      
      // Also cleanup expired payment intents
      const expiredIntents = await prisma.paymentIntent.findMany({
        where: {
          status: { in: ['PENDING', 'PROCESSING'] },
          expiresAt: { lt: new Date() }
        }
      });

      let cleanedIntents = 0;
      for (const intent of expiredIntents) {
        try {
          await this.paymentIntentService.updatePaymentIntentStatus(
            intent.id,
            'CANCELLED'
          );
          cleanedIntents++;
        } catch (error) {
          console.error(`❌ Error cancelling expired intent ${intent.id}:`, error);
        }
      }

      return { 
        success: true, 
        cleanedIntents,
        totalExpired: expiredIntents.length 
      };
    } catch (error) {
      console.error('❌ Payment lock cleanup error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 🎫 CLEANUP EXPIRED STOCK RESERVATIONS
   */
  async cleanupExpiredStockReservations() {
    try {
      const result = await this.stockReservationService.cleanupExpiredReservations();
      return { success: true, ...result };
    } catch (error) {
      console.error('❌ Stock reservation cleanup error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 🔔 CLEANUP OLD WEBHOOK LOGS
   * Remove webhook logs older than 7 days (batch processing for performance)
   */
  async cleanupOldWebhookLogs() {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const batchSize = 500; // Process in smaller batches
      let totalCleaned = 0;
      
      while (true) {
        // Find batch of old logs to delete
        const oldLogs = await prisma.webhookLog.findMany({
          where: {
            processedAt: { lt: sevenDaysAgo }
          },
          select: { id: true },
          take: batchSize
        });

        if (oldLogs.length === 0) break;

        // Delete batch
        const deletedLogs = await prisma.webhookLog.deleteMany({
          where: {
            id: { in: oldLogs.map(log => log.id) }
          }
        });

        totalCleaned += deletedLogs.count;
        
        // Small delay between batches to prevent database overload
        if (oldLogs.length === batchSize) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`🧹 Cleaned up ${totalCleaned} old webhook logs (batch processed)`);
      return { success: true, cleaned: totalCleaned };
    } catch (error) {
      console.error('❌ Webhook log cleanup error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📋 CLEANUP EXPIRED BOOKINGS
   * Remove or mark expired pending bookings (optimized with batch processing)
   */
  async cleanupExpiredBookings() {
    try {
      const batchSize = 50; // Smaller batch for transactions
      let totalCleaned = 0;
      let totalFound = 0;

      while (true) {
        // Find batch of expired bookings
        const expiredBookings = await prisma.booking.findMany({
          where: {
            status: 'PENDING',
            expiresAt: { lt: new Date() }
          },
          include: {
            accessTier: true
          },
          take: batchSize
        });

        if (expiredBookings.length === 0) break;
        totalFound += expiredBookings.length;

        // Process batch with individual transactions to avoid long locks
        for (const booking of expiredBookings) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  status: 'CANCELLED',
                  paymentStatus: 'EXPIRED'
                }
              });

              await tx.accessTier.update({
                where: { id: booking.accessTierId },
                data: {
                  soldQuantity: { decrement: booking.quantity },
                  availableQuantity: { increment: booking.quantity }
                }
              });
            });

            totalCleaned++;
          } catch (error) {
            console.error(`❌ Error cleaning booking ${booking.bookingCode}:`, error);
          }
        }

        // Small delay between batches
        if (expiredBookings.length === batchSize) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      console.log(`🧹 Cleaned up ${totalCleaned}/${totalFound} expired bookings (batch processed)`);
      return { success: true, cleaned: totalCleaned, total: totalFound };
    } catch (error) {
      console.error('❌ Expired booking cleanup error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📊 ROTATE AUDIT LOGS
   * Archive old audit logs to prevent database bloat
   */
  async rotateAuditLogs() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Count old logs for archiving
      const oldLogsCount = await prisma.auditLog.count({
        where: {
          createdAt: { lt: thirtyDaysAgo }
        }
      });

      if (oldLogsCount > 0) {
        // In production, you might want to archive these logs instead of deleting
        console.log(`📊 Found ${oldLogsCount} audit logs ready for archiving`);
        
        // For now, we'll keep them but add a marker for potential archiving
        await prisma.auditLog.updateMany({
          where: {
            createdAt: { lt: thirtyDaysAgo },
            archived: { not: true }
          },
          data: {
            archived: true
          }
        });

        console.log(`📊 Marked ${oldLogsCount} audit logs for archiving`);
      }

      return { success: true, markedForArchiving: oldLogsCount };
    } catch (error) {
      console.error('❌ Audit log rotation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 📋 LOG CLEANUP RESULTS
   */
  logCleanupResults(results) {
    console.log('📋 Security cleanup results:');
    
    Object.entries(results).forEach(([task, result]) => {
      if (task === 'duration') {
        console.log(`  ⏱️  Total duration: ${result}ms`);
        return;
      }

      if (result.status === 'fulfilled') {
        const data = result.value;
        if (data.success) {
          console.log(`  ✅ ${task}: Success`, data);
        } else {
          console.log(`  ❌ ${task}: Failed -`, data.error);
        }
      } else {
        console.log(`  ❌ ${task}: Rejected -`, result.reason);
      }
    });
  }

  /**
   * 📊 GET CLEANUP STATISTICS
   */
  async getCleanupStatistics() {
    try {
      const [
        totalPaymentIntents,
        expiredPaymentIntents,
        totalStockReservations,
        expiredStockReservations,
        totalWebhookLogs,
        oldWebhookLogs,
        pendingBookings,
        expiredBookings
      ] = await Promise.all([
        prisma.paymentIntent.count(),
        prisma.paymentIntent.count({
          where: {
            status: { in: ['PENDING', 'PROCESSING'] },
            expiresAt: { lt: new Date() }
          }
        }),
        prisma.stockReservation.count(),
        prisma.stockReservation.count({
          where: {
            status: 'RESERVED',
            expiresAt: { lt: new Date() }
          }
        }),
        prisma.webhookLog.count(),
        prisma.webhookLog.count({
          where: {
            processedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        }),
        prisma.booking.count({ where: { status: 'PENDING' } }),
        prisma.booking.count({
          where: {
            status: 'PENDING',
            expiresAt: { lt: new Date() }
          }
        })
      ]);

      return {
        paymentIntents: {
          total: totalPaymentIntents,
          expired: expiredPaymentIntents,
          healthScore: ((totalPaymentIntents - expiredPaymentIntents) / Math.max(totalPaymentIntents, 1) * 100).toFixed(1) + '%'
        },
        stockReservations: {
          total: totalStockReservations,
          expired: expiredStockReservations,
          healthScore: ((totalStockReservations - expiredStockReservations) / Math.max(totalStockReservations, 1) * 100).toFixed(1) + '%'
        },
        webhookLogs: {
          total: totalWebhookLogs,
          old: oldWebhookLogs,
          retention: '7 days'
        },
        bookings: {
          pending: pendingBookings,
          expired: expiredBookings,
          conversionRate: ((pendingBookings - expiredBookings) / Math.max(pendingBookings, 1) * 100).toFixed(1) + '%'
        },
        lastCleanup: new Date().toISOString(),
        isJobRunning: this.isRunning
      };
    } catch (error) {
      console.error('❌ Error getting cleanup statistics:', error);
      throw error;
    }
  }
}

module.exports = SecurityCleanupJob;