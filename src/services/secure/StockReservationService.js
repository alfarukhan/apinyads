const { prisma } = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');

/**
 * 🎫 STOCK RESERVATION SERVICE
 * 
 * Advanced stock management with:
 * - Temporary reservations with TTL
 * - Atomic stock operations
 * - Automatic cleanup of expired reservations
 * - Race condition prevention
 * - Detailed stock tracking
 */
class StockReservationService {
  constructor() {
    this.prisma = prisma;
    this.reservationTTL = 30 * 60 * 1000; // 30 minutes default
  }

  /**
   * 🔒 RESERVE STOCK ATOMICALLY
   * Creates temporary reservation with expiration
   */
  async reserveStock({ accessTierId, userId, quantity, paymentIntentId, ttl }) {
    const reservationTTL = ttl || this.reservationTTL;
    const expiresAt = new Date(Date.now() + reservationTTL);
    
    return await this.prisma.$transaction(async (tx) => {
      // 🔍 Step 1: Get current tier with lock
      const accessTier = await tx.accessTier.findUnique({
        where: { id: accessTierId },
        select: {
          id: true,
          maxQuantity: true,
          soldQuantity: true,
          availableQuantity: true,
          reservedQuantity: true,
          version: true,
          event: {
            select: { id: true, title: true }
          }
        }
      });

      if (!accessTier) {
        throw new AppError('Access tier not found', 404);
      }

      // 🧮 Step 2: Calculate available stock after existing reservations
      const currentReservations = await tx.stockReservation.aggregate({
        where: {
          accessTierId,
          status: 'RESERVED',
          expiresAt: { gt: new Date() }
        },
        _sum: { quantity: true }
      });

      const totalReserved = currentReservations._sum.quantity || 0;
      const actualAvailable = accessTier.availableQuantity - totalReserved;

      console.log(`🎫 Stock check for tier ${accessTierId}:`, {
        maxQuantity: accessTier.maxQuantity,
        soldQuantity: accessTier.soldQuantity,
        availableQuantity: accessTier.availableQuantity,
        totalReserved,
        actualAvailable,
        requestedQuantity: quantity
      });

      // ✅ Step 3: Validate availability
      if (actualAvailable < quantity) {
        throw new AppError(
          `Insufficient stock. Available: ${actualAvailable}, Requested: ${quantity}`,
          400
        );
      }

      // 🔒 Step 4: Create reservation
      const reservation = await tx.stockReservation.create({
        data: {
          accessTierId,
          userId,
          quantity,
          expiresAt,
          status: 'RESERVED',
          paymentIntentId
        }
      });

      // 📊 Step 5: Update tier reserved quantity
      await tx.accessTier.update({
        where: { 
          id: accessTierId,
          version: accessTier.version
        },
        data: {
          reservedQuantity: { increment: quantity },
          version: { increment: 1 }
        }
      });

      console.log(`✅ Reserved ${quantity} tickets for user ${userId} (reservation: ${reservation.id})`);
      
      return {
        reservationId: reservation.id,
        accessTierId,
        quantity,
        expiresAt,
        availableAfterReservation: actualAvailable - quantity
      };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000
    });
  }

