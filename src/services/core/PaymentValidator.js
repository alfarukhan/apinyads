const Joi = require('joi');

/**
 * 🛡️ CENTRALIZED PAYMENT VALIDATOR
 * 
 * Unified validation for all payment operations:
 * - Input sanitization & validation
 * - Business rule enforcement
 * - Security checks
 * - Amount & currency validation
 */
class PaymentValidator {
  constructor() {
    // ✅ CENTRALIZED: Payment validation schemas
    this.schemas = {
      // Base payment request schema
      paymentRequest: Joi.object({
        type: Joi.string().valid('BOOKING', 'GUESTLIST', 'REFUND').required(),
        userId: Joi.string().required(),
        eventId: Joi.string().when('type', {
          is: Joi.valid('BOOKING', 'GUESTLIST'),
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        amount: Joi.number().integer().min(1000).max(50000000).required(),
        currency: Joi.string().valid('IDR').default('IDR'),
        paymentMethod: Joi.string().required(),
        
        // User details
        userEmail: Joi.string().email().required(),
        userFirstName: Joi.string().max(50).optional(),
        userLastName: Joi.string().max(50).optional(),
        userPhone: Joi.string().pattern(/^\+?[0-9\-\s\(\)]{10,15}$/).optional(),
        username: Joi.string().max(50).optional(),
        
        // Item details
        itemName: Joi.string().max(50).optional(),
        itemDetails: Joi.array().items(Joi.object({
          id: Joi.string().required(),
          price: Joi.number().integer().required(),
          quantity: Joi.number().integer().min(1).required(),
          name: Joi.string().max(50).required(),
          category: Joi.string().max(30).optional()
        })).optional(),
        category: Joi.string().max(30).optional(),
        
        // Business context
        accessTierIds: Joi.array().items(Joi.string()).when('type', {
          is: 'BOOKING',
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        quantities: Joi.object().when('type', {
          is: 'BOOKING', 
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      }),

      // Payment method validation
      paymentMethod: Joi.string().valid(
        // E-Wallet
        'GOPAY', 'QRIS', 'SHOPEEPAY', 'DANA',
        // Bank Transfer  
        'BCA', 'BNI', 'MANDIRI', 'BRI', 'PERMATA',
        // Convenience Store
        'ALFAMART', 'INDOMARET',
        // Credit Card (for future)
        'VISA', 'MASTERCARD'
      ).required(),

      // Amount validation
      amount: Joi.number().integer().min(1000).max(50000000).required(),

      // Order ID validation  
      orderId: Joi.string().pattern(/^(BK|GL|RF)[A-Z0-9]{10,20}$/).required(),

      // User context validation
      userContext: Joi.object({
        id: Joi.string().required(),
        email: Joi.string().email().required(),
        role: Joi.string().valid('USER', 'ADMIN', 'ORGANIZER').default('USER'),
        isActive: Joi.boolean().default(true)
      }).required()
    };

    // ✅ CENTRALIZED: Business validation rules
    this.businessRules = {
      // Platform fee ranges
      PLATFORM_FEE: {
        MIN: 1000,    // 1k rupiah
        MAX: 100000,  // 100k rupiah
        DEFAULT: 5000 // 5k rupiah
      },

      // Payment amount limits per type
      AMOUNT_LIMITS: {
        BOOKING: { MIN: 5000, MAX: 50000000 },    // ✅ FIX: 5k - 50M (support expensive VIP tickets)
        GUESTLIST: { MIN: 1000, MAX: 5000000 },    // 1k - 5M  
        REFUND: { MIN: 1000, MAX: 50000000 }      // 1k - 50M
      },

      // Rate limiting rules
      RATE_LIMITS: {
        PAYMENT_CREATION: { MAX: 5, WINDOW_MS: 5 * 60 * 1000 },      // 5 per 5min
        PAYMENT_VERIFICATION: { MAX: 10, WINDOW_MS: 5 * 60 * 1000 }, // 10 per 5min
        STATUS_CHECK: { MAX: 20, WINDOW_MS: 1 * 60 * 1000 }          // 20 per 1min
      }
    };
  }

  /**
   * 🛡️ VALIDATE PAYMENT REQUEST
   * 
   * Comprehensive validation for payment creation
   */
  async validatePaymentRequest(paymentRequest) {
    // ✅ STEP 1: Schema validation
    const { error, value } = this.schemas.paymentRequest.validate(paymentRequest, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      throw new ValidationError('Invalid payment request', {
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        })),
        code: 'VALIDATION_ERROR'
      });
    }

    // ✅ STEP 2: Business rule validation
    await this.validateBusinessRules(value);

    // ✅ STEP 3: Security validation
    await this.validateSecurity(value);

    return value;
  }

  /**
   * 🎯 VALIDATE BUSINESS RULES
   */
  async validateBusinessRules(paymentRequest) {
    const { type, amount, userId, eventId } = paymentRequest;

    // ✅ Amount limits per payment type
    const limits = this.businessRules.AMOUNT_LIMITS[type];
    if (amount < limits.MIN || amount > limits.MAX) {
      throw new ValidationError(`Payment amount must be between ${limits.MIN} and ${limits.MAX} for ${type}`, {
        code: 'AMOUNT_OUT_OF_RANGE',
        type,
        amount,
        limits
      });
    }

    // ✅ User eligibility checks
    await this.validateUserEligibility(userId, type);

    // ✅ Event-specific validation
    if (eventId) {
      await this.validateEventEligibility(eventId, userId, type);
    }

    // ✅ Payment method compatibility
    await this.validatePaymentMethodCompatibility(paymentRequest);
  }

  /**
   * 🔒 VALIDATE SECURITY
   */
  async validateSecurity(paymentRequest) {
    const { userId, amount, paymentMethod } = paymentRequest;

    // ✅ Detect suspicious patterns
    if (amount > 1000000) { // 1M rupiah
      console.log(`🚨 High-value payment detected: ${amount} by user ${userId}`);
    }

    // ✅ Payment method security
    if (paymentMethod === 'CREDIT_CARD' && amount > 5000000) {
      console.log(`🚨 High-value credit card payment: ${amount} by user ${userId}`);
    }

    // ✅ User behavior validation
    await this.validateUserBehavior(userId, amount);
  }

  /**
   * 👤 USER ELIGIBILITY VALIDATION
   */
  async validateUserEligibility(userId, paymentType) {
    // This would check user status, verification, etc.
    // For now, basic validation
    if (!userId || userId.length < 10) {
      throw new ValidationError('Invalid user ID', {
        code: 'INVALID_USER_ID',
        userId
      });
    }
  }

  /**
   * 🎫 EVENT ELIGIBILITY VALIDATION  
   */
  async validateEventEligibility(eventId, userId, paymentType) {
    // This would check event capacity, dates, user registration status, etc.
    // For now, basic validation
    if (!eventId || eventId.length < 10) {
      throw new ValidationError('Invalid event ID', {
        code: 'INVALID_EVENT_ID', 
        eventId
      });
    }
  }

  /**
   * 💳 PAYMENT METHOD COMPATIBILITY
   */
  async validatePaymentMethodCompatibility(paymentRequest) {
    const { paymentMethod, amount } = paymentRequest;

    // ✅ Amount limits per payment method
    const methodLimits = {
      'QRIS': { MIN: 1000, MAX: 2000000 },      // 2M limit for QRIS
      'GOPAY': { MIN: 1000, MAX: 2000000 },     // 2M limit for GoPay
      'DANA': { MIN: 1000, MAX: 2000000 },      // 2M limit for DANA
      'SHOPEEPAY': { MIN: 1000, MAX: 2000000 }, // 2M limit for ShopeePay
      'ALFAMART': { MIN: 10000, MAX: 2500000 }, // Convenience store limits
      'INDOMARET': { MIN: 10000, MAX: 2500000 }
    };

    const limits = methodLimits[paymentMethod];
    if (limits && (amount < limits.MIN || amount > limits.MAX)) {
      throw new ValidationError(`Amount ${amount} not supported for ${paymentMethod}`, {
        code: 'PAYMENT_METHOD_AMOUNT_INCOMPATIBLE',
        paymentMethod,
        amount,
        limits
      });
    }
  }

  /**
   * 🕵️ USER BEHAVIOR VALIDATION
   */
  async validateUserBehavior(userId, amount) {
    // This would implement fraud detection, velocity checks, etc.
    // For now, basic validation
    
    if (amount > 5000000) { // 5M rupiah
      console.log(`🔍 Flagging high-value transaction for review: ${amount} by ${userId}`);
    }
  }

  /**
   * 🎯 INDIVIDUAL FIELD VALIDATORS
   */
  validateAmount(amount) {
    const { error, value } = this.schemas.amount.validate(amount);
    if (error) {
      throw new ValidationError(`Invalid amount: ${error.message}`, {
        code: 'INVALID_AMOUNT',
        amount
      });
    }
    return value;
  }

  validatePaymentMethod(paymentMethod) {
    const { error, value } = this.schemas.paymentMethod.validate(paymentMethod);
    if (error) {
      throw new ValidationError(`Invalid payment method: ${error.message}`, {
        code: 'INVALID_PAYMENT_METHOD',
        paymentMethod
      });
    }
    return value;
  }

  validateOrderId(orderId) {
    const { error, value } = this.schemas.orderId.validate(orderId);
    if (error) {
      throw new ValidationError(`Invalid order ID format: ${error.message}`, {
        code: 'INVALID_ORDER_ID',
        orderId
      });
    }
    return value;
  }

  validateUserContext(userContext) {
    const { error, value } = this.schemas.userContext.validate(userContext);
    if (error) {
      throw new ValidationError(`Invalid user context: ${error.message}`, {
        code: 'INVALID_USER_CONTEXT',
        userContext
      });
    }
    return value;
  }
}

/**
 * 🚨 VALIDATION ERROR CLASS
 */
class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
    this.statusCode = 400;
    this.isOperational = true;
  }
}

module.exports = PaymentValidator;
module.exports.ValidationError = ValidationError;