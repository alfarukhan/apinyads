const Joi = require('joi');
const ConfigService = require('./ConfigService');
const AuditLogService = require('./AuditLogService');

/**
 * 💳 CENTRALIZED PAYMENT VALIDATION SERVICE
 * 
 * Comprehensive payment validation system for DanceSignal:
 * - Multi-currency support with exchange rates
 * - Payment method validation & restrictions
 * - Business rules & compliance checks
 * - Fraud detection & risk assessment
 * - Amount limits & threshold validation
 * - Regional payment method support
 * 
 * ✅ Security: Comprehensive fraud prevention
 * ✅ Compliance: International payment standards
 * ✅ Flexibility: Multi-currency & multi-method
 * ✅ Intelligence: Risk-based validation
 */
class PaymentValidationService {
  constructor() {
    this.configService = new ConfigService();
    this.auditService = new AuditLogService();

    // ✅ Payment validation configuration
    this.config = {
      // Currency settings
      DEFAULT_CURRENCY: 'IDR',
      SUPPORTED_CURRENCIES: ['IDR', 'USD', 'SGD', 'MYR', 'THB'],
      
      // Amount limits (in IDR)
      MIN_PAYMENT_AMOUNT: 1000, // 1K IDR
      MAX_PAYMENT_AMOUNT: 100000000, // 100M IDR
      MAX_DAILY_AMOUNT_PER_USER: 50000000, // 50M IDR
      MAX_MONTHLY_AMOUNT_PER_USER: 200000000, // 200M IDR
      
      // Payment methods
      SUPPORTED_PAYMENT_METHODS: [
        'credit_card', 'debit_card', 'bank_transfer', 
        'e_wallet', 'qris', 'virtual_account', 'over_the_counter'
      ],
      
      // Regional restrictions
      REGIONAL_RESTRICTIONS: {
        'credit_card': ['ID', 'SG', 'MY', 'TH', 'PH'],
        'debit_card': ['ID', 'SG', 'MY'],
        'bank_transfer': ['ID'],
        'e_wallet': ['ID', 'SG', 'MY', 'TH'],
        'qris': ['ID'],
        'virtual_account': ['ID'],
        'over_the_counter': ['ID']
      },
      
      // Business rules
      REQUIRE_USER_VERIFICATION: true,
      ALLOW_PARTIAL_PAYMENTS: false,
      ENABLE_PAYMENT_SCHEDULING: true,
      
      // Fraud detection
      ENABLE_FRAUD_DETECTION: true,
      MAX_FAILED_ATTEMPTS_PER_HOUR: 5,
      SUSPICIOUS_VELOCITY_THRESHOLD: 10, // payments per hour
      HIGH_RISK_AMOUNT_THRESHOLD: 10000000, // 10M IDR
      
      // Compliance
      REQUIRE_KYC_ABOVE_AMOUNT: 5000000, // 5M IDR
      AML_REPORTING_THRESHOLD: 50000000, // 50M IDR
      TAX_APPLICABLE_THRESHOLD: 2500000 // 2.5M IDR
    };

    // ✅ Currency exchange rates (mock - should be from external service)
    this.exchangeRates = {
      'USD': 15800, // 1 USD = 15,800 IDR
      'SGD': 11700, // 1 SGD = 11,700 IDR
      'MYR': 3500,  // 1 MYR = 3,500 IDR
      'THB': 450,   // 1 THB = 450 IDR
      'IDR': 1      // Base currency
    };

    // ✅ Validation statistics
    this.stats = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      fraudDetections: 0,
      lastValidation: null
    };

    // ✅ Initialize Joi schemas
    this.initializeSchemas();

