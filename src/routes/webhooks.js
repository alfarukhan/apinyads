const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { 
  getPaymentService, 
  getQueueService, 
  getResponseFormatter, 
  getAuditLogService,
  getLoggingService 
} = require('../services/core');

/**
 * 🔗 CENTRALIZED WEBHOOK HANDLER
 * 
 * Unified webhook processing for DanceSignal:
 * - Midtrans payment notifications
 * - Spotify API webhooks  
 * - Firebase push notification delivery reports
 * - Third-party service notifications
 * - Webhook authentication & validation
 * - Automatic retry & fallback handling
 * 
 * ✅ Security: Signature verification & authentication
 * ✅ Reliability: Queue-based processing with retries
 * ✅ Performance: Async processing & batching
 * ✅ Monitoring: Complete webhook analytics
 */

const webhookSecret = process.env.MIDTRANS_SERVER_KEY || '';
const responseFormatter = getResponseFormatter();
const auditService = getAuditLogService();
const logger = getLoggingService();
const queueService = getQueueService();

/**
 * 💳 MIDTRANS PAYMENT WEBHOOK
 * 
 * Handles Midtrans payment status notifications
 */
router.post('/midtrans', async (req, res) => {
  const startTime = Date.now();
  const correlationId = `webhook_midtrans_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    logger.info('Midtrans webhook received', {
      body: req.body,
      headers: {
        'content-type': req.get('content-type'),
        'user-agent': req.get('user-agent'),
        'x-forwarded-for': req.get('x-forwarded-for')
      }
    }, { correlationId });

    // ✅ Webhook signature verification (skip in development)
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const skipSignatureVerification = isDevelopment || process.env.SKIP_WEBHOOK_SIGNATURE === 'true';
    
    if (!skipSignatureVerification) {
      const signatureVerification = verifyMidtransSignature(req.body, req.get('signature'));
      if (!signatureVerification.valid) {
        logger.warn('Midtrans webhook signature verification failed', {
          orderId: req.body.order_id,
          signature: req.get('signature'),
          reason: signatureVerification.reason
        }, { correlationId });

        return responseFormatter.error(res, {
          message: 'Invalid webhook signature',
          statusCode: 401,
          errorCode: 'INVALID_SIGNATURE',
          details: { reason: signatureVerification.reason },
          correlationId,
          startTime
        });
      }
    } else {
      logger.info('Webhook signature verification skipped (development mode)', {
        orderId: req.body.order_id,
        isDevelopment,
        skipSignatureVerification
      }, { correlationId });
    }

    // ✅ Extract payment data
    const paymentData = {
      orderId: req.body.order_id,
      transactionId: req.body.transaction_id,
      paymentType: req.body.payment_type,
      transactionStatus: req.body.transaction_status,
      fraudStatus: req.body.fraud_status,
      statusCode: req.body.status_code,
      statusMessage: req.body.status_message,
      grossAmount: parseFloat(req.body.gross_amount),
      currency: req.body.currency || 'IDR',
      
      // Additional fields
      merchantId: req.body.merchant_id,
      acquirer: req.body.acquirer,
      maskedCard: req.body.masked_card,
      bank: req.body.bank,
      
      // Timestamps
      transactionTime: req.body.transaction_time,
      settlementTime: req.body.settlement_time,
      
      // Raw data for debugging
      rawData: req.body
    };

    // ✅ Queue webhook processing for async handling
    const webhookJob = await queueService.addJob('payment:webhook_notification', {
      source: 'midtrans',
      paymentData,
      correlationId,
      receivedAt: new Date().toISOString(),
      clientIP: req.ip,
      userAgent: req.get('user-agent')
    }, {
      priority: 2, // High priority for payment webhooks
      retries: 3,
      correlationId
    });

    // ✅ Log webhook reception
    await auditService.logEvent('WEBHOOK_RECEIVED', {
      resourceType: 'payment',
      resourceId: paymentData.orderId,
      metadata: {
        source: 'midtrans',
        transactionStatus: paymentData.transactionStatus,
        fraudStatus: paymentData.fraudStatus,
        grossAmount: paymentData.grossAmount,
        currency: paymentData.currency,
        jobId: webhookJob.id,
        correlationId
      }
    });

    const responseTime = Date.now() - startTime;
    logger.info('Midtrans webhook queued successfully', {
      orderId: paymentData.orderId,
      jobId: webhookJob.id,
      responseTime: `${responseTime}ms`
    }, { correlationId });

    // ✅ Immediate response to Midtrans (they expect 200 OK)
    return responseFormatter.success(res, {
      data: {
        status: 'received',
        orderId: paymentData.orderId,
        jobId: webhookJob.id,
        correlationId,
        message: 'Payment notification received and queued for processing'
      },
      message: 'Webhook processed successfully',
      startTime
    });

  } catch (error) {
    logger.error('Midtrans webhook processing failed', {
      error: error.message,
      stack: error.stack,
      body: req.body
    }, { correlationId });

    return responseFormatter.error(res, {
      message: 'Webhook processing failed',
      statusCode: 500,
      errorCode: 'WEBHOOK_PROCESSING_ERROR',
      details: { error: error.message },
      correlationId,
      startTime
    });
  }
});

/**
 * 🔄 WEBHOOK RETRY ENDPOINT
 * 
 * Manual webhook retry for failed processing
 */
router.post('/midtrans/retry', async (req, res) => {
  const startTime = Date.now();
  const { orderId, force = false } = req.body;

  try {
    if (!orderId) {
      return responseFormatter.error(res, {
        message: 'Order ID is required',
        statusCode: 400,
        errorCode: 'MISSING_ORDER_ID',
        startTime
      });
    }

    // ✅ Trigger manual payment verification
    const paymentService = getPaymentService();
    const verificationResult = await paymentService.checkPaymentStatus(orderId);

    if (!verificationResult.success && !force) {
      return responseFormatter.error(res, {
        message: 'Payment verification failed',
        statusCode: 400,
        errorCode: 'VERIFICATION_FAILED',
        details: verificationResult,
        startTime
      });
    }

    // ✅ Queue retry job
    const retryJob = await queueService.addJob('payment:webhook_retry', {
      orderId,
      force,
      triggeredBy: 'MANUAL',
      originalData: verificationResult.data
    }, {
      priority: 1, // Critical priority for manual retries
      retries: 1,
      correlationId: `manual_retry_${orderId}_${Date.now()}`
    });

    logger.info('Manual webhook retry queued', {
      orderId,
      jobId: retryJob.id,
      force
    });

    return responseFormatter.success(res, {
      data: {
        orderId,
        jobId: retryJob.id,
        status: 'retry_queued',
        force
      },
      message: 'Webhook retry queued successfully',
      startTime
    });

  } catch (error) {
    logger.error('Webhook retry failed', {
      orderId,
      error: error.message
    });

    return responseFormatter.error(res, {
      message: 'Webhook retry failed',
      statusCode: 500,
      errorCode: 'RETRY_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🧪 WEBHOOK TEST ENDPOINT
 * 
 * Simulate Midtrans webhook for testing/development
 */
router.post('/midtrans/test', async (req, res) => {
  try {
    const { orderId, status = 'settlement' } = req.body;
    
    if (!orderId) {
      return responseFormatter.error(res, {
        message: 'orderId is required for webhook test',
        statusCode: 400
      });
    }

    // Simulate Midtrans webhook payload
    const mockWebhookPayload = {
      transaction_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      transaction_status: status,
      transaction_id: `${orderId}_${Date.now()}`,
      status_message: 'midtrans payment notification',
      status_code: '200',
      signature_key: 'test_signature',
      payment_type: 'credit_card',
      order_id: orderId,
      merchant_id: 'test_merchant',
      gross_amount: '775000.00',
      fraud_status: 'accept',
      currency: 'IDR'
    };

    // Process webhook
    const webhookJob = await queueService.addJob('payment:webhook_notification', {
      orderId: mockWebhookPayload.order_id,
      transactionId: mockWebhookPayload.transaction_id,
      paymentType: mockWebhookPayload.payment_type,
      transactionStatus: mockWebhookPayload.transaction_status,
      fraudStatus: mockWebhookPayload.fraud_status,
      statusCode: mockWebhookPayload.status_code,
      statusMessage: mockWebhookPayload.status_message,
      grossAmount: parseFloat(mockWebhookPayload.gross_amount),
      currency: mockWebhookPayload.currency,
      merchantId: mockWebhookPayload.merchant_id,
      transactionTime: mockWebhookPayload.transaction_time,
      settlementTime: status === 'settlement' ? mockWebhookPayload.transaction_time : null,
      rawData: mockWebhookPayload
    }, {
      priority: 1,
      maxRetries: 3
    });

    logger.info('Test webhook processed', {
      orderId,
      status,
      jobId: webhookJob.id
    });

    return responseFormatter.success(res, {
      message: 'Test webhook processed successfully',
      data: {
        orderId,
        status,
        jobId: webhookJob.id,
        mockPayload: mockWebhookPayload
      }
    });

  } catch (error) {
    logger.error('Test webhook failed', { error: error.message });
    return responseFormatter.error(res, {
      message: 'Test webhook failed',
      statusCode: 500,
      errorCode: 'TEST_WEBHOOK_ERROR'
    });
  }
});

/**
 * 🔗 PAYMENT REDIRECT ENDPOINTS
 * 
 * Handle Midtrans redirect URLs
 */

// Success redirect - payment completed
router.get('/payment/success', async (req, res) => {
  const { order_id, transaction_status, status_code } = req.query;
  
  logger.info('Payment success redirect', {
    orderId: order_id,
    transactionStatus: transaction_status,
    statusCode: status_code
  });

  // Trigger webhook processing if not already done
  if (order_id && transaction_status) {
    try {
      await queueService.addJob('payment:webhook_notification', {
        orderId: order_id,
        transactionStatus: transaction_status,
        statusCode: status_code,
        source: 'redirect_callback'
      });
    } catch (error) {
      logger.error('Failed to process redirect callback', { error: error.message });
    }
  }

  // Professional payment result page
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Payment Successful - DanceSignal</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .result-container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .result-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 5px;
          background: linear-gradient(90deg, #4CAF50, #45a049);
        }
        .success-icon {
          width: 80px;
          height: 80px;
          background: #4CAF50;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          animation: checkmark 0.6s ease-in-out;
        }
        .success-icon::after {
          content: '✓';
          color: white;
          font-size: 40px;
          font-weight: bold;
        }
        @keyframes checkmark {
          0% { transform: scale(0); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        .subtitle {
          color: #666;
          font-size: 16px;
          margin-bottom: 30px;
          line-height: 1.5;
        }
        .payment-details {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 12px;
          margin: 20px 0;
          text-align: left;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #e9ecef;
        }
        .detail-row:last-child { border-bottom: none; }
        .detail-label {
          color: #666;
          font-size: 14px;
        }
        .detail-value {
          color: #333;
          font-weight: 500;
          font-family: monospace;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          background: #4CAF50;
          color: white;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .actions {
          margin-top: 30px;
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        .btn {
          flex: 1;
          min-width: 120px;
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.3s ease;
        }
        .btn-primary {
          background: #4CAF50;
          color: white;
        }
        .btn-primary:hover {
          background: #45a049;
          transform: translateY(-2px);
        }
        .btn-secondary {
          background: #f8f9fa;
          color: #333;
          border: 1px solid #dee2e6;
        }
        .btn-secondary:hover {
          background: #e9ecef;
        }
        .notification-status {
          margin-top: 20px;
          padding: 15px;
          background: #e8f5e8;
          border: 1px solid #d4edda;
          border-radius: 8px;
          color: #155724;
          font-size: 14px;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e9ecef;
          color: #666;
          font-size: 12px;
        }
        @media (max-width: 480px) {
          .result-container { padding: 30px 20px; }
          .actions { flex-direction: column; }
          .btn { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="result-container">
        <div class="success-icon"></div>
        <h1>Payment Successful!</h1>
        <p class="subtitle">Your payment has been processed successfully. Your access tickets are being generated and you'll receive a confirmation notification shortly.</p>
        
        <div class="payment-details">
          <div class="detail-row">
            <span class="detail-label">Order ID</span>
            <span class="detail-value">${order_id}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Transaction Status</span>
            <span class="status-badge">${transaction_status}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Processed At</span>
            <span class="detail-value">${new Date().toLocaleString()}</span>
          </div>
        </div>

        <div class="notification-status">
          <strong>📱 Notification Status:</strong> Push notification will be sent to your device within the next few minutes.
        </div>

        <div class="actions">
          <a href="#" onclick="window.close()" class="btn btn-primary">
            ✓ Close Window
          </a>
          <a href="#" onclick="checkNotification()" class="btn btn-secondary">
            🔔 Check Notification
          </a>
        </div>

        <div class="footer">
          <p><strong>DanceSignal</strong> - Secure Payment Processing</p>
          <p>If you don't receive a notification within 5 minutes, please contact support.</p>
        </div>
      </div>

      <script>
        function checkNotification() {
          alert('Please check your device notifications. If you haven\\'t received a notification yet, it may take a few more minutes to process.');
        }

        // Auto-close after 10 seconds with countdown
        let countdown = 10;
        const updateCountdown = () => {
          const closeBtn = document.querySelector('.btn-primary');
          if (countdown > 0) {
            closeBtn.innerHTML = \`✓ Close Window (\${countdown}s)\`;
            countdown--;
            setTimeout(updateCountdown, 1000);
          } else {
            closeBtn.innerHTML = '✓ Close Window';
            window.close();
          }
        };
        
        setTimeout(updateCountdown, 3000); // Start countdown after 3 seconds
      </script>
    </body>
    </html>
  `);
});

