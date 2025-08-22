const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const { successResponse } = require('../lib/response-formatters');
const { prisma } = require('../lib/prisma');

const router = express.Router();

// @route   POST /api/validation/age
// @desc    Secure server-side age validation
// @access  Public
router.post('/age', asyncHandler(async (req, res) => {
  const { dateOfBirth } = req.body;

  if (!dateOfBirth) {
    throw new AppError('Date of birth is required', 400);
  }

  // 🛡️ SECURE: Server calculates age
  const birthDate = new Date(dateOfBirth);
  const now = new Date();
  const age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  const dayDiff = now.getDate() - birthDate.getDate();

  const actualAge = (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) 
    ? age - 1 
    : age;

  // 🛡️ SECURE: Server enforces minimum age
  const isEligible = actualAge >= 18;

  console.log(`🔒 AGE VALIDATION: Birth: ${dateOfBirth}, Age: ${actualAge}, Eligible: ${isEligible}`);

  res.json(successResponse('Age validation completed', {
    age: actualAge,
    isEligible,
    minimumAge: 18,
    calculatedAt: new Date().toISOString()
  }));
}));

// @route   POST /api/validation/booking-eligibility
// @desc    Secure server-side booking eligibility check
// @access  Private
router.post('/booking-eligibility', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId, accessTierId, quantity } = req.body;
  const userId = req.user.id;

  if (!eventId || !quantity || quantity < 1) {
    throw new AppError('Invalid booking parameters', 400);
  }

  // 🛡️ SECURE: Server checks all business rules
  console.log(`🔒 BOOKING ELIGIBILITY: User ${userId}, Event ${eventId}, Quantity ${quantity}`);

  // Check event exists and is active
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, isActive: true, startDate: true }
  });

  if (!event || !event.isActive) {
    throw new AppError('Event not found or inactive', 404);
  }

  // Check if event has started
  if (new Date() >= new Date(event.startDate)) {
    throw new AppError('Cannot book tickets for events that have started', 400);
  }

  // 🛡️ SECURE: Server validates quota
  const existingBookings = await prisma.booking.aggregate({
    where: {
      userId,
      eventId,
      status: { in: ['PENDING', 'CONFIRMED'] }
    },
    _sum: { quantity: true }
  });

  const currentBookings = existingBookings._sum.quantity || 0;
  const maxBookingsPerUser = 4; // Business rule

  if (currentBookings + quantity > maxBookingsPerUser) {
    throw new AppError(`Maximum ${maxBookingsPerUser} bookings per user per event`, 400);
  }

  // 🛡️ SECURE: Server checks access tier capacity
  if (accessTierId) {
    const accessTier = await prisma.accessTier.findUnique({
      where: { id: accessTierId },
      select: { maxQuantity: true, eventId: true }
    });

    if (!accessTier || accessTier.eventId !== eventId) {
      throw new AppError('Invalid access tier', 400);
    }

    const tierBookings = await prisma.booking.aggregate({
      where: {
        accessTierId,
        status: 'CONFIRMED'
      },
      _sum: { quantity: true }
    });

    const tierUsed = tierBookings._sum.quantity || 0;
    if (tierUsed + quantity > accessTier.maxQuantity) {
      throw new AppError('Not enough capacity available', 400);
    }
  }

  // 🛡️ SECURE: User eligibility checks
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, dateOfBirth: true }
  });

  if (!user || !user.isActive) {
    throw new AppError('User account not active', 403);
  }

  // Age verification for event access
  if (user.dateOfBirth) {
    const userAge = Math.floor((new Date() - new Date(user.dateOfBirth)) / (365.25 * 24 * 60 * 60 * 1000));
    if (userAge < 18) {
      throw new AppError('Must be 18 or older to book events', 403);
    }
  }

  console.log(`✅ BOOKING ELIGIBILITY: User ${userId} eligible for ${quantity} tickets`);

  res.json(successResponse('Booking eligibility validated', {
    isEligible: true,
    maxQuantity: maxBookingsPerUser - currentBookings,
    currentBookings,
    validatedAt: new Date().toISOString()
  }));
}));

// @route   POST /api/validation/points-balance
// @desc    Secure server-side points balance validation
// @access  Private
router.post('/points-balance', authMiddleware, asyncHandler(async (req, res) => {
  const { rewardId, requiredPoints } = req.body;
  const userId = req.user.id;

  if (!rewardId || !requiredPoints) {
    throw new AppError('Reward ID and required points are required', 400);
  }

  // 🛡️ SECURE: Server gets actual user points
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, isActive: true }
  });

  if (!user || !user.isActive) {
    throw new AppError('User not found or inactive', 404);
  }

  // 🛡️ SECURE: Server validates reward exists
  const reward = await prisma.reward.findUnique({
    where: { id: rewardId },
    select: { pointsCost: true, isActive: true, stock: true }
  });

  if (!reward || !reward.isActive) {
    throw new AppError('Reward not found or inactive', 404);
  }

  if (reward.stock <= 0) {
    throw new AppError('Reward out of stock', 400);
  }

  // 🛡️ SECURE: Server validates points requirement
  if (requiredPoints !== reward.pointsCost) {
    throw new AppError('Invalid points requirement', 400);
  }

  const canAfford = user.points >= reward.pointsCost;

  console.log(`🔒 POINTS VALIDATION: User ${userId} has ${user.points}, needs ${reward.pointsCost}, can afford: ${canAfford}`);

  res.json(successResponse('Points balance validated', {
    userPoints: user.points,
    requiredPoints: reward.pointsCost,
    canAfford,
    remainingPoints: canAfford ? user.points - reward.pointsCost : user.points,
    validatedAt: new Date().toISOString()
  }));
}));

module.exports = router;