  /**
   * ✅ CONFIRM RESERVATION
   * Converts reservation to permanent sale
   */
  async confirmReservation(reservationId, bookingId) {
    return await this.prisma.$transaction(async (tx) => {
      // 🔍 Step 1: Get reservation
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
        include: {
          accessTier: {
            select: {
              id: true,
              version: true,
              soldQuantity: true,
              availableQuantity: true,
              reservedQuantity: true
            }
          }
        }
      });

      if (!reservation) {
        throw new AppError('Reservation not found', 404);
      }

      if (reservation.status !== 'RESERVED') {
        throw new AppError(`Cannot confirm reservation with status: ${reservation.status}`, 400);
      }

      if (new Date() > reservation.expiresAt) {
        throw new AppError('Reservation has expired', 410);
      }

      // ✅ Step 2: Confirm reservation
      await tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          status: 'CONFIRMED',
          bookingId,
          confirmedAt: new Date()
        }
      });

      // 📊 Step 3: Update tier quantities atomically
      await tx.accessTier.update({
        where: { 
          id: reservation.accessTierId,
          version: reservation.accessTier.version
        },
        data: {
          soldQuantity: { increment: reservation.quantity },
          availableQuantity: { decrement: reservation.quantity },
          reservedQuantity: { decrement: reservation.quantity },
          version: { increment: 1 }
        }
      });

      console.log(`✅ Confirmed reservation ${reservationId} for ${reservation.quantity} tickets`);
      
      return {
        reservationId,
        quantity: reservation.quantity,
        accessTierId: reservation.accessTierId,
        confirmedAt: new Date()
      };
    });
  }

  /**
   * ❌ CANCEL RESERVATION
   * Releases reserved stock back to available pool
   */
  async cancelReservation(reservationId, reason = 'User cancellation') {
    return await this.prisma.$transaction(async (tx) => {
      // 🔍 Step 1: Get reservation
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
        include: {
          accessTier: {
            select: {
              id: true,
              version: true,
              reservedQuantity: true
            }
          }
        }
      });

      if (!reservation) {
        throw new AppError('Reservation not found', 404);
      }

      if (reservation.status !== 'RESERVED') {
        throw new AppError(`Cannot cancel reservation with status: ${reservation.status}`, 400);
      }

      // ❌ Step 2: Cancel reservation
      await tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason
        }
      });

      // ♻️ Step 3: Release reserved quantity
      await tx.accessTier.update({
        where: { 
          id: reservation.accessTierId,
          version: reservation.accessTier.version
        },
        data: {
          reservedQuantity: { decrement: reservation.quantity },
          version: { increment: 1 }
        }
      });

      console.log(`❌ Cancelled reservation ${reservationId}: ${reason}`);
      
      return {
        reservationId,
        quantity: reservation.quantity,
        accessTierId: reservation.accessTierId,
        cancelledAt: new Date(),
        reason
      };
    });
  }

  /**
   * 🧹 CLEANUP EXPIRED RESERVATIONS
   * Background job to release expired stock
   */
  async cleanupExpiredReservations() {
    try {
      console.log('🧹 Starting cleanup of expired stock reservations...');
      
      // Find expired reservations
      const expiredReservations = await this.prisma.stockReservation.findMany({
        where: {
          status: 'RESERVED',
          expiresAt: { lt: new Date() }
        },
        include: {
          accessTier: {
            select: { id: true, version: true }
          }
        }
      });

      if (expiredReservations.length === 0) {
        console.log('✅ No expired reservations to cleanup');
        return { cleanedUp: 0 };
      }

      console.log(`🧹 Found ${expiredReservations.length} expired reservations to cleanup`);

      let cleanedUp = 0;
      
      // Process each expired reservation
      for (const reservation of expiredReservations) {
        try {
          await this.cancelReservation(reservation.id, 'Automatic cleanup - expired');
          cleanedUp++;
        } catch (error) {
          console.error(`❌ Error cleaning up reservation ${reservation.id}:`, error);
        }
      }

      console.log(`✅ Cleaned up ${cleanedUp}/${expiredReservations.length} expired reservations`);
      
      return { cleanedUp, total: expiredReservations.length };
    } catch (error) {
      console.error('❌ Error in stock reservation cleanup:', error);
      throw error;
    }
  }

  /**
   * 📊 GET STOCK STATUS
   * Comprehensive stock information
   */
  async getStockStatus(accessTierId) {
    const accessTier = await this.prisma.accessTier.findUnique({
      where: { id: accessTierId },
      select: {
        id: true,
        name: true,
        maxQuantity: true,
        soldQuantity: true,
        availableQuantity: true,
        reservedQuantity: true,
        version: true
      }
    });

    if (!accessTier) {
      throw new AppError('Access tier not found', 404);
    }

    // Get active reservations
    const activeReservations = await this.prisma.stockReservation.findMany({
      where: {
        accessTierId,
        status: 'RESERVED',
        expiresAt: { gt: new Date() }
      },
      select: {
        id: true,
        quantity: true,
        expiresAt: true,
        userId: true
      }
    });

    const totalActiveReserved = activeReservations.reduce(
      (sum, reservation) => sum + reservation.quantity,
      0
    );

    return {
      accessTier,
      activeReservations,
      totalActiveReserved,
      actualAvailable: accessTier.availableQuantity - totalActiveReserved,
      stockHealth: {
        utilizationRate: ((accessTier.soldQuantity / accessTier.maxQuantity) * 100).toFixed(2) + '%',
        reservationRate: ((totalActiveReserved / accessTier.maxQuantity) * 100).toFixed(2) + '%',
        isLowStock: (accessTier.availableQuantity - totalActiveReserved) < 10
      }
    };
  }

  /**
   * 👤 GET USER RESERVATIONS
   * Get all active reservations for a user
   */
  async getUserReservations(userId, eventId = null) {
    const where = {
      userId,
      status: 'RESERVED',
      expiresAt: { gt: new Date() }
    };

    if (eventId) {
      where.accessTier = { eventId };
    }

    const reservations = await this.prisma.stockReservation.findMany({
      where,
      include: {
        accessTier: {
          select: {
            id: true,
            name: true,
            price: true,
            event: {
              select: {
                id: true,
                title: true,
                startDate: true
              }
            }
          }
        }
      },
      orderBy: { expiresAt: 'asc' }
    });

    return reservations.map(reservation => ({
      ...reservation,
      expiresIn: Math.max(0, reservation.expiresAt.getTime() - Date.now()),
      isExpiringSoon: (reservation.expiresAt.getTime() - Date.now()) < (5 * 60 * 1000) // 5 minutes
    }));
  }
}

module.exports = StockReservationService;