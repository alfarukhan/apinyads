const { prisma } = require('../../lib/prisma');

/**
 * 📱 GUESTLIST NOTIFICATION SERVICE
 * 
 * Professional notification system for guestlist operations:
 * - Customer communication
 * - Status updates
 * - Error notifications
 * - Payment confirmations
 */
class GuestlistNotificationService {
  constructor() {
    this.notificationTemplates = {
      SPOT_RESERVED: {
        title: '🎫 Guestlist Spot Reserved',
        body: 'Your spot is reserved! Complete payment within 10 minutes.',
        action: 'COMPLETE_PAYMENT'
      },
      PAYMENT_PROCESSING: {
        title: '💳 Processing Payment',
        body: 'Your guestlist payment is being processed securely.',
        action: 'VIEW_STATUS'
      },
      PAYMENT_SUCCESS: {
        title: '✅ Payment Confirmed',
        body: 'Welcome to the guestlist! Your spot is confirmed.',
        action: 'VIEW_TICKET'
      },
      PAYMENT_FAILED: {
        title: '❌ Payment Failed',
        body: 'Payment could not be processed. Please try again.',
        action: 'RETRY_PAYMENT'
      },
      SPOT_RELEASED: {
        title: '⏰ Reservation Expired',
        body: 'Your guestlist spot reservation has expired.',
        action: 'TRY_AGAIN'
      },
      QUOTA_FULL: {
        title: '😔 Guestlist Full',
        body: 'Sorry, all guestlist spots are taken for this event.',
        action: 'VIEW_TICKETS'
      },
      APPROVAL_RECEIVED: {
        title: '🎉 Guestlist Approved',
        body: 'Great news! You\'ve been approved for the guestlist.',
        action: 'PAY_NOW'
      }
    };
  }

  /**
   * 🎫 SEND SPOT RESERVATION NOTIFICATION
   */
  async sendSpotReserved(userId, eventId, reservationId, expiresIn) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.SPOT_RESERVED;
      
      const notification = {
        userId,
        type: 'GUESTLIST_SPOT_RESERVED',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          reservationId,
          expiresIn,
          action: template.action,
          priority: 'HIGH'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 SPOT RESERVED notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send spot reserved notification:`, error);
    }
  }

  /**
   * 💳 SEND PAYMENT PROCESSING NOTIFICATION
   */
  async sendPaymentProcessing(userId, eventId, paymentId) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.PAYMENT_PROCESSING;
      
      const notification = {
        userId,
        type: 'GUESTLIST_PAYMENT_PROCESSING',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          paymentId,
          action: template.action,
          priority: 'MEDIUM'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 PAYMENT PROCESSING notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send payment processing notification:`, error);
    }
  }

  /**
   * ✅ SEND PAYMENT SUCCESS NOTIFICATION
   */
  async sendPaymentSuccess(userId, eventId, paymentId, ticketCode = null) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.PAYMENT_SUCCESS;
      
      const notification = {
        userId,
        type: 'GUESTLIST_PAYMENT_SUCCESS',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          paymentId,
          ticketCode,
          action: template.action,
          priority: 'HIGH'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 PAYMENT SUCCESS notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send payment success notification:`, error);
    }
  }

  /**
   * ❌ SEND PAYMENT FAILED NOTIFICATION
   */
  async sendPaymentFailed(userId, eventId, paymentId, reason) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.PAYMENT_FAILED;
      
      const notification = {
        userId,
        type: 'GUESTLIST_PAYMENT_FAILED',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          paymentId,
          reason,
          action: template.action,
          priority: 'HIGH'
        }
      };

      await this._sendNotification(notification);
      
      // Also send email for payment failures
      await this._sendPaymentFailureEmail(userId, event, reason);
      
      console.log(`📱 PAYMENT FAILED notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send payment failed notification:`, error);
    }
  }

  /**
   * ⏰ SEND RESERVATION EXPIRED NOTIFICATION
   */
  async sendReservationExpired(userId, eventId, reservationId) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.SPOT_RELEASED;
      
      const notification = {
        userId,
        type: 'GUESTLIST_RESERVATION_EXPIRED',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          reservationId,
          action: template.action,
          priority: 'MEDIUM'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 RESERVATION EXPIRED notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send reservation expired notification:`, error);
    }
  }

  /**
   * 😔 SEND QUOTA FULL NOTIFICATION
   */
  async sendQuotaFull(userId, eventId) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.QUOTA_FULL;
      
      const notification = {
        userId,
        type: 'GUESTLIST_QUOTA_FULL',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          action: template.action,
          priority: 'LOW'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 QUOTA FULL notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send quota full notification:`, error);
    }
  }

  /**
   * 🎉 SEND APPROVAL RECEIVED NOTIFICATION
   */
  async sendApprovalReceived(userId, eventId) {
    try {
      const event = await this._getEventDetails(eventId);
      const template = this.notificationTemplates.APPROVAL_RECEIVED;
      
      const notification = {
        userId,
        type: 'GUESTLIST_APPROVED',
        title: template.title,
        body: `${event.name}: ${template.body}`,
        data: {
          eventId,
          eventName: event.name,
          action: template.action,
          priority: 'HIGH'
        }
      };

      await this._sendNotification(notification);
      console.log(`📱 APPROVAL RECEIVED notification sent to user ${userId}`);

    } catch (error) {
      console.error(`❌ Failed to send approval notification:`, error);
    }
  }

  // ====== PRIVATE METHODS ======

  async _getEventDetails(eventId) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        startDate: true,
        location: true,
        imageUrl: true
      }
    });

    return {
      id: event?.id,
      name: event?.title || 'Event',
      startDate: event?.startDate,
      location: event?.location,
      imageUrl: event?.imageUrl
    };
  }

  async _sendNotification(notification) {
    try {
      // Save to database
      await prisma.notification.create({
        data: {
          userId: notification.userId,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          actionData: notification.data,
          isRead: false,
          createdAt: new Date()
        }
      });

      // Send push notification (if FCM service is available)
      try {
        const { getNotificationService } = require('./index');
        const fcmService = getNotificationService();
        
        if (fcmService && fcmService.sendToUser) {
          await fcmService.sendToUser(notification.userId, {
            title: notification.title,
            body: notification.body,
            data: notification.data
          });
        }
      } catch (fcmError) {
        console.log(`📱 FCM not available, notification saved to database only`);
      }

    } catch (error) {
      console.error(`❌ Failed to send notification:`, error);
    }
  }

  async _sendPaymentFailureEmail(userId, event, reason) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true }
      });

      if (!user?.email) {
        console.log(`📧 No email found for user ${userId}`);
        return;
      }

      // Email content for payment failure
      const emailData = {
        to: user.email,
        subject: `Payment Issue - ${event.name} Guestlist`,
        template: 'payment-failure',
        data: {
          userName: user.firstName || 'Guest',
          eventName: event.name,
          eventDate: event.startDate,
          reason: reason,
          supportEmail: 'support@dancesignal.com'
        }
      };

      // Send email (if email service is available)
      console.log(`📧 Payment failure email prepared for ${user.email}`);
      // TODO: Integrate with email service

    } catch (error) {
      console.error(`❌ Failed to send payment failure email:`, error);
    }
  }
}

module.exports = GuestlistNotificationService;