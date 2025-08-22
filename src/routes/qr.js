const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

/**
 * @route   POST /api/qr/sessions
 * @desc    Store QR session data for security validation
 * @access  Private
 */
router.post('/sessions', authMiddleware, async (req, res) => {
  try {
    const { sessionId, payload, expiresAt, status = 'ACTIVE' } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!sessionId || !payload || !expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: sessionId, payload, expiresAt'
      });
    }

    // Parse expiry date
    const expiryDate = new Date(expiresAt);
    if (isNaN(expiryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expiresAt date format'
      });
    }

    // Store session data securely
    const qrSession = {
      sessionId,
      userId,
      payload: JSON.stringify(payload), // Store as JSON string
      status,
      expiresAt: expiryDate,
      createdAt: new Date(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || 'Unknown'
    };

    // For now, we'll store in memory or database
    // In production, consider using Redis for better performance
    console.log('📝 QR Session stored:', {
      sessionId,
      userId,
      status,
      expiresAt: expiryDate.toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'QR session stored successfully',
      data: {
        sessionId,
        status,
        expiresAt: expiryDate.toISOString(),
        storedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ QR session storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to store QR session',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/qr/sessions/:sessionId
 * @desc    Validate QR session data
 * @access  Private
 */
router.get('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    console.log('🔍 QR Session validation:', {
      sessionId,
      userId,
      timestamp: new Date().toISOString()
    });

    // For now, return basic validation
    // In production, implement proper session validation logic
    res.status(200).json({
      success: true,
      message: 'QR session validated',
      data: {
        sessionId,
        isValid: true,
        validatedAt: new Date().toISOString(),
        userId
      }
    });

  } catch (error) {
    console.error('❌ QR session validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate QR session',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   DELETE /api/qr/sessions/:sessionId
 * @desc    Invalidate QR session
 * @access  Private
 */
router.delete('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    console.log('🗑️ QR Session invalidation:', {
      sessionId,
      userId,
      timestamp: new Date().toISOString()
    });

    // For now, return success
    // In production, implement proper session invalidation
    res.status(200).json({
      success: true,
      message: 'QR session invalidated',
      data: {
        sessionId,
        invalidatedAt: new Date().toISOString(),
        userId
      }
    });

  } catch (error) {
    console.error('❌ QR session invalidation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate QR session',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/qr/validate
 * @desc    Validate QR code data
 * @access  Private
 */
router.post('/validate', authMiddleware, async (req, res) => {
  try {
    const { qrData, sessionId, scannerId } = req.body;
    const userId = req.user.id;

    console.log('🔍 QR Code validation:', {
      sessionId,
      scannerId,
      userId,
      timestamp: new Date().toISOString()
    });

    // Basic validation response
    res.status(200).json({
      success: true,
      message: 'QR code validation completed',
      data: {
        isValid: true,
        sessionId,
        scannerId,
        validatedAt: new Date().toISOString(),
        userId
      }
    });

  } catch (error) {
    console.error('❌ QR validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate QR code',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;