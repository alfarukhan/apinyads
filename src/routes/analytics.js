const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// @route   GET /api/analytics/overview
// @desc    Get dashboard overview statistics (for CMS dashboard)
// @access  Private (Admin only)
router.get('/overview', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Analytics: Fetching dashboard overview...');

    // Get total counts
    const [
      totalUsers,
      totalEvents,
      totalPosts,
      totalCommunities
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.event.count({ where: { isActive: true } }),
      prisma.post.count({ where: { isActive: true } }),
      prisma.community.count() // Community model doesn't have isActive field
    ]);

    // Get recent events (last 10, ordered by creation date)
    const recentEvents = await prisma.event.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        createdAt: true,
        eventDate: true,
        isActive: true
      }
    });

    // Get recent users (last 10, ordered by creation date)
    const recentUsers = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        email: true,
        createdAt: true,
        isActive: true
      }
    });

    const overviewStats = {
      totalEvents,
      totalUsers,
      totalCommunities,
      totalPosts,
      recentEvents,
      recentUsers
    };

    console.log('✅ Analytics: Overview stats generated successfully');

    res.json({
      success: true,
      data: overviewStats
    });
  } catch (error) {
    console.error('❌ Analytics: Error fetching overview stats:', error);
    throw new AppError('Failed to fetch overview statistics', 500);
  }
}));

// @route   GET /api/analytics/stats
// @desc    Get dashboard statistics (for CMS)
// @access  Private (Admin only)
router.get('/stats', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Analytics: Fetching dashboard stats...');

    // Get current counts
    const [
      totalUsers,
      activeEvents,
      totalPosts,
      totalCommunities,
      totalArtists,
      totalVenues,
      totalChallenges,
      totalTickets
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.event.count({ where: { isActive: true } }),
      prisma.post.count({ where: { isActive: true } }),
      prisma.community.count(), // Community model doesn't have isActive field
      prisma.artist.count({ where: { isActive: true } }),
      prisma.venue.count({ where: { isActive: true } }),
      prisma.challenge.count({ where: { status: 'ACTIVE' } }), // Challenge uses status field
      prisma.access.count()
    ]);

    // Get growth statistics (last 30 days vs previous 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [
      recentUsers,
      previousUsers,
      recentEvents,
      previousEvents,
      recentPosts,
      previousPosts,
      recentCommunities,
      previousCommunities
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo }, isActive: true } }),
      prisma.user.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, isActive: true } }),
      prisma.event.count({ where: { createdAt: { gte: thirtyDaysAgo }, isActive: true } }),
      prisma.event.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, isActive: true } }),
      prisma.post.count({ where: { createdAt: { gte: thirtyDaysAgo }, isActive: true } }),
      prisma.post.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, isActive: true } }),
      prisma.community.count({ where: { createdAt: { gte: thirtyDaysAgo } } }), // Community doesn't have isActive
      prisma.community.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }) // Community doesn't have isActive
    ]);

    // Calculate growth percentages
    const calculateGrowth = (recent, previous) => {
      if (previous === 0) return recent > 0 ? 100 : 0;
      return Math.round(((recent - previous) / previous) * 100);
    };

    const stats = {
      totalUsers,
      activeEvents,
      totalPosts,
      totalCommunities,
      totalArtists,
      totalVenues,
      totalChallenges,
      totalTickets,
      userGrowth: calculateGrowth(recentUsers, previousUsers),
      eventGrowth: calculateGrowth(recentEvents, previousEvents),
      postGrowth: calculateGrowth(recentPosts, previousPosts),
      communityGrowth: calculateGrowth(recentCommunities, previousCommunities),
    };

    console.log('✅ Analytics: Stats generated successfully');

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Analytics: Error fetching stats:', error);
    throw new AppError('Failed to fetch statistics', 500);
  }
}));

// @route   GET /api/analytics/chart-data
// @desc    Get chart data for the last 12 months
// @access  Private (Admin only) 
router.get('/chart-data', authMiddleware, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  try {
    console.log('🔍 Analytics: Fetching chart data...');

    const chartData = [];
    const currentDate = new Date();

    // Get data for last 12 months
    for (let i = 11; i >= 0; i--) {
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i + 1, 0);

      const [users, events, posts] = await Promise.all([
        prisma.user.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            isActive: true
          }
        }),
        prisma.event.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            isActive: true
          }
        }),
        prisma.post.count({
          where: {
            createdAt: { gte: startDate, lte: endDate },
            isActive: true
          }
        })
      ]);

      chartData.push({
        name: startDate.toLocaleDateString('en-US', { month: 'short' }),
        users,
        events,
        posts
      });
    }

    console.log('✅ Analytics: Chart data generated successfully');

    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('❌ Analytics: Error fetching chart data:', error);
    throw new AppError('Failed to fetch chart data', 500);
  }
}));

module.exports = router;