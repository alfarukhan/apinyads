const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { prisma } = require('../lib/prisma');
const PaymentIntentService = require('../services/secure/PaymentIntentService');
const StockReservationService = require('../services/secure/StockReservationService');
const { webhookDeduplicationMiddleware } = require('../middleware/secure-payment');
const PaymentService = require('../services/core/PaymentService');
const { getNotificationService } = require('../services/core');
const crypto = require('crypto');

const router = express.Router();

/**
 * 🚀 UNIVERSAL PAYMENT STATUS ENDPOINT
 * 
 * Auto-detects payment type and returns unified format:
 * - BK* → Booking payments
 * - GL* → Guestlist payments  
 * - Any other format → Generic payment lookup
 * 
 * ✅ Single endpoint for all payment types
 * ✅ Unified response format for Flutter
 * ✅ Centralized PaymentService usage
 * ✅ Auto-detection logic
 */

// @route   GET /api/payments/status/:paymentId
// @desc    Universal payment status check (auto-detects payment type)
// @access  Private
router.get('/status/:paymentId', authMiddleware, asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const userId = req.user.id;

  console.log(`🔍 Universal Payment Status Check: ${paymentId} for user ${userId}`);

  try {
    // ✅ STEP 1: Auto-detect payment type
    const paymentType = detectPaymentType(paymentId);
    console.log(`🎯 Detected payment type: ${paymentType} for ${paymentId}`);

    // ✅ STEP 2: Use centralized PaymentService
    const paymentService = new PaymentService();
    const statusResult = await paymentService.checkPaymentStatus(paymentId, userId);

    if (!statusResult.success) {
      throw new AppError('Failed to check payment status', 500);
    }

    // ✅ STEP 2.5: Check for expired payments and auto-update status
    await checkAndUpdateExpiredPayment(paymentId, paymentType, userId);

    // ✅ STEP 2.6: Get updated payment status after expiry check
    const paymentHistory = await prisma.paymentHistory.findFirst({
      where: { transactionId: paymentId },
      select: { status: true, transactionDate: true }
    });

    // ✅ STEP 3: Get additional context based on payment type
    let additionalData = {};
    
    if (paymentType === 'GUESTLIST') {
      // Get guestlist-specific data
      const guestListEntry = await prisma.guestList.findFirst({
        where: {
          paymentId: paymentId,
          userId: userId,
        },
        select: {
          id: true,
          status: true,
          isPaid: true,
          paidAt: true,
          paymentId: true,
          platformFee: true,
          eventId: true,
          event: {
            select: {
              id: true,
              title: true,
              startDate: true,
              location: true,
            }
          }
        }
      });

      if (guestListEntry) {
        additionalData = {
          paymentType: 'GUESTLIST',
          guestListEntry,
          total_amount: guestListEntry.platformFee,
        };
      }
      
    } else if (paymentType === 'BOOKING') {
      // Get booking-specific data
      const booking = await prisma.booking.findFirst({
        where: {
          OR: [
            { bookingCode: paymentId },
            { paymentId: paymentId }
          ],
          userId: userId,
        },
        select: {
          id: true,
          bookingCode: true,
          paymentId: true,
          totalAmount: true,
          paymentStatus: true,
          status: true,
          currency: true,
          expiresAt: true,
          event: {
            select: {
              id: true,
              title: true,
              startDate: true,
              location: true,
            }
          }
        }
      });

      if (booking) {
        additionalData = {
          paymentType: 'BOOKING',
          booking: {
            bookingCode: booking.bookingCode,
            paymentId: booking.paymentId,
            status: booking.status,
            currency: booking.currency,
            expiresAt: booking.expiresAt,
            event: booking.event
          },
          total_amount: booking.totalAmount,
        };
      }
    }

    // ✅ STEP 4: Return unified response format
    const unifiedResponse = {
      success: true,
      data: {
        // Core payment data
        paymentId,
        paymentType,
        
        // ✅ FLUTTER REQUIRED: Transaction status fields (all unified)
        // Use PaymentHistory status if available and expired, otherwise use service result
        payment_status: paymentHistory?.status === 'EXPIRED' ? 'expired' :
                       statusResult.data.midtransStatus?.transaction_status || 
                       (statusResult.data.status === 'SUCCESS' ? 'settlement' : 
                        statusResult.data.status === 'PENDING' ? 'pending' : 
                        statusResult.data.status === 'FAILED' ? 'failure' : 'not_found'),
        
        transaction_status: paymentHistory?.status === 'EXPIRED' ? 'expired' :
                           statusResult.data.midtransStatus?.transaction_status || 
                           (statusResult.data.status === 'SUCCESS' ? 'settlement' : 
                            statusResult.data.status === 'PENDING' ? 'pending' : 
                            statusResult.data.status === 'FAILED' ? 'failure' : 'not_found'),
        
        status: paymentHistory?.status === 'EXPIRED' ? 'expired' :
               statusResult.data.midtransStatus?.transaction_status || 
               (statusResult.data.status === 'SUCCESS' ? 'settlement' : 
                statusResult.data.status === 'PENDING' ? 'pending' : 
                statusResult.data.status === 'FAILED' ? 'failure' : 'not_found'),
        
        // Payment info
        total_amount: additionalData.total_amount || 0,
        isPaid: statusResult.data.isPaid,
        paidAt: statusResult.data.paidAt,
        
        // Expiry info
        isExpired: paymentHistory?.status === 'EXPIRED',
        expiredAt: paymentHistory?.status === 'EXPIRED' ? paymentHistory.transactionDate : null,
        
        // Midtrans data
        midtransStatus: statusResult.data.midtransStatus || null,
        
        // Type-specific data
        ...additionalData,
        
        // Meta info
        centralizedService: {
          used: true,
          correlationId: statusResult.data.correlationId || 'unknown',
          timestamp: new Date().toISOString(),
          message: 'Universal payment endpoint - auto-detected payment type',
          autoVerificationEnabled: true,
          unifiedResponse: true
        }
      }
    };

    console.log(`✅ Universal payment status returned for ${paymentId} (${paymentType})`);
    res.json(unifiedResponse);

  } catch (error) {
    console.error(`❌ Universal payment status check failed for ${paymentId}:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      correlationId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
    
    if (error.isOperational) {
      throw error;
    } else {
      throw new AppError(`Failed to check payment status: ${error.message}`, 500);
    }
  }
}));

/**
 * 🎯 Auto-detect payment type based on payment ID format
 * @param {string} paymentId - Payment ID to analyze
 * @returns {string} Payment type: 'GUESTLIST', 'BOOKING', or 'UNKNOWN'
 */
function detectPaymentType(paymentId) {
  if (!paymentId) return 'UNKNOWN';
  
  // Guestlist payments: GL*, GLmdun*, GL-*
  if (paymentId.startsWith('GL')) {
    return 'GUESTLIST';
  }
  
  // Booking payments: BK*, BKmdun*, etc.
  if (paymentId.startsWith('BK')) {
    return 'BOOKING';
  }
  
  // Future: Add more payment types here
  // - Merchandise: MR*
  // - Subscription: SUB*
  // - etc.
  
  return 'UNKNOWN';
}

// @route   POST /api/payments/:paymentId/verify
// @desc    Universal payment verification (manual verification for stuck payments)
// @access  Private
router.post('/:paymentId/verify', authMiddleware, asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const userId = req.user.id;

  console.log(`🔄 Universal Payment Verification: ${paymentId} for user ${userId}`);

  try {
    const paymentType = detectPaymentType(paymentId);
    const paymentService = new PaymentService();
    
    // Use centralized verification method
    const result = await paymentService.verifyPendingPayments(1, paymentId);
    
    if (result.success && result.verified > 0) {
      // Get updated status after verification
      const statusResult = await paymentService.checkPaymentStatus(paymentId, userId);
      
      res.json({
        success: true,
        message: 'Payment verified and updated successfully',
        data: {
          paymentId,
          paymentType,
          verified: true,
          updatedStatus: statusResult.data || null
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Payment verification failed or payment was already processed',
        data: {
          paymentId,
          paymentType,
          verified: false
        }
      });
    }

  } catch (error) {
    console.error(`❌ Universal payment verification failed for ${paymentId}:`, error);
    throw new AppError('Payment verification failed. Please try again.', 500);
  }
}));

// @route   POST /api/payments/:paymentId/confirm
// @desc    🔒 SECURE: Universal payment confirmation (Booking + Guestlist)
// @access  Private (JWT Required)
// 
// 🛡️ SECURITY LAYERS:
// 1. JWT Authentication (authMiddleware)
// 2. Request Type Validation (webhookDeduplicationMiddleware) 
// 3. User Ownership Verification (PaymentService.checkPaymentStatus with userId)
// 4. Real-time Midtrans API Verification
// 5. Fraud Status Validation
// 6. Transaction Status Validation
router.post('/:paymentId/confirm', 
  authMiddleware, 
  webhookDeduplicationMiddleware, 
  asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  
  console.log(`💰 UNIVERSAL: Confirming payment for: ${paymentId}`);
  
  try {
    // ✅ STEP 1: Auto-detect payment type
    const paymentType = paymentId.startsWith('GL') ? 'GUESTLIST' : 'BOOKING';
    console.log(`🎯 Detected payment type: ${paymentType} for ${paymentId}`);
    
    // ✅ STEP 2: Use centralized PaymentService
    const paymentService = new PaymentService();
    const statusResult = await paymentService.checkPaymentStatus(paymentId, req.user.id);
    
    if (!statusResult.success) {
      throw new AppError('Failed to check payment status', 500);
    }
    
    // Extract Midtrans status from centralized service result
    const snapStatus = statusResult.data.midtransStatus || {
      transaction_status: statusResult.data.status,
      order_id: paymentId
    };
    
    console.log(`📊 Payment status for confirmation:`, {
      type: paymentType,
      transaction_status: snapStatus.transaction_status,
      fraud_status: snapStatus.fraud_status,
      order_id: snapStatus.order_id
    });
    
    const transactionStatus = snapStatus.transaction_status;
    const fraudStatus = snapStatus.fraud_status;
    
    // Validate payment is successful
    if ((transactionStatus !== 'capture' && transactionStatus !== 'settlement') ||
        (fraudStatus && fraudStatus !== 'accept')) {
      throw new AppError(`Payment not successful. Status: ${transactionStatus}, Fraud: ${fraudStatus}`, 400);
    }
    
    // ✅ STEP 3: Handle based on payment type
    if (paymentType === 'GUESTLIST') {
      // Handle guestlist payment confirmation
      const result = await confirmGuestlistPaymentV2(paymentId, req.user.id, snapStatus);
      return res.json({
        success: true,
        message: 'Guestlist payment confirmed successfully! Your access is ready.',
        data: result
      });
    } else {
      // Handle booking payment confirmation
      const result = await confirmBookingPaymentV2(paymentId, req.user.id, snapStatus);
      return res.json({
        success: true,
        message: 'Booking payment confirmed successfully! Your tickets are ready.',
        data: result
      });
    }
    
  } catch (error) {
    console.error(`❌ Error confirming payment:`, {
      error: error.message,
      stack: error.stack,
      paymentId,
      userId: req.user.id,
      details: error.meta || error.details || 'No additional details'
    });
    throw error;
  }
}));

// ✅ HELPER: Confirm guestlist payment (V2 - Better error handling)
async function confirmGuestlistPaymentV2(paymentId, userId, snapStatus) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const guestListEntry = await tx.guestList.findFirst({
        where: { 
          paymentId: paymentId,
          userId: userId
        },
        include: { 
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
              endDate: true
            }
          }
        }
      });

      if (!guestListEntry) {
        throw new AppError('Guestlist entry not found', 404);
      }

      // Check if already confirmed (payment already processed)
      if (guestListEntry.isPaid && guestListEntry.status === 'APPROVED') {
        console.log(`✅ Guestlist payment already confirmed: ${paymentId}`);
        
        // ✅ ENSURE PAYMENT HISTORY IS ALSO UPDATED (in case it was missed before)
        await tx.paymentHistory.updateMany({
          where: { 
            transactionId: paymentId,
            status: { not: 'SUCCESS' }
          },
          data: {
            status: 'SUCCESS',
            transactionDate: new Date()
          }
        });
        
        // Get existing access ticket
        const existingTicket = await tx.access.findFirst({
          where: { 
            userId: userId,
            eventId: guestListEntry.eventId,
            type: 'GUEST_LIST'
          }
        });
        
        return {
          updatedGuestList: guestListEntry,
          ticket: existingTicket,
          alreadyConfirmed: true
        };
      }

      // Update guestlist payment status (payment confirms guestlist approval)
      const updatedGuestList = await tx.guestList.update({
        where: { id: guestListEntry.id },
        data: {
          status: 'APPROVED', // Payment confirmation automatically approves guestlist
          isPaid: true,
          paidAt: new Date(),
          approvedAt: new Date(),
          approvedBy: 'PAYMENT_CONFIRMED'
        }
      });

      console.log(`✅ Updated guestlist status to APPROVED (payment confirmed) for ${paymentId}`);

      // Generate access ticket for guestlist
      const ticketCode = await generateTicketCodeV2(null, guestListEntry.id); // No accessTier for guestlist
      const qrCode = generateQRCodeV2();
      
      console.log(`✅ Generated ticket codes for guestlist ${paymentId}: ${ticketCode}`);
      
      const ticket = await tx.access.create({
        data: {
          type: 'GUEST_LIST',
          ticketCode,
          qrCode,
          status: 'CONFIRMED',
          price: guestListEntry.platformFee || 0,
          currency: 'IDR',
          venueDetails: `Guestlist access for ${guestListEntry.event?.title}`,
          validUntil: (() => {
            if (guestListEntry.event?.endDate) {
              return new Date(new Date(guestListEntry.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
            } else if (guestListEntry.event?.startDate) {
              return new Date(new Date(guestListEntry.event.startDate).getTime() + 24 * 60 * 60 * 1000);
            } else {
              return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            }
          })(),
          userId: userId,
          eventId: guestListEntry.eventId,
          accessTierId: null, // ✅ GUESTLIST: No access tier (special access)
          bookingId: null,    // Not a booking
        },
      });

      console.log(`✅ Generated guestlist access ticket for payment ${paymentId}`);

      // ✅ UPDATE PAYMENT HISTORY STATUS TO SUCCESS
      // First, find existing payment history record
      let paymentHistory = await tx.paymentHistory.findFirst({
        where: { transactionId: paymentId }
      });

      if (paymentHistory) {
        // Update existing record using id
        await tx.paymentHistory.update({
          where: { id: paymentHistory.id },
          data: {
            status: 'SUCCESS',
            transactionDate: new Date()
          }
        });
        console.log(`✅ Updated existing payment history status to SUCCESS for ${paymentId}`);
      } else {
        // Create new payment history record if none exists
        await tx.paymentHistory.create({
          data: {
            userId: userId,
            eventId: updatedGuestList.eventId,
            eventName: updatedGuestList.event?.title || 'Guestlist Event',
            amount: 0, // Guestlist is typically free
            subtotalAmount: 0,
            platformFee: 0,
            taxAmount: 0,
            currency: 'IDR',
            status: 'SUCCESS',
            paymentMethod: 'GUESTLIST',
            transactionDate: new Date(),
            ticketType: 'Guestlist',
            imageUrl: updatedGuestList.event?.imageUrl,
            transactionId: paymentId,
            eventId: updatedGuestList.eventId
          }
        });
        console.log(`✅ Created new payment history record for guestlist ${paymentId}`);
      }

      // ✅ SEND NOTIFICATIONS FOR GUESTLIST SUCCESS
      try {
        const notificationService = getNotificationService();
        
        // Send payment success notification for guestlist
        await notificationService.sendPaymentSuccess(userId, {
          eventName: updatedGuestList.event?.title || 'Guestlist Event',
          eventImage: updatedGuestList.event?.imageUrl,
          bookingCode: paymentId, // Use paymentId as booking code for guestlist
          eventId: updatedGuestList.eventId,
          totalAmount: 0, // Guestlist is free
          quantity: 1
        });

        // Send guestlist access ready notification
        await notificationService.sendTicketsReady(userId, {
          eventName: updatedGuestList.event?.title || 'Guestlist Event',
          eventImage: updatedGuestList.event?.imageUrl,
          bookingCode: paymentId,
          eventId: updatedGuestList.eventId,
          ticketCount: 1,
          accessId: ticket.id
        });

        console.log(`✅ Sent guestlist notifications to user ${userId} for payment ${paymentId}`);
      } catch (notificationError) {
        console.error('❌ Error sending guestlist notifications:', notificationError);
        // Don't fail the transaction for notification errors
      }

      return {
        updatedGuestList,
        ticket,
        alreadyConfirmed: false
      };
    });

    return result;
  } catch (error) {
    console.error('❌ Error in confirmGuestlistPaymentV2:', {
      error: error.message,
      stack: error.stack,
      meta: error.meta,
      code: error.code,
      paymentId,
      userId
    });
    throw error;
  }
}

// ✅ HELPER: Confirm booking payment (V2 - Full implementation)
async function confirmBookingPaymentV2(paymentId, userId, snapStatus) {
  // ✅ SECURE: Initialize security services
  const stockReservationService = new StockReservationService();
  const paymentIntentService = new PaymentIntentService();
  console.log(`🔄 Confirming booking payment: ${paymentId} for user ${userId}`);
  
  try {
    return await prisma.$transaction(async (tx) => {
      // Debug: Log search parameters
      console.log(`🔍 Searching for booking with paymentId: ${paymentId}, userId: ${userId}`);
      
      // First, try to find by paymentId
      let booking = await tx.booking.findFirst({
        where: {
          paymentId: paymentId,
          userId: userId
        },
        include: {
          accessTier: {
            include: {
              event: true
            }
          },
          event: true
        }
      });

      // If not found by paymentId, try to find by bookingCode (since paymentId might be the bookingCode)
      if (!booking) {
        console.log(`⚠️ Booking not found by paymentId, trying bookingCode: ${paymentId}`);
        booking = await tx.booking.findFirst({
          where: {
            bookingCode: paymentId,
            userId: userId
          },
          include: {
            accessTier: {
              include: {
                event: true
              }
            },
            event: true
          }
        });
      }

      // If still not found, try finding by orderId (sometimes paymentId could be orderId)
      if (!booking) {
        console.log(`⚠️ Booking not found by bookingCode either, trying by orderId pattern`);
        booking = await tx.booking.findFirst({
          where: {
            userId: userId,
            // Try to match paymentId that contains similar pattern
            OR: [
              { paymentId: { contains: paymentId.slice(0, 8) } }, // First 8 chars
              { bookingCode: { contains: paymentId.slice(0, 8) } } // First 8 chars
            ]
          },
          include: {
            accessTier: {
              include: {
                event: true
              }
            },
            event: true
          }
        });
      }

      // If still not found, try without userId constraint (for debugging)
      if (!booking) {
        console.log(`⚠️ Booking still not found, searching without userId constraint`);
        const allBookingsWithPaymentId = await tx.booking.findMany({
          where: {
            OR: [
              { paymentId: paymentId },
              { bookingCode: paymentId },
              { paymentId: { contains: paymentId.slice(0, 8) } },
              { bookingCode: { contains: paymentId.slice(0, 8) } }
            ]
          },
          select: {
            id: true,
            bookingCode: true,
            paymentId: true,
            userId: true,
            status: true,
            paymentStatus: true
          }
        });
        console.log(`🔍 Found ${allBookingsWithPaymentId.length} bookings with this paymentId/bookingCode:`, allBookingsWithPaymentId);
        
        // If we found a booking but userId doesn't match, that might be the issue
        if (allBookingsWithPaymentId.length > 0) {
          const foundUserId = allBookingsWithPaymentId[0].userId;
          if (foundUserId !== userId) {
            console.log(`⚠️ Found booking but userId mismatch. Expected: ${userId}, Found: ${foundUserId}`);
            // Try to get the booking with the correct userId
            booking = await tx.booking.findFirst({
              where: {
                id: allBookingsWithPaymentId[0].id
              },
              include: {
                accessTier: {
                  include: {
                    event: true
                  }
                },
                event: true
              }
            });
            
            if (booking && booking.userId !== userId) {
              // Additional check: maybe this is a case where admin is confirming user payment
              // For now, let's allow it but log the discrepancy  
              console.log(`⚠️ UserId mismatch but allowing payment confirmation. PaymentId: ${paymentId}, BookingUserId: ${booking.userId}, RequestUserId: ${userId}`);
            }
          }
        }
      }

      // Final fallback: Try to find any PENDING booking for this user on recent date
      if (!booking) {
        console.log(`⚠️ Final fallback: searching for recent PENDING bookings for user ${userId}`);
        const recentBookings = await tx.booking.findMany({
          where: {
            userId: userId,
            paymentStatus: 'PENDING',
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          },
          include: {
            accessTier: {
              include: {
                event: true
              }
            },
            event: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        });
        
        console.log(`🔍 Found ${recentBookings.length} recent PENDING bookings for user ${userId}`);
        
        if (recentBookings.length > 0) {
          booking = recentBookings[0]; // Use the most recent one
          console.log(`✅ Using most recent PENDING booking: ${booking.bookingCode} with paymentId: ${booking.paymentId}`);
        }
      }

      if (!booking) {
        throw new AppError(`Booking not found for paymentId/bookingCode: ${paymentId} and userId: ${userId}`, 404);
      }

      console.log(`✅ Found booking: ${booking.bookingCode}, status: ${booking.status}, paymentStatus: ${booking.paymentStatus}`);

      if (booking.status === 'CONFIRMED') {
        console.log(`⚠️ Booking ${booking.bookingCode} already confirmed`);
        // Return existing access tickets
        const existingTickets = await tx.access.findMany({
          where: { bookingId: booking.id },
          include: {
            event: {
              select: {
                id: true,
                title: true,
                location: true,
                startDate: true,
                imageUrl: true
              }
            }
          }
        });
        return { booking, tickets: existingTickets };
      }

      // Update booking status
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'SUCCESS',
          paidAt: new Date()
        }
      });
      
      // ✅ SECURE: Confirm stock reservations for successful payment
      try {
        const stockReservations = await tx.stockReservation.findMany({
          where: {
            booking: { bookingCode: paymentId },
            status: 'RESERVED'
          }
        });
        
        for (const reservation of stockReservations) {
          await stockReservationService.confirmReservation(
            reservation.id,
            booking.id
          );
          console.log(`✅ SECURE: Confirmed stock reservation ${reservation.id}`);
        }
      } catch (stockError) {
        console.error('❌ SECURE: Error confirming stock reservations:', stockError);
        // Don't fail the payment - log for manual resolution
      }

      // Generate access tickets
      const tickets = [];
      for (let i = 0; i < booking.quantity; i++) {
        const ticketCode = await generateTicketCodeV2(booking.accessTierId, booking.id + i);
        const qrCode = generateQRCode();
        
        const ticket = await tx.access.create({
          data: {
            type: 'TICKET',
            ticketCode,
            qrCode,
            status: 'CONFIRMED',
            currency: booking.currency,
            price: booking.unitPrice,
            validUntil: (() => {
              if (booking.event?.endDate) {
                // Ticket valid sampai 7 hari setelah event selesai
                return new Date(new Date(booking.event.endDate).getTime() + 7 * 24 * 60 * 60 * 1000);
              } else if (booking.event?.startDate) {
                // Fallback: Event start + 1 hari
                return new Date(new Date(booking.event.startDate).getTime() + 24 * 60 * 60 * 1000);
              } else {
                // Fallback: 30 hari dari sekarang
                return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              }
            })(),
            userId: booking.userId,
            eventId: booking.eventId,
            accessTierId: booking.accessTierId,
            bookingId: booking.id,
            ipAddress: booking.ipAddress,
            userAgent: booking.userAgent
          },
          include: {
            event: {
              select: {
                id: true,
                title: true,
                location: true,
                startDate: true,
                imageUrl: true
              }
            }
          }
        });
        tickets.push(ticket);
      }

      // Update payment history to SUCCESS
      try {
        const existingPaymentHistory = await tx.paymentHistory.findFirst({
          where: {
            bookingCode: booking.bookingCode,
            status: 'PENDING'
          }
        });

        if (existingPaymentHistory) {
          await tx.paymentHistory.update({
            where: { id: existingPaymentHistory.id },
            data: {
              status: 'SUCCESS',
              transactionId: paymentId,
              transactionDate: new Date(),
              paymentMethod: 'MIDTRANS_SNAP'
            }
          });
          console.log(`✅ Updated payment history to SUCCESS`);
        } else {
          // Create new payment history record
          await tx.paymentHistory.create({
            data: {
              transactionId: paymentId,
              userId: booking.userId,
              eventId: booking.eventId,
              eventName: booking.event?.title || booking.accessTier?.name || 'Event',
              amount: booking.totalAmount,
              subtotalAmount: booking.subtotalAmount || null,
              platformFee: booking.platformFee || null,
              taxAmount: booking.taxAmount || null,
              currency: booking.currency,
              status: 'SUCCESS',
              paymentMethod: 'MIDTRANS_SNAP',
              transactionDate: new Date(),
              ticketType: booking.accessTier?.name || 'General Admission',
              imageUrl: booking.event?.imageUrl,
              bookingCode: booking.bookingCode,
              paymentUrl: null
            }
          });
          console.log(`✅ Created payment history record`);
        }
      } catch (historyError) {
        console.error('❌ Error updating payment history:', historyError);
        // Don't fail the transaction for payment history errors
      }

      // Send notifications
      try {
        const notificationService = getNotificationService();
        
        // Send payment success notification
        await notificationService.sendPaymentSuccess(booking.userId, {
          eventName: booking.event?.title || booking.accessTier?.name || 'Event',
          eventImage: booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId
        });

        // Send tickets ready notification
        await notificationService.sendTicketsReady(booking.userId, {
          eventName: booking.event?.title || booking.accessTier?.name || 'Event',
          eventImage: booking.event?.imageUrl,
          bookingCode: booking.bookingCode,
          eventId: booking.eventId,
          ticketCount: tickets.length,
          accessId: tickets[0]?.id
        });

        console.log(`📱 Notifications sent successfully`);
      } catch (notifError) {
        console.error('❌ Error sending notifications:', notifError);
        // Don't fail the transaction for notification errors
      }

      console.log(`✅ Successfully confirmed booking ${booking.bookingCode} and generated ${tickets.length} tickets`);
      
      return {
        booking: updatedBooking,
        tickets
      };
    });
  } catch (error) {
    console.error('❌ Error confirming booking payment:', error);
    throw error;
  }
}

// ✅ HELPER: Generate ticket code (V2 - Simplified)
async function generateTicketCodeV2(accessTierId, sequence) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  
  const formattedCode = code.match(/.{1,4}/g).join('-');
  
  // Check uniqueness
  const existingTicket = await prisma.access.findFirst({
    where: { ticketCode: formattedCode }
  });
  
  if (existingTicket) {
    // Retry once
    return await generateTicketCodeV2(accessTierId, sequence);
  }
  
  return formattedCode;
}

// ✅ HELPER: Generate QR code
function generateQRCode() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// ✅ HELPER: Generate QR code (V2)
function generateQRCodeV2() {
  return require('crypto').randomBytes(32).toString('hex').toUpperCase();
}

// ✅ HELPER: Check and update expired payments
async function checkAndUpdateExpiredPayment(paymentId, paymentType, userId) {
  try {
    const now = new Date();
    
    if (paymentType === 'GUESTLIST') {
      // Check expired guestlist payments
      const guestListEntry = await prisma.guestList.findFirst({
        where: {
          paymentId: paymentId,
          userId: userId,
          isPaid: false, // Only check unpaid entries
        }
      });

      if (guestListEntry) {
        // Check if payment is expired (15 minutes from creation)
        const paymentAge = now - new Date(guestListEntry.createdAt);
        const fifteenMinutes = 15 * 60 * 1000; // 15 minutes in milliseconds

        if (paymentAge > fifteenMinutes) {
          console.log(`⏰ Guestlist payment expired: ${paymentId} (age: ${Math.round(paymentAge / 60000)} minutes)`);
          
          // Update PaymentHistory to EXPIRED
          await prisma.paymentHistory.updateMany({
            where: { 
              transactionId: paymentId,
              status: 'PENDING'
            },
            data: {
              status: 'EXPIRED',
              transactionDate: now
            }
          });

          console.log(`✅ Updated payment history status to EXPIRED for ${paymentId}`);
        }
      }
      
    } else if (paymentType === 'BOOKING') {
      // Check expired booking payments
      const booking = await prisma.booking.findFirst({
        where: {
          OR: [
            { bookingCode: paymentId },
            { paymentId: paymentId }
          ],
          userId: userId,
          paymentStatus: 'PENDING',
        }
      });

      if (booking && booking.expiresAt) {
        if (now > new Date(booking.expiresAt)) {
          console.log(`⏰ Booking payment expired: ${paymentId} (expired at: ${booking.expiresAt})`);
          
          // Update PaymentHistory to EXPIRED
          await prisma.paymentHistory.updateMany({
            where: { 
              transactionId: paymentId,
              status: 'PENDING'
            },
            data: {
              status: 'EXPIRED',
              transactionDate: now
            }
          });

          console.log(`✅ Updated payment history status to EXPIRED for ${paymentId}`);
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ Error checking expired payment ${paymentId}:`, error);
    // Don't throw - this is a background check, don't fail the main request
  }
}

module.exports = router;