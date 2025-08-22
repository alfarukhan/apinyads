const { prisma } = require('../../lib/prisma');
const BaseRepository = require('../../repositories/BaseRepository');
const LoggingService = require('./LoggingService');
const AuditLogService = require('./AuditLogService');

/**
 * 💳 CENTRALIZED PAYMENT REPOSITORY
 * 
 * Advanced payment data access layer for DanceSignal:
 * - Payment history management with full audit trails
 * - Booking & guestlist payment operations
 * - Access ticket generation & management
 * - Payment status tracking & updates
 * - Transaction-safe payment operations
 * - Comprehensive payment analytics
 * 
 * ✅ Consistency: Unified payment data operations
 * ✅ Safety: Transaction-wrapped operations
 * ✅ Performance: Optimized queries with proper indexing
 * ✅ Reliability: Error handling & rollback mechanisms
 */
class PaymentRepository extends BaseRepository {
  constructor() {
    super('payment'); // Base model name for logging
    this.prisma = prisma;
    this.logger = new LoggingService();
    this.auditService = new AuditLogService();

    // ✅ Payment repository configuration
    this.config = {
      // Query optimization - only include valid PaymentHistory relations
      DEFAULT_PAYMENT_INCLUDES: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            startDate: true,
            endDate: true,
            location: true,
            price: true,
            currency: true
          }
        }
      },

      // Access ticket configuration
      ACCESS_TICKET_DEFAULTS: {
        validityDays: 365,
        defaultVenueDetails: 'Event Venue',
        ticketTypes: {
          BOOKING: 'TICKET',
          GUESTLIST: 'GUEST_LIST',
          SUBSCRIPTION: 'VIP',
          REFUND: 'TICKET'
        }
      },

      // Performance settings
      MAX_PAYMENT_BATCH_SIZE: 50,
      QUERY_TIMEOUT_MS: 30000,
      ENABLE_QUERY_LOGGING: process.env.NODE_ENV === 'development'
    };

    console.log('💳 PaymentRepository initialized:', {
      model: this.modelName,
      queryTimeout: `${this.config.QUERY_TIMEOUT_MS}ms`,
      batchSize: this.config.MAX_PAYMENT_BATCH_SIZE,
      queryLogging: this.config.ENABLE_QUERY_LOGGING
    });
  }

  /**
   * 💰 PAYMENT HISTORY OPERATIONS
   */

  async createPaymentHistory(paymentData, options = {}) {
    const {
      correlationId = null,
      userId = null,
      auditMetadata = {}
    } = options;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // ✅ FIX: Create payment history record with correct schema fields
        const paymentHistory = await tx.paymentHistory.create({
          data: {
            transactionId: paymentData.transactionId || paymentData.paymentId || null,
            eventName: paymentData.eventName || paymentData.itemName || 'Unknown Event',
            amount: paymentData.amount,
            subtotalAmount: paymentData.subtotalAmount || paymentData.amount,
            platformFee: paymentData.platformFee || 0,
            taxAmount: paymentData.taxAmount || 0,
            currency: paymentData.currency || 'IDR',
            status: paymentData.status || 'PENDING',
            paymentMethod: paymentData.paymentMethod,
            ticketType: paymentData.ticketType || null,
            imageUrl: paymentData.imageUrl || null,
            bookingCode: paymentData.bookingCode || null,
            // Prefer explicit redirectUrl, then midtransRedirectUrl, then nested midtrans response
            paymentUrl: paymentData.redirectUrl 
              || paymentData.midtransRedirectUrl 
              || paymentData.midtransResponse?.redirect_url 
              || null,
            eventId: paymentData.eventId || null,
            userId: paymentData.userId
          },
          include: {
            // ✅ FIX: Only include valid relations for PaymentHistory model
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                firstName: true,
                lastName: true
              }
            },
            event: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
                startDate: true,
                location: true
              }
            }
          }
        });

        return paymentHistory;
      }, {
        maxWait: 5000,
        timeout: this.config.QUERY_TIMEOUT_MS
      });

      // ✅ Log payment creation
      await this.auditService.logEvent('PAYMENT_CREATED', {
        userId,
        resourceType: 'payment',
        resourceId: result.paymentId,
        metadata: {
          amount: result.amount,
          currency: result.currency,
          paymentMethod: result.paymentMethod,
          correlationId,
          ...auditMetadata
        }
      });

      this.logger.info('Payment history created', {
        paymentId: result.paymentId,
        orderId: result.orderId,
        amount: result.amount,
        currency: result.currency,
        userId: result.userId
      }, { correlationId });

      return {
        success: true,
        data: result,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to create payment history', {
        error: error.message,
        paymentData: {
          paymentId: paymentData.paymentId,
          orderId: paymentData.orderId,
          amount: paymentData.amount,
          userId: paymentData.userId
        }
      }, { correlationId });

      throw error;
    }
  }

  async updatePaymentStatus(paymentId, status, statusDetails = {}, options = {}) {
    const {
      correlationId = null,
      userId = null,
      auditMetadata = {}
    } = options;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // ✅ Update payment status
        const updatedPayment = await tx.paymentHistory.update({
          where: { paymentId },
          data: {
            status,
            paidAt: status === 'PAID' ? new Date() : undefined,
            failedAt: status === 'FAILED' ? new Date() : undefined,
            cancelledAt: status === 'CANCELLED' ? new Date() : undefined,
            
            // Update transaction details if provided
            midtransTransactionId: statusDetails.transactionId || undefined,
            fraudStatus: statusDetails.fraudStatus || undefined,
            acquirer: statusDetails.acquirer || undefined,
            
            // Update metadata
            metadata: statusDetails.metadata ? {
              ...statusDetails.metadata
            } : undefined,
            
            updatedAt: new Date()
          },
          include: this.config.DEFAULT_PAYMENT_INCLUDES
        });

        // ✅ Update related booking status if exists
        if (updatedPayment.bookingId) {
          await tx.booking.update({
            where: { id: updatedPayment.bookingId },
            data: {
              paymentStatus: status,
              paidAt: status === 'PAID' ? new Date() : undefined,
              status: status === 'PAID' ? 'CONFIRMED' : status === 'FAILED' ? 'CANCELLED' : undefined
            }
          });
        }

        // ✅ Update related guestlist status if exists
        if (updatedPayment.guestList && updatedPayment.guestList.length > 0) {
          await tx.guestList.updateMany({
            where: { paymentId },
            data: {
              isPaid: status === 'PAID',
              paidAt: status === 'PAID' ? new Date() : null,
              status: status === 'PAID' ? 'APPROVED' : status === 'FAILED' ? 'REJECTED' : undefined
            }
          });
        }

        return updatedPayment;
      }, {
        maxWait: 5000,
        timeout: this.config.QUERY_TIMEOUT_MS
      });

      // ✅ Log status update
      await this.auditService.logEvent('PAYMENT_STATUS_UPDATED', {
        userId,
        resourceType: 'payment',
        resourceId: paymentId,
        metadata: {
          oldStatus: 'previous_status', // TODO: Get from before update
          newStatus: status,
          statusDetails,
          correlationId,
          ...auditMetadata
        }
      });

      this.logger.info('Payment status updated', {
        paymentId,
        newStatus: status,
        statusDetails
      }, { correlationId });

      return {
        success: true,
        data: result,
        statusChanged: true,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to update payment status', {
        paymentId,
        status,
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  async getPaymentHistory(identifier, options = {}) {
    const {
      includeRelated = true,
      correlationId = null,
      queryBy = 'bookingCode' // Default to bookingCode, can be 'id' or 'bookingCode'
    } = options;

    try {
      this.logger.info(`🔍 PaymentRepository querying with:`, { 
        identifier, 
        queryBy, 
        correlationId 
      });

      // Build the where clause based on queryBy option
      const whereClause = {};
      if (queryBy === 'id') {
        whereClause.id = identifier;
      } else if (queryBy === 'bookingCode') {
        whereClause.bookingCode = identifier;
      } else if (queryBy === 'paymentId') {
        // Support guestlist payment lookup by paymentId (GL prefix)
        whereClause.bookingCode = identifier; // paymentId is stored as bookingCode for guestlist
      } else {
        throw new Error(`Invalid queryBy option: ${queryBy}. Must be 'id', 'bookingCode', or 'paymentId'`);
      }

      const payment = await this.prisma.paymentHistory.findFirst({
        where: whereClause,
        include: includeRelated ? this.config.DEFAULT_PAYMENT_INCLUDES : false,
        orderBy: { createdAt: 'desc' } // Get the most recent payment for the booking
      });

      this.logger.info(`🔍 PaymentRepository query result:`, { 
        found: !!payment,
        paymentId: payment?.id,
        status: payment?.status 
      });

      // If no payment found, let's check what payment records exist for debugging
      if (!payment && queryBy === 'bookingCode') {
        const allPayments = await this.prisma.paymentHistory.findMany({
          select: { id: true, bookingCode: true, status: true, eventName: true },
          take: 10
        });
        this.logger.info(`🔍 Available payment records (debug):`, allPayments);
        
        // Also check if there are any bookings with this code
        const booking = await this.prisma.booking.findUnique({
          where: { bookingCode: identifier },
          select: { id: true, bookingCode: true, status: true, paymentStatus: true, paymentId: true }
        });
        this.logger.info(`🔍 Booking record found:`, booking);
      }

      if (!payment) {
        return {
          success: false,
          error: 'Payment not found',
          data: null
        };
      }

      return {
        success: true,
        data: payment,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to get payment history', {
        identifier,
        queryBy,
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  async getPaymentsByUser(userId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      status = null,
      dateFrom = null,
      dateTo = null,
      correlationId = null
    } = options;

    try {
      const where = {
        userId,
        ...(status && { status }),
        ...(dateFrom && dateTo && {
          createdAt: {
            gte: new Date(dateFrom),
            lte: new Date(dateTo)
          }
        })
      };

      const [payments, total] = await Promise.all([
        this.prisma.paymentHistory.findMany({
          where,
          include: this.config.DEFAULT_PAYMENT_INCLUDES,
          orderBy: { createdAt: 'desc' },
          take: Math.min(limit, this.config.MAX_PAYMENT_BATCH_SIZE),
          skip: offset
        }),
        this.prisma.paymentHistory.count({ where })
      ]);

      return {
        success: true,
        data: payments,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + payments.length < total
        },
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to get payments by user', {
        userId,
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  /**
   * 🎫 ACCESS TICKET OPERATIONS
   */

  async generateAccessTicket(paymentId, options = {}) {
    const {
      userId = null,
      correlationId = null,
      auditMetadata = {}
    } = options;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // ✅ Get payment details
        const payment = await tx.paymentHistory.findUnique({
          where: { paymentId },
          include: this.config.DEFAULT_PAYMENT_INCLUDES
        });

        if (!payment) {
          throw new Error('Payment not found');
        }

        if (payment.status !== 'PAID') {
          throw new Error('Payment not completed');
        }

        // ✅ Check if access ticket already exists
        const existingAccess = await tx.access.findFirst({
          where: {
            OR: [
              { paymentId },
              { bookingId: payment.bookingId },
              payment.guestList && payment.guestList.length > 0 ? {
                eventId: payment.eventId,
                userId: payment.userId,
                type: 'GUEST_LIST'
              } : {}
            ].filter(condition => Object.keys(condition).length > 0)
          }
        });

        if (existingAccess) {
          return existingAccess;
        }

        // ✅ Determine access ticket details
        let ticketType = 'TICKET';
        let validUntil = new Date(Date.now() + this.config.ACCESS_TICKET_DEFAULTS.validityDays * 24 * 60 * 60 * 1000);
        let venueDetails = this.config.ACCESS_TICKET_DEFAULTS.defaultVenueDetails;
        let eventId = payment.eventId;

        // Set type based on payment context
        if (payment.guestList && payment.guestList.length > 0) {
          ticketType = 'GUEST_LIST';
          const guestListEntry = payment.guestList[0];
          if (guestListEntry.event) {
            validUntil = new Date(guestListEntry.event.startDate);
            venueDetails = guestListEntry.event.location || venueDetails;
            eventId = guestListEntry.event.id;
          }
        } else if (payment.booking) {
          ticketType = 'TICKET';
          if (payment.booking.event) {
            validUntil = new Date(payment.booking.event.startDate);
            venueDetails = payment.booking.event.location || venueDetails;
            eventId = payment.booking.event.id;
          }
        }

        // ✅ Create access ticket
        const accessTicket = await tx.access.create({
          data: {
            userId: payment.userId,
            eventId: eventId,
            bookingId: payment.bookingId,
            paymentId: paymentId,
            type: ticketType,
            validUntil: validUntil,
            venueDetails: venueDetails,
            isActive: true,
            metadata: {
              paymentAmount: payment.amount,
              paymentCurrency: payment.currency,
              paymentMethod: payment.paymentMethod,
              generatedAt: new Date().toISOString(),
              correlationId
            }
          },
          include: {
            event: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
                startDate: true,
                location: true
              }
            },
            booking: {
              select: {
                id: true,
                bookingCode: true,
                quantity: true
              }
            }
          }
        });

        return accessTicket;
      }, {
        maxWait: 5000,
        timeout: this.config.QUERY_TIMEOUT_MS
      });

      // ✅ Log access ticket generation
      await this.auditService.logEvent('ACCESS_TICKET_GENERATED', {
        userId,
        resourceType: 'access',
        resourceId: result.id,
        metadata: {
          paymentId,
          eventId: result.eventId,
          ticketType: result.type,
          correlationId,
          ...auditMetadata
        }
      });

      this.logger.info('Access ticket generated', {
        accessId: result.id,
        paymentId,
        eventId: result.eventId,
        type: result.type
      }, { correlationId });

      return {
        success: true,
        data: result,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to generate access ticket', {
        paymentId,
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  /**
   * 📊 PAYMENT ANALYTICS & QUERIES
   */

  async getPendingPayments(limit = 50, options = {}) {
    const {
      maxAgeMinutes = 30,
      correlationId = null
    } = options;

    try {
      const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

      const payments = await this.prisma.paymentHistory.findMany({
        where: {
          status: 'PENDING',
          createdAt: { gte: cutoffTime },
          expiresAt: { gt: new Date() }
        },
        include: this.config.DEFAULT_PAYMENT_INCLUDES,
        orderBy: { createdAt: 'asc' },
        take: Math.min(limit, this.config.MAX_PAYMENT_BATCH_SIZE)
      });

      return {
        success: true,
        data: payments,
        count: payments.length,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to get pending payments', {
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  async getExpiredPayments(limit = 50, options = {}) {
    const {
      correlationId = null
    } = options;

    try {
      const payments = await this.prisma.paymentHistory.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { lt: new Date() }
        },
        include: this.config.DEFAULT_PAYMENT_INCLUDES,
        orderBy: { expiresAt: 'asc' },
        take: Math.min(limit, this.config.MAX_PAYMENT_BATCH_SIZE)
      });

      return {
        success: true,
        data: payments,
        count: payments.length,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to get expired payments', {
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  async getPaymentStatistics(options = {}) {
    const {
      dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
      dateTo = new Date(),
      correlationId = null
    } = options;

    try {
      const where = {
        createdAt: {
          gte: dateFrom,
          lte: dateTo
        }
      };

      const [
        totalPayments,
        paidPayments,
        failedPayments,
        pendingPayments,
        totalRevenue,
        paymentsByMethod,
        paymentsByStatus
      ] = await Promise.all([
        this.prisma.paymentHistory.count({ where }),
        this.prisma.paymentHistory.count({ where: { ...where, status: 'PAID' } }),
        this.prisma.paymentHistory.count({ where: { ...where, status: 'FAILED' } }),
        this.prisma.paymentHistory.count({ where: { ...where, status: 'PENDING' } }),
        this.prisma.paymentHistory.aggregate({
          where: { ...where, status: 'PAID' },
          _sum: { amount: true }
        }),
        this.prisma.paymentHistory.groupBy({
          by: ['paymentMethod'],
          where,
          _count: { paymentMethod: true }
        }),
        this.prisma.paymentHistory.groupBy({
          by: ['status'],
          where,
          _count: { status: true }
        })
      ]);

      const statistics = {
        totalPayments,
        successfulPayments: paidPayments,
        failedPayments,
        pendingPayments,
        successRate: totalPayments > 0 ? ((paidPayments / totalPayments) * 100).toFixed(2) + '%' : '0%',
        totalRevenue: totalRevenue._sum.amount || 0,
        currency: 'IDR',
        paymentMethods: paymentsByMethod.reduce((acc, item) => {
          acc[item.paymentMethod] = item._count.paymentMethod;
          return acc;
        }, {}),
        statusBreakdown: paymentsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count.status;
          return acc;
        }, {}),
        dateRange: {
          from: dateFrom.toISOString(),
          to: dateTo.toISOString()
        }
      };

      return {
        success: true,
        data: statistics,
        correlationId
      };

    } catch (error) {
      this.logger.error('Failed to get payment statistics', {
        error: error.message
      }, { correlationId });

      throw error;
    }
  }

  /**
   * 🧹 CLEANUP & MAINTENANCE
   */

  async cleanup() {
    await this.prisma.$disconnect();
    console.log('✅ PaymentRepository cleanup completed');
  }
}

module.exports = PaymentRepository;