const express = require('express');
const { getPaymentService } = require('../services/core');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * 🧪 PAYMENT SERVICE TEST ENDPOINT
 * 
 * Testing endpoint for the new centralized PaymentService
 * Use this to verify all payment operations work correctly
 * 
 * ⚠️ REMOVE THIS IN PRODUCTION
 */

// @route   POST /api/payment-test/create
// @desc    Test payment creation with centralized service
// @access  Private
router.post('/create', authMiddleware, asyncHandler(async (req, res) => {
  const paymentService = getPaymentService();
  
  const testPaymentRequest = {
    type: req.body.type || 'GUESTLIST',
    userId: req.user.id,
    eventId: req.body.eventId || 'test-event-id',
    amount: req.body.amount || 25000,
    currency: 'IDR',
    paymentMethod: req.body.paymentMethod || 'QRIS',
    
    // User details from auth middleware
    userEmail: req.user.email,
    userFirstName: req.user.firstName,
    userLastName: req.user.lastName,
    userPhone: req.user.phone,
    username: req.user.username,
    
    // Item details
    itemName: `Test ${req.body.type || 'Guestlist'} Payment`,
    category: 'Test'
  };

  console.log('🧪 Testing payment creation with centralized service:', testPaymentRequest);

  try {
    const result = await paymentService.createPayment(testPaymentRequest);
    
    res.json({
      success: true,
      message: 'Centralized payment service test successful',
      data: result.data,
      testInfo: {
        serviceUsed: 'CentralizedPaymentService',
        timestamp: new Date().toISOString(),
        requestData: testPaymentRequest
      }
    });

  } catch (error) {
    console.error('🧪 Payment service test failed:', error);
    
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Centralized payment service test failed',
      error: {
        message: error.message,
        details: error.details || {},
        testInfo: {
          serviceUsed: 'CentralizedPaymentService',
          timestamp: new Date().toISOString(),
          requestData: testPaymentRequest
        }
      }
    });
  }
}));

// @route   GET /api/payment-test/status/:orderId
// @desc    Test payment status check with centralized service
// @access  Private
router.get('/status/:orderId', authMiddleware, asyncHandler(async (req, res) => {
  const paymentService = getPaymentService();
  const { orderId } = req.params;

  console.log('🧪 Testing payment status check with centralized service:', orderId);

  try {
    const result = await paymentService.checkPaymentStatus(orderId, req.user.id);
    
    res.json({
      success: true,
      message: 'Centralized payment status check successful',
      data: result.data,
      testInfo: {
        serviceUsed: 'CentralizedPaymentService',
        timestamp: new Date().toISOString(),
        orderId
      }
    });

  } catch (error) {
    console.error('🧪 Payment status check test failed:', error);
    
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Centralized payment status check failed',
      error: {
        message: error.message,
        details: error.details || {},
        testInfo: {
          serviceUsed: 'CentralizedPaymentService',
          timestamp: new Date().toISOString(),
          orderId
        }
      }
    });
  }
}));

// @route   POST /api/payment-test/verify/:orderId
// @desc    Test payment verification with centralized service
// @access  Private  
router.post('/verify/:orderId', authMiddleware, asyncHandler(async (req, res) => {
  const paymentService = getPaymentService();
  const { orderId } = req.params;

  console.log('🧪 Testing payment verification with centralized service:', orderId);

  try {
    const result = await paymentService.verifyPayment(orderId, req.user.id);
    
    res.json({
      success: true,
      message: 'Centralized payment verification successful',
      data: result.data,
      testInfo: {
        serviceUsed: 'CentralizedPaymentService',
        timestamp: new Date().toISOString(),
        orderId
      }
    });

  } catch (error) {
    console.error('🧪 Payment verification test failed:', error);
    
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Centralized payment verification failed',
      error: {
        message: error.message,
        details: error.details || {},
        testInfo: {
          serviceUsed: 'CentralizedPaymentService',
          timestamp: new Date().toISOString(),
          orderId
        }
      }
    });
  }
}));

// @route   GET /api/payment-test/health
// @desc    Test service health and configuration
// @access  Private (Admin only)
router.get('/health', authMiddleware, asyncHandler(async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required for health check'
    });
  }

  try {
    const paymentService = getPaymentService();
    
    // Test service initialization
    const healthCheck = {
      timestamp: new Date().toISOString(),
      service: 'CentralizedPaymentService',
      status: 'healthy',
      config: {
        environment: process.env.NODE_ENV,
        midtransEnvironment: process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'production' : 'sandbox',
        hasServerKey: !!process.env.MIDTRANS_SERVER_KEY,
        hasClientKey: !!process.env.MIDTRANS_CLIENT_KEY
      },
      capabilities: {
        paymentCreation: true,
        paymentStatusCheck: true,
        paymentVerification: true,
        orderIdGeneration: true,
        validation: true,
        errorHandling: true
      }
    };

    res.json({
      success: true,
      message: 'Centralized payment service is healthy',
      data: healthCheck
    });

  } catch (error) {
    console.error('🧪 Payment service health check failed:', error);
    
    res.status(500).json({
      success: false,
      message: 'Centralized payment service health check failed',
      error: {
        message: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
}));

module.exports = router;