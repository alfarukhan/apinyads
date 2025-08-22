/**
 * Enhanced error handler specifically for webhook endpoints
 * Provides comprehensive logging and monitoring for payment webhook failures
 */

const webhookErrorHandler = (err, req, res, next) => {
  const isWebhook = req.path.includes('/webhook');
  
  if (!isWebhook) {
    return next(err);
  }

  // Enhanced webhook error logging
  console.error('🚨 [WEBHOOK ERROR] Payment webhook processing failed:', {
    error: {
      message: err.message,
      stack: err.stack,
      name: err.name
    },
    webhook: {
      orderId: req.body?.order_id,
      transactionStatus: req.body?.transaction_status,
      fraudStatus: req.body?.fraud_status,
      paymentType: req.body?.payment_type,
      grossAmount: req.body?.gross_amount
    },
    request: {
      method: req.method,
      path: req.path,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      body: process.env.NODE_ENV !== 'production' ? req.body : '[HIDDEN IN PRODUCTION]'
    },
    timing: {
      startTime: req.webhookStartTime,
      processingTime: req.webhookStartTime ? Date.now() - req.webhookStartTime : null,
      timestamp: new Date().toISOString()
    }
  });

  // Send critical alert for payment webhook failures
  console.log('🚨 [CRITICAL ALERT] Payment webhook failed - manual intervention may be required!');
  console.log('🚨 [RECOVERY HINT] Use payment verification endpoint to recover: POST /api/bookings/:bookingCode/verify-payment');
  
  // Log specific error types for better debugging
  if (err.message.includes('not found')) {
    console.log('🔍 [DEBUG] Booking/guestlist not found - check if orderId format is correct');
  } else if (err.message.includes('signature')) {
    console.log('🔍 [DEBUG] Signature validation failed - check Midtrans configuration');
  } else if (err.message.includes('database') || err.message.includes('prisma')) {
    console.log('🔍 [DEBUG] Database error - check database connection and schema');
  } else if (err.message.includes('notification')) {
    console.log('🔍 [DEBUG] Notification service error - payment processed but notification failed');
  }

  // Return appropriate webhook response (Midtrans expects specific format)
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({
    success: false,
    message: 'Webhook processing failed',
    error: {
      message: err.message,
      orderId: req.body?.order_id,
      timestamp: new Date().toISOString()
    },
    // Include recovery instructions
    recovery: {
      hint: 'If payment was successful, use manual verification endpoint',
      endpoint: `/api/bookings/${req.body?.order_id}/verify-payment`,
      adminEndpoint: '/api/bookings/admin/recover-payments'
    }
  });
};

module.exports = webhookErrorHandler;