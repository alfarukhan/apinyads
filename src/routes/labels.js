const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { optionalAuth, authMiddleware } = require('../middleware/auth');
const { successResponse, paginatedResponse } = require('../lib/response-formatters');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// @route   GET /api/labels
// @desc    Get all music labels with pagination
// @access  Public
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    genre,
    city,
    verified
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = Math.min(parseInt(limit), 50); // Max 50 per request

  // Build where clause
  const where = {
    ...(genre && {
      genres: {
        has: genre
      }
    }),
    ...(city && {
      city: { contains: city, mode: 'insensitive' }
    }),
    ...(verified !== undefined && {
      verified: verified === 'true'
    })
  };

  const [labels, total] = await Promise.all([
    prisma.label.findMany({
      where,
      skip,
      take,
      orderBy: [
        { verified: 'desc' },
        { artistsCount: 'desc' },
        { name: 'asc' }
      ]
    }),
    prisma.label.count({ where })
  ]);

  const totalPages = Math.ceil(total / take);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  // ✅ ENTERPRISE: Use standardized response format
  res.json(paginatedResponse(
    { labels },
    {
      page: parseInt(page),
      lastPage: totalPages,
      limit: take,
      total,
      hasNext: hasNextPage,
      hasPrevious: hasPreviousPage
    },
    'Labels retrieved successfully'
  ));
}));

// @route   GET /api/labels/popular
// @desc    Get popular labels
// @access  Public  
router.get('/popular', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const take = Math.min(parseInt(limit), 20);

  const labels = await prisma.label.findMany({
    take,
    orderBy: [
      { verified: 'desc' },
      { artistsCount: 'desc' },
      { name: 'asc' }
    ]
  });

  res.json(successResponse({ labels }, 'Popular labels retrieved successfully'));
}));

// @route   GET /api/labels/:id
// @desc    Get label by ID
// @access  Public
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const label = await prisma.label.findUnique({
    where: { id }
  });

  if (!label) {
    throw new AppError('Label not found', 404);
  }

  res.json(successResponse({ label }, 'Label retrieved successfully'));
}));

// @route   GET /api/labels/search
// @desc    Search labels
// @access  Public
router.get('/search', optionalAuth, asyncHandler(async (req, res) => {
  const { q: query, limit = 20 } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Search query must be at least 2 characters'
    });
  }

  const take = Math.min(parseInt(limit), 50);

  const labels = await prisma.label.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { about: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } }
      ]
    },
    take,
    orderBy: [
      { verified: 'desc' },
      { artistsCount: 'desc' },
      { name: 'asc' }
    ]
  });

  res.json(successResponse({ labels }, 'Labels search completed'));
}));

// @route   GET /api/labels/:id/artists
// @desc    Get artists signed to specific label
// @access  Public
router.get('/:id/artists', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if label exists and get artists
  const label = await prisma.label.findUnique({
    where: { id },
    include: {
      artists: {
        where: { isActive: true },
        orderBy: [
          { isVerified: 'desc' },
          { followersCount: 'desc' },
          { name: 'asc' }
        ]
      }
    }
  });

  if (!label) {
    throw new AppError('Label not found', 404);
  }

  res.json({
    success: true,
    message: 'Label artists retrieved successfully',
    data: {
      label: {
        id: label.id,
        name: label.name,
        logoUrl: label.logoUrl,
        city: label.city,
        about: label.about,
        verified: label.verified,
        foundedYear: label.foundedYear,
        artistsCount: label.artistsCount,
        genres: label.genres
      },
      artists: label.artists 
    }
  });
}));

module.exports = router;