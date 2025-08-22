const { prisma } = require('../../lib/prisma');
const { AppError } = require('../../middleware/errorHandler');

/**
 * 🔒 PAYMENT INTENT SERVICE
 * 
 * Prevents double-spending and payment race conditions through:
 * - Payment intent locking
 * - Idempotency key enforcement
 * - Payment state machine
 * - Distributed locks for scaling
 */
class PaymentIntentService {
  constructor() {
    this.prisma = prisma;
    this.lockTimeout = 30000; // 30 seconds
  }

  /**
   * 🔐 CREATE PAYMENT INTENT WITH LOCK
   * Prevents multiple payments for same booking
   */
  async createPaymentIntent({ userId, eventId, accessTierId, quantity, idempotencyKey }) {
    const intentKey = `payment_intent_${userId}_${eventId}_${accessTierId}`;
    
    try {
      // 🔒 Step 1: Acquire distributed lock
      const lockAcquired = await this.acquirePaymentLock(intentKey, idempotencyKey);
      if (!lockAcquired) {
        throw new AppError('Payment already in progress. Please wait.', 409);
      }

      // 🔍 Step 2: Check for existing payment intent
      const existingIntent = await this.prisma.paymentIntent.findFirst({
        where: {
          userId,
          eventId,
          accessTierId,
          status: { in: ['PENDING', 'PROCESSING'] },
          createdAt: { gte: new Date(Date.now() - this.lockTimeout) }
        }
      });

      if (existingIntent) {
        await this.releasePaymentLock(intentKey);
        throw new AppError('Payment intent already exists. Use existing payment.', 409);
      }

      // 🎯 Step 3: Create payment intent
      const paymentIntent = await this.prisma.paymentIntent.create({
        data: {
          userId,
          eventId,
          accessTierId,
          quantity,
          idempotencyKey,
          status: 'PENDING',
          lockKey: intentKey,
          expiresAt: new Date(Date.now() + this.lockTimeout)
        }
      });

      console.log(`🔒 Payment intent created: ${paymentIntent.id} with lock ${intentKey}`);
      return paymentIntent;

    } catch (error) {
      await this.releasePaymentLock(intentKey);
      throw error;
    }
  }

  /**
   * 🔄 UPDATE PAYMENT INTENT STATUS
   * Atomic state transitions with validation
   */
  async updatePaymentIntentStatus(intentId, newStatus, paymentId = null) {
    const validTransitions = {
      'PENDING': ['PROCESSING', 'CANCELLED'],
      'PROCESSING': ['COMPLETED', 'FAILED'],
      'COMPLETED': [],
      'FAILED': ['PENDING'], // Allow retry
      'CANCELLED': []
    };

    return await this.prisma.$transaction(async (tx) => {
      const intent = await tx.paymentIntent.findUnique({
        where: { id: intentId }
      });

      if (!intent) {
        throw new AppError('Payment intent not found', 404);
      }

      // ✅ Validate state transition
      if (!validTransitions[intent.status].includes(newStatus)) {
        throw new AppError(
          `Invalid state transition from ${intent.status} to ${newStatus}`,
          400
        );
      }

      // 🔄 Update intent
      const updatedIntent = await tx.paymentIntent.update({
        where: { id: intentId },
        data: {
          status: newStatus,
          paymentId: paymentId || intent.paymentId,
          updatedAt: new Date()
        }
      });

      // 🔓 Release lock if final state
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
        await this.releasePaymentLock(intent.lockKey);
      }

      console.log(`🔄 Payment intent ${intentId} status: ${intent.status} → ${newStatus}`);
      return updatedIntent;
    });
  }

  /**
   * 🔒 ACQUIRE PAYMENT LOCK
   * Distributed locking mechanism
   */
  async acquirePaymentLock(lockKey, idempotencyKey) {
    try {
      await this.prisma.paymentLock.create({
        data: {
          lockKey,
          idempotencyKey,
          acquiredAt: new Date(),
          expiresAt: new Date(Date.now() + this.lockTimeout)
        }
      });
      
      console.log(`🔒 Acquired payment lock: ${lockKey}`);
      return true;
    } catch (error) {
      if (error.code === 'P2002') { // Unique constraint violation
        console.log(`🚫 Payment lock already exists: ${lockKey}`);
        return false;
      }
      throw error;
    }
  }

  /**
   * 🔓 RELEASE PAYMENT LOCK
   */
  async releasePaymentLock(lockKey) {
    try {
      await this.prisma.paymentLock.delete({
        where: { lockKey }
      });
      console.log(`🔓 Released payment lock: ${lockKey}`);
    } catch (error) {
      console.error(`❌ Error releasing payment lock ${lockKey}:`, error);
    }
  }

  /**
   * 🧹 CLEANUP EXPIRED LOCKS
   * Background job to clean expired locks
   */
  async cleanupExpiredLocks() {
    try {
      const expiredLocks = await this.prisma.paymentLock.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });

      if (expiredLocks.count > 0) {
        console.log(`🧹 Cleaned up ${expiredLocks.count} expired payment locks`);
      }
    } catch (error) {
      console.error('❌ Error cleaning up expired payment locks:', error);
    }
  }

  /**
   * 🔍 GET PAYMENT INTENT STATUS
   */
  async getPaymentIntentStatus(intentId) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
      include: {
        user: { select: { id: true, username: true } },
        event: { select: { id: true, title: true } }
      }
    });

    if (!intent) {
      throw new AppError('Payment intent not found', 404);
    }

    return intent;
  }
}

module.exports = PaymentIntentService;