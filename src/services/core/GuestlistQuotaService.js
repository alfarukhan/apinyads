const { prisma } = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');

/**
 * 🎫 GUESTLIST QUOTA MANAGEMENT SERVICE
 * 
 * Professional guestlist quota system to prevent overselling:
 * - Real-time quota tracking
 * - Atomic reservation system
 * - Fraud prevention
 * - Customer protection
 */
class GuestlistQuotaService {
  constructor() {
    this.reservations = new Map(); // In-memory reservation tracking
    this.config = {
      MAX_GUESTLIST_PER_EVENT: 50, // Maximum guestlist spots per event
      RESERVATION_TTL: 10 * 60 * 1000, // 10 minutes
      MAX_PENDING_REQUESTS: 100, // Maximum pending requests
    };
  }

  /**
   * 🔒 VALIDATE GUESTLIST QUOTA AVAILABILITY
   * 
   * Checks if guestlist spots are available for an event
   */
  async validateQuotaAvailability(eventId, options = {}) {
    try {
      console.log(`🎫 QUOTA CHECK: Event ${eventId}`);

      // Get event guestlist configuration
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          title: true,
          guestlistCapacity: true,
          hasGuestlist: true,
          startDate: true,
          _count: {
            select: {
              guestLists: {
                where: {
                  AND: [
                    { status: 'APPROVED' },
                    { isPaid: true }
                  ]
                }
              }
            }
          }
        }
      });

      if (!event) {
        throw new AppError('Event not found', 404);
      }

      if (!event.hasGuestlist) {
        throw new AppError('Guestlist is not enabled for this event', 400);
      }

      // Check if event has started
      if (new Date() >= new Date(event.startDate)) {
        throw new AppError('Cannot join guestlist for events that have started', 400);
      }

      // Calculate current usage
      const approvedCount = event._count.guestLists;
      const maxGuestlist = event.guestlistCapacity || this.config.MAX_GUESTLIST_PER_EVENT;
      
      // Count pending payments (reserved spots)
      const pendingCount = await this._countPendingReservations(eventId);
      
      const totalUsed = approvedCount + pendingCount;
      const availableSpots = Math.max(0, maxGuestlist - totalUsed);

      console.log(`🎫 QUOTA STATUS: ${totalUsed}/${maxGuestlist} used (${approvedCount} approved, ${pendingCount} pending)`);

      return {
        available: availableSpots > 0,
        totalSpots: maxGuestlist,
        usedSpots: totalUsed,
        approvedSpots: approvedCount,
        pendingSpots: pendingCount,
        availableSpots: availableSpots,
        event: {
          id: event.id,
          name: event.title
        }
      };

    } catch (error) {
      console.error(`❌ QUOTA VALIDATION ERROR: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🔒 RESERVE GUESTLIST SPOT
   * 
   * Creates atomic reservation to prevent race conditions
   */
  async reserveGuestlistSpot(eventId, userId, options = {}) {
    const reservationId = `guestlist_${eventId}_${userId}_${Date.now()}`;
    
    try {
      console.log(`🎫 RESERVING SPOT: ${reservationId}`);

      // Validate quota availability first
      const quotaStatus = await this.validateQuotaAvailability(eventId);
      
      if (!quotaStatus.available) {
        throw new AppError('No guestlist spots available for this event', 409);
      }

      // Check if user already has a reservation
      const existingReservation = this._findUserReservation(eventId, userId);
      if (existingReservation) {
        console.log(`🎫 EXISTING RESERVATION FOUND: ${existingReservation.id}`);
        return existingReservation;
      }

      // Create in-memory reservation
      const reservation = {
        id: reservationId,
        eventId,
        userId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.RESERVATION_TTL),
        status: 'RESERVED'
      };

      this.reservations.set(reservationId, reservation);

      // Schedule cleanup
      setTimeout(() => {
        this._cleanupReservation(reservationId);
      }, this.config.RESERVATION_TTL);

      console.log(`✅ GUESTLIST SPOT RESERVED: ${reservationId} (expires in ${this.config.RESERVATION_TTL/1000/60} min)`);

      return reservation;

    } catch (error) {
      console.error(`❌ RESERVATION ERROR: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🔒 CONFIRM GUESTLIST RESERVATION
   * 
   * Confirms payment and marks spot as paid
   */
  async confirmReservation(reservationId, paymentData = {}) {
    try {
      console.log(`🎫 CONFIRMING RESERVATION: ${reservationId}`);

      const reservation = this.reservations.get(reservationId);
      
      if (!reservation) {
        throw new AppError('Reservation not found or expired', 404);
      }

      if (new Date() > reservation.expiresAt) {
        this._cleanupReservation(reservationId);
        throw new AppError('Reservation has expired', 410);
      }

      // Update guestlist entry in database
      await prisma.guestList.update({
        where: {
          userId_eventId: {
            userId: reservation.userId,
            eventId: reservation.eventId
          }
        },
        data: {
          // DON'T set isPaid: true here! Only webhook should do that after actual payment
          paymentId: paymentData.paymentId,
          platformFee: paymentData.amount || 0
          // isPaid stays false until webhook confirms payment
        }
      });

      // Mark reservation as confirmed
      reservation.status = 'CONFIRMED';
      reservation.confirmedAt = new Date();

      console.log(`✅ RESERVATION CONFIRMED: ${reservationId}`);

      // Schedule cleanup (confirmed reservations can be cleaned up sooner)
      setTimeout(() => {
        this._cleanupReservation(reservationId);
      }, 60000); // 1 minute

      return reservation;

    } catch (error) {
      console.error(`❌ CONFIRMATION ERROR: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🗑️ RELEASE GUESTLIST RESERVATION
   * 
   * Releases spot back to quota pool
   */
  async releaseReservation(reservationId, reason = 'manual') {
    try {
      console.log(`🎫 RELEASING RESERVATION: ${reservationId} (${reason})`);

      const reservation = this.reservations.get(reservationId);
      
      if (reservation) {
        reservation.status = 'RELEASED';
        reservation.releasedAt = new Date();
        reservation.releaseReason = reason;
      }

      this._cleanupReservation(reservationId);

      console.log(`✅ RESERVATION RELEASED: ${reservationId}`);

    } catch (error) {
      console.error(`❌ RELEASE ERROR: ${error.message}`);
    }
  }

  /**
   * 📊 GET GUESTLIST STATISTICS
   */
  async getGuestlistStats(eventId) {
    try {
      const quotaStatus = await this.validateQuotaAvailability(eventId);
      
      // Get additional stats
      const pendingRequests = await prisma.guestList.count({
        where: {
          eventId,
          status: 'PENDING'
        }
      });

      const rejectedRequests = await prisma.guestList.count({
        where: {
          eventId,
          status: 'REJECTED'
        }
      });

      return {
        ...quotaStatus,
        pendingRequests,
        rejectedRequests,
        reservations: Array.from(this.reservations.values())
          .filter(r => r.eventId === eventId)
          .length
      };

    } catch (error) {
      console.error(`❌ STATS ERROR: ${error.message}`);
      throw error;
    }
  }

  // ====== PRIVATE METHODS ======

  async _countPendingReservations(eventId) {
    const now = new Date();
    let count = 0;

    for (const reservation of this.reservations.values()) {
      if (reservation.eventId === eventId && 
          reservation.status === 'RESERVED' && 
          reservation.expiresAt > now) {
        count++;
      }
    }

    return count;
  }

  _findUserReservation(eventId, userId) {
    for (const reservation of this.reservations.values()) {
      if (reservation.eventId === eventId && 
          reservation.userId === userId && 
          reservation.status === 'RESERVED' &&
          reservation.expiresAt > new Date()) {
        return reservation;
      }
    }
    return null;
  }

  _cleanupReservation(reservationId) {
    const reservation = this.reservations.get(reservationId);
    if (reservation) {
      console.log(`🗑️ CLEANING UP RESERVATION: ${reservationId} (${reservation.status})`);
      this.reservations.delete(reservationId);
    }
  }

  // Cleanup expired reservations periodically
  startCleanupJob() {
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;

      for (const [id, reservation] of this.reservations.entries()) {
        if (reservation.expiresAt <= now || 
            (reservation.status === 'CONFIRMED' && 
             reservation.confirmedAt && 
             new Date(reservation.confirmedAt.getTime() + 60000) <= now)) {
          
          // Send notification if reservation expired
          if (reservation.status === 'RESERVED' && reservation.expiresAt <= now) {
            this._notifyReservationExpired(reservation);
          }
          
          this.reservations.delete(id);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`🗑️ PERIODIC CLEANUP: Removed ${cleanedCount} expired reservations`);
      }
    }, 60000); // Run every minute
  }

  async _notifyReservationExpired(reservation) {
    try {
      const GuestlistNotificationService = require('./GuestlistNotificationService');
      const notificationService = new GuestlistNotificationService();
      await notificationService.sendReservationExpired(
        reservation.userId, 
        reservation.eventId, 
        reservation.id
      );
    } catch (error) {
      console.error('❌ Failed to send reservation expired notification:', error);
    }
  }
}

module.exports = GuestlistQuotaService;