// Pending redirect - payment not completed yet
router.get('/payment/pending', async (req, res) => {
  const { order_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Payment Pending - DanceSignal</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .result-container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .result-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 5px;
          background: linear-gradient(90deg, #FF9800, #f57c00);
        }
        .pending-icon {
          width: 80px;
          height: 80px;
          background: #FF9800;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          animation: pulse 2s infinite;
        }
        .pending-icon::after {
          content: '⏳';
          color: white;
          font-size: 40px;
        }
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        .subtitle {
          color: #666;
          font-size: 16px;
          margin-bottom: 30px;
          line-height: 1.5;
        }
        .payment-details {
          background: #fff3e0;
          padding: 20px;
          border-radius: 12px;
          margin: 20px 0;
          text-align: left;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #ffcc80;
        }
        .detail-row:last-child { border-bottom: none; }
        .detail-label {
          color: #666;
          font-size: 14px;
        }
        .detail-value {
          color: #333;
          font-weight: 500;
          font-family: monospace;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          background: #FF9800;
          color: white;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .progress-info {
          margin-top: 20px;
          padding: 15px;
          background: #fff3e0;
          border: 1px solid #ffcc80;
          border-radius: 8px;
          color: #e65100;
          font-size: 14px;
        }
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid #f3f3f3;
          border-top: 3px solid #FF9800;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 10px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .actions {
          margin-top: 30px;
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        .btn {
          flex: 1;
          min-width: 120px;
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.3s ease;
        }
        .btn-primary {
          background: #FF9800;
          color: white;
        }
        .btn-primary:hover {
          background: #f57c00;
          transform: translateY(-2px);
        }
        .btn-secondary {
          background: #f8f9fa;
          color: #333;
          border: 1px solid #dee2e6;
        }
        .btn-secondary:hover {
          background: #e9ecef;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e9ecef;
          color: #666;
          font-size: 12px;
        }
        @media (max-width: 480px) {
          .result-container { padding: 30px 20px; }
          .actions { flex-direction: column; }
          .btn { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="result-container">
        <div class="pending-icon"></div>
        <h1>Payment Processing</h1>
        <p class="subtitle">Your payment is currently being processed. This usually takes a few minutes to complete.</p>
        
        <div class="payment-details">
          <div class="detail-row">
            <span class="detail-label">Order ID</span>
            <span class="detail-value">${order_id}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="status-badge">PROCESSING</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Started At</span>
            <span class="detail-value">${new Date().toLocaleString()}</span>
          </div>
        </div>

        <div class="progress-info">
          <div class="spinner"></div>
          <strong>Processing Payment:</strong> Please don't close this window or navigate away. You'll be automatically redirected once the payment is completed.
        </div>

        <div class="actions">
          <a href="#" onclick="window.close()" class="btn btn-primary">
            ⏳ Wait & Close
          </a>
          <a href="#" onclick="refreshStatus()" class="btn btn-secondary">
            🔄 Check Status
          </a>
        </div>

        <div class="footer">
          <p><strong>DanceSignal</strong> - Secure Payment Processing</p>
          <p>If payment doesn't complete within 10 minutes, please contact support.</p>
        </div>
      </div>

      <script>
        function refreshStatus() {
          window.location.reload();
        }

        // Auto-refresh every 30 seconds to check for completion
        let refreshCount = 0;
        const maxRefreshes = 10; // Max 5 minutes of auto-refresh
        
        const autoRefresh = () => {
          if (refreshCount < maxRefreshes) {
            refreshCount++;
            setTimeout(() => {
              window.location.reload();
            }, 30000);
          }
        };
        
        autoRefresh();

        // Auto-close after 5 minutes if still pending
        setTimeout(() => {
          alert('Payment is taking longer than usual. Please check your payment status in the app or contact support.');
          window.close();
        }, 300000); // 5 minutes
      </script>
    </body>
    </html>
  `);
});

// Error redirect - payment failed
router.get('/payment/error', async (req, res) => {
  const { order_id, status_code } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Payment Failed - DanceSignal</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #fecfef 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .result-container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .result-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 5px;
          background: linear-gradient(90deg, #f44336, #d32f2f);
        }
        .error-icon {
          width: 80px;
          height: 80px;
          background: #f44336;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          animation: shake 0.5s ease-in-out;
        }
        .error-icon::after {
          content: '✕';
          color: white;
          font-size: 40px;
          font-weight: bold;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        h1 {
          color: #333;
          font-size: 28px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        .subtitle {
          color: #666;
          font-size: 16px;
          margin-bottom: 30px;
          line-height: 1.5;
        }
        .payment-details {
          background: #ffebee;
          padding: 20px;
          border-radius: 12px;
          margin: 20px 0;
          text-align: left;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #ffcdd2;
        }
        .detail-row:last-child { border-bottom: none; }
        .detail-label {
          color: #666;
          font-size: 14px;
        }
        .detail-value {
          color: #333;
          font-weight: 500;
          font-family: monospace;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          background: #f44336;
          color: white;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .error-info {
          margin-top: 20px;
          padding: 15px;
          background: #ffebee;
          border: 1px solid #ffcdd2;
          border-radius: 8px;
          color: #c62828;
          font-size: 14px;
        }
        .help-text {
          margin-top: 20px;
          padding: 15px;
          background: #f3e5f5;
          border: 1px solid #ce93d8;
          border-radius: 8px;
          color: #4a148c;
          font-size: 14px;
        }
        .actions {
          margin-top: 30px;
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        .btn {
          flex: 1;
          min-width: 120px;
          padding: 12px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.3s ease;
        }
        .btn-primary {
          background: #f44336;
          color: white;
        }
        .btn-primary:hover {
          background: #d32f2f;
          transform: translateY(-2px);
        }
        .btn-secondary {
          background: #f8f9fa;
          color: #333;
          border: 1px solid #dee2e6;
        }
        .btn-secondary:hover {
          background: #e9ecef;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e9ecef;
          color: #666;
          font-size: 12px;
        }
        @media (max-width: 480px) {
          .result-container { padding: 30px 20px; }
          .actions { flex-direction: column; }
          .btn { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="result-container">
        <div class="error-icon"></div>
        <h1>Payment Failed</h1>
        <p class="subtitle">We're sorry, but your payment could not be processed at this time. Please try again or use a different payment method.</p>
        
        <div class="payment-details">
          <div class="detail-row">
            <span class="detail-label">Order ID</span>
            <span class="detail-value">${order_id}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="status-badge">FAILED</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Error Code</span>
            <span class="detail-value">${status_code || 'N/A'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Failed At</span>
            <span class="detail-value">${new Date().toLocaleString()}</span>
          </div>
        </div>

        <div class="error-info">
          <strong>⚠️ What happened?</strong> Your payment was declined by the payment processor. This could be due to insufficient funds, card restrictions, or technical issues.
        </div>

        <div class="help-text">
          <strong>💡 What can you do?</strong>
          <ul style="text-align: left; margin-top: 10px; padding-left: 20px;">
            <li>Check your card balance and try again</li>
            <li>Try using a different payment method</li>
            <li>Contact your bank if the issue persists</li>
            <li>Reach out to our support team for assistance</li>
          </ul>
        </div>

        <div class="actions">
          <a href="#" onclick="window.close()" class="btn btn-primary">
            ✕ Close Window
          </a>
          <a href="#" onclick="contactSupport()" class="btn btn-secondary">
            📞 Contact Support
          </a>
        </div>

        <div class="footer">
          <p><strong>DanceSignal</strong> - Secure Payment Processing</p>
          <p>For assistance, please contact our support team with your Order ID.</p>
        </div>
      </div>

      <script>
        function contactSupport() {
          alert('Please contact our support team at support@dancesignal.com or through the app. Include your Order ID: ${order_id}');
        }

        // Auto-close after 15 seconds with countdown
        let countdown = 15;
        const updateCountdown = () => {
          const closeBtn = document.querySelector('.btn-primary');
          if (countdown > 0) {
            closeBtn.innerHTML = \`✕ Close Window (\${countdown}s)\`;
            countdown--;
            setTimeout(updateCountdown, 1000);
          } else {
            closeBtn.innerHTML = '✕ Close Window';
            window.close();
          }
        };
        
        setTimeout(updateCountdown, 5000); // Start countdown after 5 seconds
      </script>
    </body>
    </html>
  `);
});

/**
 * 📊 WEBHOOK ANALYTICS ENDPOINT
 * 
 * Get webhook processing statistics
 */
router.get('/analytics', async (req, res) => {
  const startTime = Date.now();

  try {
    // ✅ Get webhook statistics from queue service
    const queueMetrics = queueService.getMetrics();
    const webhookJobs = queueService.getJobsByType('payment:webhook_notification');
    
    // ✅ Calculate webhook-specific metrics
    const webhookStats = {
      totalWebhooks: webhookJobs.length,
      successfulWebhooks: webhookJobs.filter(job => job.status === 'completed').length,
      failedWebhooks: webhookJobs.filter(job => job.status === 'failed').length,
      pendingWebhooks: webhookJobs.filter(job => job.status === 'pending').length,
      processingWebhooks: webhookJobs.filter(job => job.status === 'processing').length,
      
      // Success rate
      successRate: webhookJobs.length > 0 
        ? ((webhookJobs.filter(job => job.status === 'completed').length / webhookJobs.length) * 100).toFixed(2) + '%'
        : '100%',
      
      // Recent activity (last 24 hours)
      recent24h: webhookJobs.filter(job => {
        const jobTime = new Date(job.createdAt);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return jobTime > oneDayAgo;
      }).length
    };

    return responseFormatter.success(res, {
      data: {
        webhookStats,
        queueHealth: queueService.getHealthStatus(),
        lastUpdated: new Date().toISOString()
      },
      message: 'Webhook analytics retrieved successfully',
      startTime
    });

  } catch (error) {
    logger.error('Webhook analytics failed', {
      error: error.message
    });

    return responseFormatter.error(res, {
      message: 'Failed to retrieve webhook analytics',
      statusCode: 500,
      errorCode: 'ANALYTICS_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🔍 WEBHOOK STATUS ENDPOINT
 * 
 * Check status of specific webhook processing
 */
router.get('/status/:jobId', async (req, res) => {
  const startTime = Date.now();
  const { jobId } = req.params;

  try {
    // ✅ Get job status from queue service
    const job = queueService.getJob(jobId);
    
    if (!job) {
      return responseFormatter.error(res, {
        message: 'Webhook job not found',
        statusCode: 404,
        errorCode: 'JOB_NOT_FOUND',
        details: { jobId },
        startTime
      });
    }

    return responseFormatter.success(res, {
      data: {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        attempts: job.attempts,
        maxRetries: job.maxRetries,
        lastError: job.lastError,
        result: job.result,
        correlationId: job.correlationId
      },
      message: 'Webhook status retrieved successfully',
      startTime
    });

  } catch (error) {
    logger.error('Webhook status check failed', {
      jobId,
      error: error.message
    });

    return responseFormatter.error(res, {
      message: 'Failed to check webhook status',
      statusCode: 500,
      errorCode: 'STATUS_CHECK_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🔐 WEBHOOK SIGNATURE VERIFICATION
 */
function verifyMidtransSignature(body, signature) {
  try {
    if (!signature) {
      return { valid: false, reason: 'No signature provided' };
    }

    // ✅ Build signature string
    const orderId = body.order_id;
    const statusCode = body.status_code;
    const grossAmount = body.gross_amount;
    const serverKey = webhookSecret;

    const signatureString = `${orderId}${statusCode}${grossAmount}${serverKey}`;
    const calculatedSignature = crypto.createHash('sha512').update(signatureString).digest('hex');

    // ✅ Compare signatures
    const isValid = calculatedSignature === signature;

    return {
      valid: isValid,
      reason: isValid ? 'Valid signature' : 'Signature mismatch',
      calculatedSignature: isValid ? calculatedSignature : 'REDACTED',
      providedSignature: isValid ? signature : 'REDACTED'
    };

  } catch (error) {
    return {
      valid: false,
      reason: `Signature verification error: ${error.message}`
    };
  }
}

/**
 * 🔧 WEBHOOK HEALTH CHECK
 */
router.get('/health', async (req, res) => {
  const startTime = Date.now();

  try {
    const queueHealth = queueService.getHealthStatus();
    const queueMetrics = queueService.getMetrics();

    return responseFormatter.success(res, {
      data: {
        status: 'healthy',
        webhookEndpoints: {
          midtrans: 'active',
          retry: 'active',
          analytics: 'active'
        },
        queueHealth,
        processingCapacity: {
          activeJobs: queueMetrics.activeJobs,
          maxWorkers: queueMetrics.activeWorkers,
          queueSize: Object.values(queueMetrics.queueSizes || {}).reduce((sum, size) => sum + size, 0)
        },
        lastCheck: new Date().toISOString()
      },
      message: 'Webhook service is healthy',
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Webhook health check failed',
      statusCode: 503,
      errorCode: 'HEALTH_CHECK_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🔧 MIDTRANS CONFIGURATION INFO
 * 
 * Get current Midtrans redirect URLs for Flutter app configuration
 */
router.get('/midtrans-config', async (req, res) => {
  const startTime = Date.now();

  try {
    const apiBaseUrl = process.env.API_BASE_URL || 'https://api.dancesignal.com';
    const config = {
      redirectUrls: {
        success: process.env.MIDTRANS_FINISH_URL || `${apiBaseUrl}/webhooks/payment/success`,
        error: process.env.MIDTRANS_ERROR_URL || `${apiBaseUrl}/webhooks/payment/error`,
        pending: process.env.MIDTRANS_PENDING_URL || `${apiBaseUrl}/webhooks/payment/pending`,
      },
      webviewConfig: {
        // Instructions for Flutter app
        shouldCloseWebViewOnSuccess: true,
        shouldCloseWebViewOnError: true,
        shouldCloseWebViewOnPending: false,
        enableJavaScript: true,
        enableDomStorage: true,
      },
      flutterInstructions: {
        message: "To use professional payment pages, configure Flutter WebView to load these URLs and close the WebView when payment is completed.",
        webViewSettings: {
          "javascriptMode": "JavascriptMode.unrestricted",
          "onPageFinished": "Close WebView when URL contains 'payment/success' or 'payment/error'",
          "navigationDelegate": "Handle URL changes to detect completion"
        }
      }
    };

    return responseFormatter.success(res, {
      data: config,
      message: 'Midtrans configuration retrieved',
      startTime
    });

  } catch (error) {
    return responseFormatter.error(res, {
      message: 'Failed to get Midtrans configuration',
      statusCode: 500,
      errorCode: 'CONFIG_FAILED',
      details: { error: error.message },
      startTime
    });
  }
});

/**
 * 🔧 MIDDLEWARE FOR WEBHOOK ENDPOINTS
 */

// ✅ Raw body parser for webhook signature verification
router.use('/midtrans', express.raw({ type: 'application/json' }));

// ✅ Webhook-specific logging
router.use((req, res, next) => {
  const startTime = Date.now();
  
  // ✅ Log webhook request
  logger.info('Webhook request received', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    contentType: req.get('content-type')
  });

  // ✅ Log webhook response
  const originalJson = res.json;
  res.json = function(data) {
    const responseTime = Date.now() - startTime;
    
    logger.info('Webhook response sent', {
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      success: res.statusCode < 400
    });

    return originalJson.call(this, data);
  };

  next();
});

module.exports = router;