const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// Get all challenges with optional filtering
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      type, // DAILY, WEEKLY, MONTHLY, SPECIAL
      status = 'ACTIVE',
      page = 1,
      limit = 20
    } = req.query;

    const userId = req.user.id;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      status: status.toUpperCase()
    };

    if (type) {
      where.type = type.toUpperCase();
    }

    // Get challenges with user progress
    const challenges = await prisma.challenge.findMany({
      where,
      include: {
        progress: {
          where: { userId },
          select: {
            currentProgress: true,
            isCompleted: true,
            completedAt: true
          }
        }
      },
      orderBy: [
        { type: 'asc' },
        { startDate: 'desc' }
      ],
      skip: offset,
      take: parseInt(limit)
    });

    const total = await prisma.challenge.count({ where });

    // Transform data for frontend
    const transformedChallenges = challenges.map(challenge => ({
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      type: challenge.type,
      status: challenge.status,
      targetValue: challenge.targetValue,
      currentProgress: challenge.progress[0]?.currentProgress || 0,
      rewardPoints: challenge.rewardPoints,
      imageUrl: challenge.imageUrl,
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      isCompleted: challenge.progress[0]?.isCompleted || false,
      completedAt: challenge.progress[0]?.completedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        challenges: transformedChallenges,
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
    console.error('Error fetching challenges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch challenges',
      error: error.message
    });
  }
});

// Get user's completed challenges
router.get('/completed', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const completedChallenges = await prisma.challengeProgress.findMany({
      where: {
        userId,
        isCompleted: true
      },
      include: {
        challenge: true
      },
      orderBy: {
        completedAt: 'desc'
      },
      skip: offset,
      take: parseInt(limit)
    });

    const total = await prisma.challengeProgress.count({
      where: {
        userId,
        isCompleted: true
      }
    });

    // Transform data for frontend
    const transformedChallenges = completedChallenges.map(progress => ({
      id: progress.challenge.id,
      title: progress.challenge.title,
      description: progress.challenge.description,
      type: progress.challenge.type,
      status: 'COMPLETED',
      targetValue: progress.challenge.targetValue,
      currentProgress: progress.currentProgress,
      rewardPoints: progress.challenge.rewardPoints,
      imageUrl: progress.challenge.imageUrl,
      startDate: progress.challenge.startDate,
      endDate: progress.challenge.endDate,
      isCompleted: true,
      completedAt: progress.completedAt
    }));

    res.status(200).json({
      success: true,
      data: {
        challenges: transformedChallenges,
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
    console.error('Error fetching completed challenges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completed challenges',
      error: error.message
    });
  }
});

// Get single challenge
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;
    const userId = req.user.id;

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        progress: {
          where: { userId },
          select: {
            currentProgress: true,
            isCompleted: true,
            completedAt: true
          }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    const transformedChallenge = {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      type: challenge.type,
      status: challenge.status,
      targetValue: challenge.targetValue,
      currentProgress: challenge.progress[0]?.currentProgress || 0,
      rewardPoints: challenge.rewardPoints,
      imageUrl: challenge.imageUrl,
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      isCompleted: challenge.progress[0]?.isCompleted || false,
      completedAt: challenge.progress[0]?.completedAt
    };

    res.status(200).json({
      success: true,
      data: transformedChallenge
    });
  } catch (error) {
    console.error('Error fetching challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch challenge',
      error: error.message
    });
  }
});

// Join/Start a challenge
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;
    const userId = req.user.id;

    // Check if challenge exists and is active
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId }
    });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    if (challenge.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Challenge is not active'
      });
    }

    // Check if user already joined
    const existingProgress = await prisma.challengeProgress.findUnique({
      where: {
        userId_challengeId: {
          userId,
          challengeId
        }
      }
    });

    if (existingProgress) {
      return res.status(400).json({
        success: false,
        message: 'Already joined this challenge'
      });
    }

    // Create progress record
    const progress = await prisma.challengeProgress.create({
      data: {
        userId,
        challengeId,
        currentProgress: 0,
        isCompleted: false
      }
    });

    res.status(201).json({
      success: true,
      message: 'Successfully joined challenge',
      data: progress
    });
  } catch (error) {
    console.error('Error joining challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join challenge',
      error: error.message
    });
  }
});

// Update challenge progress
router.post('/:id/progress', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;
    const userId = req.user.id;
    const { increment = 1 } = req.body;

    // Get challenge and current progress
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        progress: {
          where: { userId }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    let progress = challenge.progress[0];

    if (!progress) {
      // Create progress if doesn't exist
      progress = await prisma.challengeProgress.create({
        data: {
          userId,
          challengeId,
          currentProgress: 0,
          isCompleted: false
        }
      });
    }

    if (progress.isCompleted) {
      return res.status(400).json({
        success: false,
        message: 'Challenge already completed'
      });
    }

    // Update progress
    const newProgress = Math.min(
      progress.currentProgress + parseInt(increment),
      challenge.targetValue
    );

    const isCompleted = newProgress >= challenge.targetValue;

    const updatedProgress = await prisma.challengeProgress.update({
      where: { id: progress.id },
      data: {
        currentProgress: newProgress,
        isCompleted,
        completedAt: isCompleted ? new Date() : null
      }
    });

    res.status(200).json({
      success: true,
      message: isCompleted ? 'Challenge completed!' : 'Progress updated',
      data: updatedProgress
    });
  } catch (error) {
    console.error('Error updating challenge progress:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update progress',
      error: error.message
    });
  }
});

// Complete challenge manually
router.post('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const challengeId = req.params.id;
    const userId = req.user.id;

    // Get challenge and current progress
    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      include: {
        progress: {
          where: { userId }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({
        success: false,
        message: 'Challenge not found'
      });
    }

    let progress = challenge.progress[0];

    if (!progress) {
      // Create progress if doesn't exist
      progress = await prisma.challengeProgress.create({
        data: {
          userId,
          challengeId,
          currentProgress: challenge.targetValue,
          isCompleted: true,
          completedAt: new Date()
        }
      });
    } else if (progress.isCompleted) {
      return res.status(400).json({
        success: false,
        message: 'Challenge already completed'
      });
    } else {
      // Mark as completed
      progress = await prisma.challengeProgress.update({
        where: { id: progress.id },
        data: {
          currentProgress: challenge.targetValue,
          isCompleted: true,
          completedAt: new Date()
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Challenge completed successfully!',
      data: progress
    });
  } catch (error) {
    console.error('Error completing challenge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete challenge',
      error: error.message
    });
  }
});

module.exports = router;