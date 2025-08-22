const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// Get all active polls
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category, // artist, venue, music, etc.
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      isActive: true
    };

    const polls = await prisma.poll.findMany({
      where,
      include: {
        items: {
          orderBy: {
            voteCount: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: offset,
      take: parseInt(limit)
    });

    const total = await prisma.poll.count({ where });

    // Filter items by category if specified
    const filteredPolls = category 
      ? polls.map(poll => ({
          ...poll,
          items: poll.items.filter(item => 
            item.name.toLowerCase().includes(category.toLowerCase()) ||
            (item.description && item.description.toLowerCase().includes(category.toLowerCase()))
          )
        })).filter(poll => poll.items.length > 0)
      : polls;

    res.status(200).json({
      success: true,
      data: {
        polls: filteredPolls,
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
    console.error('Error fetching polls:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch polls',
      error: error.message
    });
  }
});

// Get active poll items by category
router.get('/items', optionalAuth, async (req, res) => {
  try {
    const {
      category = 'artist', // artist, venue, music, etc.
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get poll items from active polls, filtered by category-like matching
    const pollItems = await prisma.pollItem.findMany({
      where: {
        poll: {
          isActive: true
        }
      },
      orderBy: {
        voteCount: 'desc'
      },
      skip: offset,
      take: parseInt(limit)
    });

    // Filter by category based on name/description content
    const filteredItems = pollItems.filter(item => {
      const itemText = `${item.name} ${item.description || ''}`.toLowerCase();
      return itemText.includes(category.toLowerCase());
    });

    // Transform to match app expected format
    const transformedItems = filteredItems.map(item => ({
      id: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      description: item.description,
      category: category,
      voteCount: item.voteCount
    }));

    res.status(200).json({
      success: true,
      data: {
        items: transformedItems,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(filteredItems.length / parseInt(limit)),
          total: filteredItems.length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching poll items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch poll items',
      error: error.message
    });
  }
});

// Vote on a poll item
router.post('/items/:itemId/vote', authMiddleware, async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const userId = req.user.id;

    // Check if item exists
    const pollItem = await prisma.pollItem.findUnique({
      where: { id: itemId },
      include: { poll: true }
    });

    if (!pollItem) {
      return res.status(404).json({
        success: false,
        message: 'Poll item not found'
      });
    }

    if (!pollItem.poll.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Poll is no longer active'
      });
    }

    // Check if user already voted for this item
    const existingVote = await prisma.vote.findUnique({
      where: {
        userId_pollItemId: {
          userId,
          pollItemId: itemId
        }
      }
    });

    if (existingVote) {
      return res.status(400).json({
        success: false,
        message: 'You have already voted for this item'
      });
    }

    // Check if user has reached vote limit for this poll
    const userVotesInPoll = await prisma.vote.count({
      where: {
        userId,
        pollItem: {
          pollId: pollItem.pollId
        }
      }
    });

    if (userVotesInPoll >= pollItem.poll.maxVotes) {
      return res.status(400).json({
        success: false,
        message: `You can only vote ${pollItem.poll.maxVotes} time(s) for this poll`
      });
    }

    // Create vote and increment vote count
    await prisma.$transaction([
      prisma.vote.create({
        data: {
          userId,
          pollItemId: itemId
        }
      }),
      prisma.pollItem.update({
        where: { id: itemId },
        data: {
          voteCount: {
            increment: 1
          }
        }
      })
    ]);

    res.status(201).json({
      success: true,
      message: 'Vote recorded successfully!'
    });
  } catch (error) {
    console.error('Error voting on poll item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record vote',
      error: error.message
    });
  }
});

// Get single poll
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const pollId = req.params.id;

    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        items: {
          orderBy: {
            voteCount: 'desc'
          }
        }
      }
    });

    if (!poll) {
      return res.status(404).json({
        success: false,
        message: 'Poll not found'
      });
    }

    res.status(200).json({
      success: true,
      data: poll
    });
  } catch (error) {
    console.error('Error fetching poll:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch poll',
      error: error.message
    });
  }
});

module.exports = router;