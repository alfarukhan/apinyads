const { PrismaClient } = require('@prisma/client');
const { getNotificationService, getLoggingService } = require('../services/core');

// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

/**
 * Payment Reminder Job
 * 
 * FUNGSI:
 * 1. Cari bookings yang akan expire dalam 15 menit
 * 2. Kirim push notification reminder ke user
 * 3. Auto-expire bookings yang sudah lewat deadline
 * 4. Maintain database cleanliness
 * 
 * Schedule: Run every 5 minutes via cron
 */
class PaymentReminderJob {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Execute payment reminder job
   */
  async execute() {
    if (this.isRunning) {
      console.log('⏭️ Payment reminder job already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('🔔 Starting payment reminder job...');

    try {
      // Find bookings that expire in 15 minutes
      const reminderTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
      const currentTime = new Date();

      const bookingsNeedingReminder = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          paymentStatus: 'PENDING', // Field required, ga bisa null
          expiresAt: {
            lte: reminderTime,
            gte: currentTime // Not yet expired
          },
          // Only send reminder if not already warned
          expiryWarningAt: null
        },
        include: {
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
          },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true
            }
          }
        },
        take: 50 // Process max 50 at a time
      });

      console.log(`📋 Found ${bookingsNeedingReminder.length} bookings needing payment reminder`);
      
      if (bookingsNeedingReminder.length === 0) {
        console.log('✅ No bookings need payment reminder');
        this.isRunning = false;
        return;
      }

      for (const booking of bookingsNeedingReminder) {
        try {
          // Send payment reminder notification
          // ✅ CENTRALIZED: Use NotificationService
        const notificationService = getNotificationService();
        await notificationService.sendPaymentReminder(booking.userId, {
            eventName: booking.event?.title || booking.accessTier?.name || 'Event',
            eventImage: booking.event?.imageUrl,
            bookingCode: booking.bookingCode,
            eventId: booking.eventId,
            totalAmount: booking.totalAmount,
            quantity: booking.quantity,
            expiresAt: booking.expiresAt
          });

          // Mark reminder as sent via expiryWarningAt timestamp
          await prisma.booking.update({
            where: { id: booking.id },
            data: { expiryWarningAt: new Date() }
          });

          console.log(`📤 Payment reminder sent for booking ${booking.bookingCode}`);
        } catch (error) {
          console.error(`❌ Failed to send payment reminder for booking ${booking.bookingCode}:`, error.message || error);
        }
      }

      console.log(`✅ Payment reminder job completed. Processed ${bookingsNeedingReminder.length} bookings`);
    } catch (error) {
      console.error('❌ Payment reminder job failed:', error.message || error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute payment expiry job 
   * Marks expired bookings and sends expiry notifications
   */
  async executeExpiryJob() {
    if (this.isRunning) {
      console.log('⏭️ Payment expiry job already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('⏰ Starting payment expiry job...');

    try {
      const currentTime = new Date();

      // Find expired bookings
      const expiredBookings = await prisma.booking.findMany({
        where: {
          status: 'PENDING',
          paymentStatus: 'PENDING', // Field required, ga bisa null
          expiresAt: {
            lt: currentTime
          },
          // Only pending expired bookings
          // Note: No tracking field for expiry notifications in schema
        },
        include: {
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

      console.log(`📋 Found ${expiredBookings.length} expired bookings`);

      for (const booking of expiredBookings) {
        try {
          // Update booking status to EXPIRED
          await prisma.$transaction(async (tx) => {
            // Update booking status
            await tx.booking.update({
              where: { id: booking.id },
              data: { 
                status: 'EXPIRED',
                paymentStatus: 'EXPIRED'
                // Note: expiredNotificationSent field doesn't exist in schema
              }
            });

            // Return stock to access tier
            await tx.accessTier.update({
              where: { id: booking.accessTierId },
              data: {
                soldQuantity: { decrement: booking.quantity },
                availableQuantity: { increment: booking.quantity }
              }
            });
          });

          // Send payment expired notification
          // ✅ CENTRALIZED: Use NotificationService
        const notificationService = getNotificationService();
        await notificationService.sendPaymentExpired(booking.userId, {
            eventName: booking.event?.title || booking.accessTier?.name || 'Event',
            eventImage: booking.event?.imageUrl,
            bookingCode: booking.bookingCode,
            eventId: booking.eventId
          });

          console.log(`⏰ Booking ${booking.bookingCode} marked as expired and stock returned`);
        } catch (error) {
          console.error(`❌ Failed to process expired booking ${booking.bookingCode}:`, error);
        }
      }

      console.log(`✅ Payment expiry job completed. Processed ${expiredBookings.length} bookings`);
    } catch (error) {
      console.error('❌ Payment expiry job failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Start cron jobs for payment reminders and expiry
   */
  startCronJobs() {
    // Payment reminder job - every 5 minutes
    setInterval(() => {
      this.execute();
    }, 5 * 60 * 1000);

    // Payment expiry job - every 10 minutes
    setInterval(() => {
      this.executeExpiryJob();
    }, 10 * 60 * 1000);

    console.log('⏰ Payment reminder and expiry cron jobs started');
    console.log('📅 Reminder job: every 5 minutes');
    console.log('📅 Expiry job: every 10 minutes');
  }
}

module.exports = new PaymentReminderJob();