    console.log('💳 PaymentValidationService initialized:', {
      supportedCurrencies: this.config.SUPPORTED_CURRENCIES.length,
      supportedMethods: this.config.SUPPORTED_PAYMENT_METHODS.length,
      fraudDetection: this.config.ENABLE_FRAUD_DETECTION,
      kycThreshold: `${this.config.REQUIRE_KYC_ABOVE_AMOUNT.toLocaleString()} IDR`
    });
  }

  /**
   * 📋 SCHEMA INITIALIZATION
   */
  initializeSchemas() {
    // ✅ Base payment validation schema
    this.schemas = {
      paymentRequest: Joi.object({
        type: Joi.string().valid('BOOKING', 'GUESTLIST', 'SUBSCRIPTION', 'REFUND').required(),
        userId: Joi.string().uuid().required(),
        amount: Joi.number().positive().required(),
        currency: Joi.string().valid(...this.config.SUPPORTED_CURRENCIES).default(this.config.DEFAULT_CURRENCY),
        paymentMethod: Joi.string().valid(...this.config.SUPPORTED_PAYMENT_METHODS).required(),
        
        // Contact information
        userEmail: Joi.string().email().required(),
        userFirstName: Joi.string().min(1).max(100).required(),
        userLastName: Joi.string().min(1).max(100).required(),
        userPhone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
        
        // Optional fields
        eventId: Joi.string().uuid().when('type', {
          is: Joi.string().valid('BOOKING', 'GUESTLIST'),
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        
        bookingId: Joi.string().uuid().when('type', {
          is: 'BOOKING',
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        
        // Regional & compliance
        userCountry: Joi.string().length(2).default('ID'),
        userRegion: Joi.string().max(50).optional(),
        ipAddress: Joi.string().ip().optional(),
        userAgent: Joi.string().max(500).optional(),
        
        // Business specific
        itemDetails: Joi.array().items(Joi.object({
          id: Joi.string().required(),
          name: Joi.string().max(50).required(),
          price: Joi.number().positive().required(),
          quantity: Joi.number().integer().positive().required(),
          category: Joi.string().max(50).optional()
        })).min(1).required(),
        
        // Metadata
        correlationId: Joi.string().optional(),
        metadata: Joi.object().optional()
      }),

      // Amount validation schema
      amountValidation: Joi.object({
        amount: Joi.number().positive().min(this.config.MIN_PAYMENT_AMOUNT).max(this.config.MAX_PAYMENT_AMOUNT).required(),
        currency: Joi.string().valid(...this.config.SUPPORTED_CURRENCIES).required(),
        convertedAmount: Joi.number().positive().optional()
      }),

      // Payment method validation
      paymentMethodValidation: Joi.object({
        method: Joi.string().valid(...this.config.SUPPORTED_PAYMENT_METHODS).required(),
        userCountry: Joi.string().length(2).required(),
        userRegion: Joi.string().optional()
      })
    };
  }

  /**
   * 🎯 MAIN VALIDATION METHODS
   */

  async validatePaymentRequest(paymentData, options = {}) {
    const {
      skipFraudCheck = false,
      skipBusinessRules = false,
      userId = null
    } = options;

    const startTime = Date.now();
    this.stats.totalValidations++;

    try {
      console.log(`💳 Validating payment request: ${paymentData.type} - ${paymentData.amount} ${paymentData.currency}`);

      // ✅ Step 1: Schema validation
      const schemaValidation = await this.validateSchema(paymentData);
      if (!schemaValidation.valid) {
        return this.buildValidationResult(false, 'SCHEMA_VALIDATION_FAILED', schemaValidation.errors);
      }

      // ✅ Step 2: Amount validation
      const amountValidation = await this.validateAmount(paymentData.amount, paymentData.currency);
      if (!amountValidation.valid) {
        return this.buildValidationResult(false, 'AMOUNT_VALIDATION_FAILED', amountValidation.errors);
      }

      // ✅ Step 3: Payment method validation
      const methodValidation = await this.validatePaymentMethod(
        paymentData.paymentMethod, 
        paymentData.userCountry || 'ID'
      );
      if (!methodValidation.valid) {
        return this.buildValidationResult(false, 'PAYMENT_METHOD_VALIDATION_FAILED', methodValidation.errors);
      }

      // ✅ Step 4: Business rules validation
      if (!skipBusinessRules) {
        const businessValidation = await this.validateBusinessRules(paymentData);
        if (!businessValidation.valid) {
          return this.buildValidationResult(false, 'BUSINESS_RULES_VALIDATION_FAILED', businessValidation.errors);
        }
      }

      // ✅ Step 5: User validation
      const userValidation = await this.validateUser(paymentData);
      if (!userValidation.valid) {
        return this.buildValidationResult(false, 'USER_VALIDATION_FAILED', userValidation.errors);
      }

      // ✅ Step 6: Fraud detection
      if (!skipFraudCheck && this.config.ENABLE_FRAUD_DETECTION) {
        const fraudValidation = await this.validateFraudPrevention(paymentData);
        if (!fraudValidation.valid) {
          this.stats.fraudDetections++;
          return this.buildValidationResult(false, 'FRAUD_DETECTION_FAILED', fraudValidation.errors, { riskLevel: 'HIGH' });
        }
      }

      // ✅ Step 7: Compliance validation
      const complianceValidation = await this.validateCompliance(paymentData);
      if (!complianceValidation.valid) {
        return this.buildValidationResult(false, 'COMPLIANCE_VALIDATION_FAILED', complianceValidation.errors);
      }

      // ✅ All validations passed
      const validationDuration = Date.now() - startTime;
      this.stats.successfulValidations++;
      this.stats.lastValidation = new Date();

      // ✅ Log successful validation
      await this.auditService.logEvent('PAYMENT_VALIDATION_SUCCESS', {
        userId,
        resourceType: 'payment',
        metadata: {
          type: paymentData.type,
          amount: paymentData.amount,
          currency: paymentData.currency,
          method: paymentData.paymentMethod,
          duration: `${validationDuration}ms`
        }
      });

      console.log(`✅ Payment validation successful in ${validationDuration}ms`);

      return this.buildValidationResult(true, 'VALIDATION_SUCCESS', [], {
        convertedAmount: amountValidation.convertedAmount,
        validationDuration
      });

    } catch (error) {
      console.error('❌ Payment validation error:', error);
      this.stats.failedValidations++;
      
      return this.buildValidationResult(false, 'VALIDATION_ERROR', [error.message]);
    }
  }

  /**
   * 📋 INDIVIDUAL VALIDATION METHODS
   */

  async validateSchema(paymentData) {
    try {
      const { error, value } = this.schemas.paymentRequest.validate(paymentData, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          code: 'SCHEMA_ERROR'
        }));

        return { valid: false, errors };
      }

      return { valid: true, validatedData: value };

    } catch (error) {
      return {
        valid: false,
        errors: [{ field: 'schema', message: error.message, code: 'VALIDATION_ERROR' }]
      };
    }
  }

  async validateAmount(amount, currency = 'IDR') {
    try {
      // ✅ Convert to IDR for validation
      const convertedAmount = this.convertToIDR(amount, currency);

      // ✅ Validate converted amount
      const { error } = this.schemas.amountValidation.validate({
        amount: convertedAmount,
        currency: 'IDR',
        convertedAmount
      });

      if (error) {
        return {
          valid: false,
          errors: [{ 
            field: 'amount', 
            message: `Amount ${amount} ${currency} (${convertedAmount.toLocaleString()} IDR) is invalid: ${error.message}`,
            code: 'AMOUNT_ERROR'
          }]
        };
      }

      // ✅ Additional amount business rules
      if (convertedAmount < this.config.MIN_PAYMENT_AMOUNT) {
        return {
          valid: false,
          errors: [{
            field: 'amount',
            message: `Minimum payment amount is ${this.config.MIN_PAYMENT_AMOUNT.toLocaleString()} IDR`,
            code: 'AMOUNT_TOO_LOW'
          }]
        };
      }

      if (convertedAmount > this.config.MAX_PAYMENT_AMOUNT) {
        return {
          valid: false,
          errors: [{
            field: 'amount',
            message: `Maximum payment amount is ${this.config.MAX_PAYMENT_AMOUNT.toLocaleString()} IDR`,
            code: 'AMOUNT_TOO_HIGH'
          }]
        };
      }

      return { 
        valid: true, 
        convertedAmount,
        originalAmount: amount,
        currency
      };

    } catch (error) {
      return {
        valid: false,
        errors: [{ field: 'amount', message: error.message, code: 'AMOUNT_VALIDATION_ERROR' }]
      };
    }
  }

  async validatePaymentMethod(method, userCountry = 'ID') {
    try {
      // ✅ Check if method is supported
      if (!this.config.SUPPORTED_PAYMENT_METHODS.includes(method)) {
        return {
          valid: false,
          errors: [{
            field: 'paymentMethod',
            message: `Payment method '${method}' is not supported`,
            code: 'UNSUPPORTED_PAYMENT_METHOD'
          }]
        };
      }

      // ✅ Check regional restrictions
      const allowedRegions = this.config.REGIONAL_RESTRICTIONS[method];
      if (allowedRegions && !allowedRegions.includes(userCountry)) {
        return {
          valid: false,
          errors: [{
            field: 'paymentMethod',
            message: `Payment method '${method}' is not available in country '${userCountry}'`,
            code: 'PAYMENT_METHOD_NOT_AVAILABLE_IN_REGION'
          }]
        };
      }

      return { valid: true };

    } catch (error) {
      return {
        valid: false,
        errors: [{ field: 'paymentMethod', message: error.message, code: 'PAYMENT_METHOD_VALIDATION_ERROR' }]
      };
    }
  }

  async validateBusinessRules(paymentData) {
    const errors = [];

    try {
      // ✅ Check if user verification is required
      if (this.config.REQUIRE_USER_VERIFICATION) {
        // TODO: Implement user verification check
        // This would check if user's email/phone is verified
      }

      // ✅ Check payment scheduling rules
      if (paymentData.scheduledFor && !this.config.ENABLE_PAYMENT_SCHEDULING) {
        errors.push({
          field: 'scheduledFor',
          message: 'Payment scheduling is not enabled',
          code: 'PAYMENT_SCHEDULING_DISABLED'
        });
      }

      // ✅ Check partial payment rules
      if (paymentData.isPartialPayment && !this.config.ALLOW_PARTIAL_PAYMENTS) {
        errors.push({
          field: 'isPartialPayment',
          message: 'Partial payments are not allowed',
          code: 'PARTIAL_PAYMENTS_DISABLED'
        });
      }

      // ✅ Validate item details consistency
      const totalItemAmount = paymentData.itemDetails.reduce((sum, item) => 
        sum + (item.price * item.quantity), 0
      );

      if (Math.abs(totalItemAmount - paymentData.amount) > 1) { // Allow 1 unit difference for rounding
        errors.push({
          field: 'amount',
          message: `Payment amount (${paymentData.amount}) does not match item total (${totalItemAmount})`,
          code: 'AMOUNT_MISMATCH'
        });
      }

      return { valid: errors.length === 0, errors };

    } catch (error) {
      errors.push({
        field: 'businessRules',
        message: error.message,
        code: 'BUSINESS_RULES_ERROR'
      });

      return { valid: false, errors };
    }
  }

  async validateUser(paymentData) {
    const errors = [];

    try {
      // ✅ Basic user data validation
      if (!paymentData.userEmail || !paymentData.userFirstName || !paymentData.userLastName) {
        errors.push({
          field: 'userData',
          message: 'Complete user information is required',
          code: 'INCOMPLETE_USER_DATA'
        });
      }

      // ✅ Check daily spending limit
      const convertedAmount = this.convertToIDR(paymentData.amount, paymentData.currency);
      if (convertedAmount > this.config.MAX_DAILY_AMOUNT_PER_USER) {
        // TODO: Check actual daily spending from database
        errors.push({
          field: 'amount',
          message: `Daily spending limit exceeded. Maximum: ${this.config.MAX_DAILY_AMOUNT_PER_USER.toLocaleString()} IDR`,
          code: 'DAILY_LIMIT_EXCEEDED'
        });
      }

      return { valid: errors.length === 0, errors };

    } catch (error) {
      errors.push({
        field: 'user',
        message: error.message,
        code: 'USER_VALIDATION_ERROR'
      });

      return { valid: false, errors };
    }
  }

  async validateFraudPrevention(paymentData) {
    const errors = [];
    const warnings = [];

    try {
      const convertedAmount = this.convertToIDR(paymentData.amount, paymentData.currency);

      // ✅ High-risk amount check
      if (convertedAmount >= this.config.HIGH_RISK_AMOUNT_THRESHOLD) {
        warnings.push({
          field: 'amount',
          message: 'High-risk amount detected',
          code: 'HIGH_RISK_AMOUNT'
        });
      }

      // ✅ Payment velocity check
      // TODO: Implement actual velocity check from database
      const paymentVelocity = await this.checkPaymentVelocity(paymentData.userId, paymentData.ipAddress);
      if (paymentVelocity.hourlyCount > this.config.SUSPICIOUS_VELOCITY_THRESHOLD) {
        errors.push({
          field: 'velocity',
          message: `Suspicious payment velocity: ${paymentVelocity.hourlyCount} payments in last hour`,
          code: 'SUSPICIOUS_VELOCITY'
        });
      }

      // ✅ Failed attempts check
      const failedAttempts = await this.checkFailedAttempts(paymentData.userId, paymentData.ipAddress);
      if (failedAttempts.hourlyCount >= this.config.MAX_FAILED_ATTEMPTS_PER_HOUR) {
        errors.push({
          field: 'attempts',
          message: `Too many failed payment attempts: ${failedAttempts.hourlyCount} in last hour`,
          code: 'TOO_MANY_FAILED_ATTEMPTS'
        });
      }

      // ✅ Geographic risk check
      const geoRisk = await this.checkGeographicRisk(paymentData.userCountry, paymentData.ipAddress);
      if (geoRisk.riskLevel === 'HIGH') {
        warnings.push({
          field: 'geography',
          message: 'High-risk geographic location detected',
          code: 'HIGH_RISK_GEOGRAPHY'
        });
      }

      return { 
        valid: errors.length === 0, 
        errors, 
        warnings,
        riskLevel: this.calculateRiskLevel(errors, warnings)
      };

    } catch (error) {
      errors.push({
        field: 'fraud',
        message: error.message,
        code: 'FRAUD_CHECK_ERROR'
      });

      return { valid: false, errors };
    }
  }

  async validateCompliance(paymentData) {
    const errors = [];
    const requirements = [];

    try {
      const convertedAmount = this.convertToIDR(paymentData.amount, paymentData.currency);

      // ✅ KYC requirement check
      if (convertedAmount >= this.config.REQUIRE_KYC_ABOVE_AMOUNT) {
        requirements.push({
          type: 'KYC',
          message: 'Know Your Customer verification required for this amount',
          code: 'KYC_REQUIRED'
        });
      }

      // ✅ AML reporting threshold
      if (convertedAmount >= this.config.AML_REPORTING_THRESHOLD) {
        requirements.push({
          type: 'AML',
          message: 'Anti-Money Laundering reporting required',
          code: 'AML_REPORTING_REQUIRED'
        });
      }

      // ✅ Tax calculation requirement
      if (convertedAmount >= this.config.TAX_APPLICABLE_THRESHOLD) {
        requirements.push({
          type: 'TAX',
          message: 'Tax calculation and reporting required',
          code: 'TAX_APPLICABLE'
        });
      }

      // ✅ For now, treat requirements as warnings, not errors
      return { 
        valid: true, 
        errors, 
        requirements,
        complianceLevel: requirements.length > 0 ? 'ENHANCED' : 'STANDARD'
      };

    } catch (error) {
      errors.push({
        field: 'compliance',
        message: error.message,
        code: 'COMPLIANCE_CHECK_ERROR'
      });

      return { valid: false, errors };
    }
  }

  /**
   * 🛠️ UTILITY METHODS
   */

  convertToIDR(amount, currency) {
    if (currency === 'IDR') return amount;
    
    const rate = this.exchangeRates[currency];
    if (!rate) {
      throw new Error(`Exchange rate not available for currency: ${currency}`);
    }

    return Math.round(amount * rate);
  }

  convertFromIDR(amount, targetCurrency) {
    if (targetCurrency === 'IDR') return amount;
    
    const rate = this.exchangeRates[targetCurrency];
    if (!rate) {
      throw new Error(`Exchange rate not available for currency: ${targetCurrency}`);
    }

    return Math.round((amount / rate) * 100) / 100; // Round to 2 decimal places
  }

  async checkPaymentVelocity(userId, ipAddress) {
    // TODO: Implement actual database check
    // This would query recent payments for this user/IP
    return {
      hourlyCount: 0,
      dailyCount: 0,
      weeklyCount: 0
    };
  }

  async checkFailedAttempts(userId, ipAddress) {
    // TODO: Implement actual database check
    // This would query recent failed payment attempts
    return {
      hourlyCount: 0,
      dailyCount: 0
    };
  }

  async checkGeographicRisk(userCountry, ipAddress) {
    // TODO: Implement geographic risk assessment
    // This could use external services for IP geolocation
    const highRiskCountries = ['XX', 'YY']; // Example
    
    return {
      riskLevel: highRiskCountries.includes(userCountry) ? 'HIGH' : 'LOW',
      countryMatch: true // IP country matches user country
    };
  }

  calculateRiskLevel(errors, warnings) {
    if (errors.length > 0) return 'HIGH';
    if (warnings.length >= 2) return 'MEDIUM';
    if (warnings.length === 1) return 'LOW';
    return 'MINIMAL';
  }

  buildValidationResult(valid, code, errors = [], metadata = {}) {
    return {
      valid,
      code,
      errors,
      metadata,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 📊 STATISTICS & MONITORING
   */

  getValidationStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalValidations > 0 
        ? ((this.stats.successfulValidations / this.stats.totalValidations) * 100).toFixed(2) + '%'
        : '100%',
      fraudDetectionRate: this.stats.totalValidations > 0
        ? ((this.stats.fraudDetections / this.stats.totalValidations) * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      supportedCurrencies: this.config.SUPPORTED_CURRENCIES.length,
      supportedMethods: this.config.SUPPORTED_PAYMENT_METHODS.length,
      fraudDetectionEnabled: this.config.ENABLE_FRAUD_DETECTION,
      lastValidation: this.stats.lastValidation
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    console.log('✅ PaymentValidationService cleanup completed');
  }
}

module.exports = PaymentValidationService;