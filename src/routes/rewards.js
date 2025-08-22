const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { successResponse, paginatedResponse, errorResponse } = require('../lib/response-formatters');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// Get all available rewards
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      type, // BADGE, POINTS, VOUCHER, MERCHANDISE
      category,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      isAvailable: true
    };

    if (type) {
      where.type = type.toUpperCase();
    }

    if (category) {
      where.category = category;
    }

    const rewards = await prisma.reward.findMany({
      where,
      orderBy: [
        { type: 'asc' },
        { pointsCost: 'asc' }
      ],
      skip: offset,
      take: parseInt(limit)
    });

    const total = await prisma.reward.count({ where });

    // Check user's redemptions for each reward
    const userId = req.user.id;
    const rewardsWithRedemptionStatus = await Promise.all(
      rewards.map(async (reward) => {
        const redemption = await prisma.rewardRedemption.findFirst({
          where: {
            userId,
            rewardId: reward.id
          }
        });

        return {
          id: reward.id,
          title: reward.title,
          description: reward.description,
          type: reward.type,
          pointsCost: reward.pointsCost,
          imageUrl: reward.imageUrl,
          isAvailable: reward.isAvailable,
          expiryDate: reward.expiryDate,
          isRedeemed: redemption?.isRedeemed || false,
          redeemCode: redemption?.redeemCode
        };
      })
    );

    // ✅ ENTERPRISE: Use standardized response format
    res.json(paginatedResponse(
      { rewards: rewardsWithRedemptionStatus },
      {
        page: parseInt(page),
        lastPage: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
        total,
        hasNext: offset + parseInt(limit) < total,
        hasPrevious: parseInt(page) > 1
      },
      'Rewards retrieved successfully'
    ));
  } catch (error) {
    console.error('Error fetching rewards:', error);
    // ✅ ENTERPRISE: Use standardized error response format
    res.status(500).json(errorResponse(
      'Failed to fetch rewards',
      [error.message]
    ));
  }
});

// Get single reward
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const rewardId = req.params.id;
    const userId = req.user.id;

    const reward = await prisma.reward.findUnique({
      where: { id: rewardId }
    });

    if (!reward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }

    // Check if user has redeemed this reward
    const redemption = await prisma.rewardRedemption.findFirst({
      where: {
        userId,
        rewardId
      }
    });

    const rewardWithStatus = {
      id: reward.id,
      title: reward.title,
      description: reward.description,
      type: reward.type,
      pointsCost: reward.pointsCost,
      imageUrl: reward.imageUrl,
      isAvailable: reward.isAvailable,
      expiryDate: reward.expiryDate,
      isRedeemed: redemption?.isRedeemed || false,
      redeemCode: redemption?.redeemCode,
      redeemedAt: redemption?.redeemedAt
    };

    res.status(200).json({
      success: true,
      data: rewardWithStatus
    });
  } catch (error) {
    console.error('Error fetching reward:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reward',
      error: error.message
    });
  }
});

// Redeem a reward
router.post('/:id/redeem', authMiddleware, async (req, res) => {
  try {
    const rewardId = req.params.id;
    const userId = req.user.id;

    // Get user and reward
    const [user, reward] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.reward.findUnique({ where: { id: rewardId } })
    ]);

    if (!reward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found'
      });
    }

    if (!reward.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Reward is no longer available'
      });
    }

    if (reward.expiryDate && new Date() > reward.expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Reward has expired'
      });
    }

    // Check if user has enough points
    const userPoints = user.points || 0;
    if (userPoints < reward.pointsCost) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient points to redeem this reward'
      });
    }

    // Check if user already redeemed this reward
    const existingRedemption = await prisma.rewardRedemption.findFirst({
      where: {
        userId,
        rewardId
      }
    });

    if (existingRedemption) {
      return res.status(400).json({
        success: false,
        message: 'You have already redeemed this reward'
      });
    }

    // Create redemption and deduct points
    const redeemCode = `RC${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    const [redemption] = await prisma.$transaction([
      prisma.rewardRedemption.create({
        data: {
          userId,
          rewardId,
          redeemCode,
          isRedeemed: true,
          redeemedAt: new Date()
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          points: {
            decrement: reward.pointsCost
          }
        }
      })
    ]);

    res.status(201).json({
      success: true,
      message: 'Reward redeemed successfully!',
      data: {
        redemption,
        redeemCode,
        pointsUsed: reward.pointsCost,
        remainingPoints: userPoints - reward.pointsCost
      }
    });
  } catch (error) {
    console.error('Error redeeming reward:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to redeem reward',
      error: error.message
    });
  }
});

// Get user's redemptions
router.get('/my/redemptions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const redemptions = await prisma.rewardRedemption.findMany({
      where: { userId },
      include: {
        reward: true
      },
      orderBy: {
        redeemedAt: 'desc'
      },
      skip: offset,
      take: parseInt(limit)
    });

    const total = await prisma.rewardRedemption.count({
      where: { userId }
    });

    const transformedRedemptions = redemptions.map(redemption => ({
      id: redemption.id,
      redeemCode: redemption.redeemCode,
      isRedeemed: redemption.isRedeemed,
      redeemedAt: redemption.redeemedAt,
      reward: {
        id: redemption.reward.id,
        title: redemption.reward.title,
        description: redemption.reward.description,
        type: redemption.reward.type,
        pointsCost: redemption.reward.pointsCost,
        imageUrl: redemption.reward.imageUrl
      }
    }));

    res.status(200).json({
      success: true,
      data: {
        redemptions: transformedRedemptions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          total,
          hasNext: offset + parseInt(limit) < total,
          hasPrevious: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching user redemptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch redemptions',
      error: error.message
    });
  }
});

// Get user's current points
router.get('/my/points', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { points: true }
    });

    res.status(200).json({
      success: true,
      data: {
        points: user?.points || 0
      }
    });
  } catch (error) {
    console.error('Error fetching user points:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user points',
      error: error.message
    });
  }
});

module.exports = router;