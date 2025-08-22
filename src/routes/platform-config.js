const express = require('express');
const Joi = require('joi');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/auth');
const PlatformConfigService = require('../services/platform-config-service');

const router = express.Router();
const platformConfig = PlatformConfigService.getInstance();

// Validation schemas
// ✅ REMOVED: Using inline validation for simple schemas

// @route   GET /api/platform-config
// @desc    Get all platform configurations
// @access  Private (Admin only)
router.get('/', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  // ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized validation schemas
const validationSchemas = require('../lib/validation-schemas');


  const configs = await prisma.platformConfig.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    success: true,
    message: 'Platform configurations retrieved successfully',
    data: configs
  });
}));

// @route   GET /api/platform-config/fee-info
// @desc    Get current platform fee information (public)
// @access  Public
router.get('/fee-info', asyncHandler(async (req, res) => {
  const [feeAmount, feeEnabled, feeCurrency] = await Promise.all([
    platformConfig.getPlatformFeeAmount(),
    platformConfig.isPlatformFeeEnabled(),
    platformConfig.getPlatformFeeCurrency()
  ]);

  res.json({
    success: true,
    message: 'Platform fee information retrieved',
    data: {
      platformFee: {
        amount: feeAmount, // in cents
        amountFormatted: `Rp ${(feeAmount / 100).toLocaleString('id-ID')}`,
        enabled: feeEnabled,
        currency: feeCurrency
      }
    }
  });
}));

// @route   PUT /api/platform-config/:key
// @desc    Update platform configuration
// @access  Private (Admin only)
router.put('/:key', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { key } = req.params;
  // ✅ ENTERPRISE: Inline validation for simple schemas
  const { error, value } = Joi.object({
    value: Joi.string().required(),
    description: Joi.string().optional(),
  }).validate(req.body);
  
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { value: configValue, description, dataType } = value;

  // Validate specific configuration keys
  if (key === 'PLATFORM_FEE_AMOUNT') {
    const numValue = parseFloat(configValue);
    if (isNaN(numValue) || numValue < 0) {
      throw new AppError('Platform fee amount must be a non-negative number', 400);
    }
  }

  if (key === 'PLATFORM_FEE_ENABLED') {
    if (!['true', 'false'].includes(configValue.toLowerCase())) {
      throw new AppError('Platform fee enabled must be true or false', 400);
    }
  }

  const updatedConfig = await platformConfig.setConfig(
    key,
    configValue,
    description,
    dataType,
    req.user.id
  );

  // Clear cache after update
  platformConfig.clearCache();

  res.json({
    success: true,
    message: `Configuration ${key} updated successfully`,
    data: updatedConfig
  });
}));

// @route   POST /api/platform-config/calculate-booking
// @desc    Calculate booking amount with current fees (for testing)
// @access  Private (Admin only)
router.post('/calculate-booking', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  const { unitPrice, quantity, eventTaxRate = 0, eventTaxType = 'PERCENTAGE', eventTaxName = 'Tax' } = req.body;

  if (!unitPrice || !quantity) {
    throw new AppError('unitPrice and quantity are required', 400);
  }

  // Mock event object for testing
  const mockEvent = {
    taxRate: eventTaxRate,
    taxType: eventTaxType,
    taxName: eventTaxName
  };

  const calculation = await platformConfig.calculateBookingAmount(
    unitPrice,
    quantity,
    mockEvent
  );

  res.json({
    success: true,
    message: 'Booking amount calculated successfully',
    data: {
      input: {
        unitPrice,
        quantity,
        event: mockEvent
      },
      calculation
    }
  });
}));

// @route   DELETE /api/platform-config/cache
// @desc    Clear platform configuration cache
// @access  Private (Admin only)
router.delete('/cache', authMiddleware, requireRole('ADMIN'), asyncHandler(async (req, res) => {
  platformConfig.clearCache();

  res.json({
    success: true,
    message: 'Platform configuration cache cleared successfully'
  });
}));

module.exports = router;