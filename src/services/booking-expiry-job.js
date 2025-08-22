const { PrismaClient } = require('@prisma/client');
const { getNotificationService, getLoggingService } = require('./core');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// Configuration
const BOOKING_EXPIRY_WARNING_MINUTES = parseInt(process.env.BOOKING_EXPIRY_WARNING_MINUTES) || 5;
const CLEANUP_INTERVAL_MINUTES = parseInt(process.env.CLEANUP_INTERVAL_MINUTES) || 2;

class BookingExpiryJob {
  constructor() {
    this.isRunning = false;
    this.warningInterval = null;
    this.cleanupInterval = null;
  }

  /**
   * Start the booking expiry monitoring
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Booking expiry job already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting booking expiry monitoring...');

    // Check for expiry warnings every 2 minutes
    this.warningInterval = setInterval(async () => {
      try {
        await this.checkExpiryWarnings();
          } catch (error) {
      console.error('❌ Error in expiry warning check:', error.message || error);
      }
    }, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

    // Check for expired bookings every 2 minutes  
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredBookings();
          } catch (error) {
      console.error('❌ Error in cleanup expired bookings:', error.message || error);
      }
    }, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

    console.log(`✅ Booking expiry job started with ${CLEANUP_INTERVAL_MINUTES} minute intervals`);
  }

  /**
   * Stop the booking expiry monitoring
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Booking expiry job not running');
      return;
    }

    if (this.warningInterval) {
      clearInterval(this.warningInterval);
      this.warningInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRunning = false;
    console.log('⏹️  Booking expiry job stopped');
  }

  /**
   * Check for bookings that need expiry warnings (5 minutes before expiry)
   */
  async checkExpiryWarnings() {
    const warningTime = new Date(Date.now() + BOOKING_EXPIRY_WARNING_MINUTES * 60 * 1000);
    const currentTime = new Date();

    console.log(`🔍 Checking for bookings needing expiry warnings...`);

    try {
      // Find bookings that will expire in 5 minutes and haven't been warned yet
      const bookingsNeedingWarning = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          paymentStatus: 'PENDING',
          expiresAt: {
            gte: currentTime,
            lte: warningTime
          },
          expiryWarningAt: null // Haven't sent warning yet
        },
        select: {
          id: true,
          userId: true, // ✅ CRITICAL: Include userId for notifications
          bookingCode: true,
          expiresAt: true,
          event: {
            select: {
              title: true,
              imageUrl: true
            }
          },
          accessTier: {
            select: {
              name: true
            }
          }
        },
        take: 50 // Process max 50 at a time
      });

      if (bookingsNeedingWarning.length > 0) {
        console.log(`⏰ Found ${bookingsNeedingWarning.length} bookings needing expiry warnings`);

        for (const booking of bookingsNeedingWarning) {
          try {
            // Send notification
            // ✅ CENTRALIZED: Use NotificationService
          const notificationService = getNotificationService();
          await notificationService.sendBookingExpiryWarning(booking.userId, {
              eventName: booking.event?.title || booking.accessTier?.name || 'Event',
              eventImage: booking.event?.imageUrl,
              bookingCode: booking.bookingCode
            });

            // Mark as warned
            await prisma.booking.update({
              where: { id: booking.id },
              data: { expiryWarningAt: new Date() }
            });

            console.log(`📱 Sent expiry warning for booking ${booking.bookingCode}`);

          } catch (error) {
            console.error(`❌ Error sending warning for booking ${booking.bookingCode}:`, error.message || error);
          }
        }
      }

    } catch (error) {
      console.error('❌ Error checking expiry warnings:', error.message || error);
    }
  }

  /**
   * Clean up expired bookings and release stock
   */
  async cleanupExpiredBookings() {
    const currentTime = new Date();

    console.log(`🧹 Checking for expired bookings to cleanup...`);

    try {
      // Find expired pending bookings
      const expiredBookings = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          paymentStatus: 'PENDING',
          expiresAt: {
            lt: currentTime
          }
        },
        select: {
          id: true,
          userId: true, // ✅ CRITICAL: Include userId for expiry notifications
          bookingCode: true,
          quantity: true,
          accessTierId: true,
          eventId: true,
          expiryWarningAt: true,
          accessTier: {
            select: {
              id: true,
              name: true
            }
          },
          event: {
            select: {
              title: true,
              imageUrl: true
            }
          }
        },
        take: 100 // Process max 100 at a time
      });

      if (expiredBookings.length > 0) {
        console.log(`⚠️  Found ${expiredBookings.length} expired bookings to cleanup`);

        // Process in transaction for atomicity
        await prisma.$transaction(async (tx) => {
          for (const booking of expiredBookings) {
            try {
              // Update booking status
              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  status: 'EXPIRED',
                  paymentStatus: 'EXPIRED'
                }
              });

              // Update payment history status to EXPIRED
              await tx.paymentHistory.updateMany({
                where: {
                  bookingCode: booking.bookingCode,
                  status: 'PENDING'
                },
                data: {
                  status: 'EXPIRED'
                }
              });

              // Release stock back to access tier
              await tx.accessTier.update({
                where: { id: booking.accessTierId },
                data: {
                  soldQuantity: { decrement: booking.quantity },
                  availableQuantity: { increment: booking.quantity }
                }
              });

              console.log(`♻️  Released ${booking.quantity} tickets back to stock for ${booking.bookingCode}`);

              // Optional: Send expiry notification if no warning was sent
              if (!booking.expiryWarningAt) {
                try {
                  // ✅ CENTRALIZED: Use NotificationService
            const notificationService = getNotificationService();
            await notificationService.sendPaymentFailed(booking.userId, {
                    eventName: booking.event?.title || booking.accessTier?.name || 'Event',
                    eventImage: booking.event?.imageUrl,
                    bookingCode: booking.bookingCode,
                    eventId: booking.eventId
                  });
                } catch (notifError) {
                  console.error(`❌ Error sending expiry notification for ${booking.bookingCode}:`, notifError.message || notifError);
                }
              }

            } catch (error) {
              console.error(`❌ Error cleaning up booking ${booking.bookingCode}:`, error.message || error);
            }
          }
        });

        console.log(`✅ Cleaned up ${expiredBookings.length} expired bookings`);
      }

    } catch (error) {
      console.error('❌ Error cleaning up expired bookings:', error.message || error);
    }
  }

  /**
   * Manual cleanup for testing
   */
  async manualCleanup() {
    console.log('🧪 Running manual cleanup...');
    await this.checkExpiryWarnings();
    await this.cleanupExpiredBookings();
    console.log('✅ Manual cleanup completed');
  }

  /**
   * Get current job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      warningIntervalActive: !!this.warningInterval,
      cleanupIntervalActive: !!this.cleanupInterval,
      warningMinutes: BOOKING_EXPIRY_WARNING_MINUTES,
      checkIntervalMinutes: CLEANUP_INTERVAL_MINUTES
    };
  }
}

// Create singleton instance
const bookingExpiryJob = new BookingExpiryJob();

module.exports = {
  BookingExpiryJob,
  bookingExpiryJob
};