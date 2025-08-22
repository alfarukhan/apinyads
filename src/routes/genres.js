const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

const asyncHandler = require('../middleware/asyncHandler');

// Get all genres with statistics
router.get('/', async (req, res) => {
  try {
    const { page = '1', limit = '50' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Get unique genres from artists and events
    const [artistGenres, eventGenres] = await Promise.all([
      prisma.artist.findMany({
        where: { isActive: true },
        select: { genres: true }
      }),
      prisma.event.findMany({
        where: { isActive: true },
        select: { genres: true }
      })
    ]);

    // Flatten and count genres
    const genreStats = {};
    
    // Count from artists
    artistGenres.forEach(artist => {
      artist.genres.forEach(genre => {
        if (!genreStats[genre]) {
          genreStats[genre] = { artistsCount: 0, eventsCount: 0 };
        }
        genreStats[genre].artistsCount++;
      });
    });

    // Count from events
    eventGenres.forEach(event => {
      event.genres.forEach(genre => {
        if (!genreStats[genre]) {
          genreStats[genre] = { artistsCount: 0, eventsCount: 0 };
        }
        genreStats[genre].eventsCount++;
      });
    });

    // Convert to array and add metadata
    const genres = Object.entries(genreStats).map(([name, stats]) => ({
      name,
      description: getGenreDescription(name),
      artistsCount: stats.artistsCount,
      eventsCount: stats.eventsCount,
      imageUrl: `https://alfarukhan.my.id/artwork${Math.floor(Math.random() * 10) + 1}.jpg`,
      color: getGenreColor(name),
      isPopular: stats.artistsCount + stats.eventsCount > 5
    }))
    .sort((a, b) => (b.artistsCount + b.eventsCount) - (a.artistsCount + a.eventsCount))
    .slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const total = Object.keys(genreStats).length;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        genres,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching genres:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch genres',
      error: error.message
    });
  }
});

// Get artists by genre
router.get('/:genreName/artists', async (req, res) => {
  try {
    const { genreName } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: {
          isActive: true,
          genres: {
            has: genreName
          }
        },
        skip,
        take: limitNum,
        orderBy: { followersCount: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          genres: true,
          country: true,
          city: true,
          isVerified: true,
          followersCount: true
        }
      }),
      prisma.artist.count({
        where: {
          isActive: true,
          genres: {
            has: genreName
          }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        genre: genreName,
        artists,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching artists by genre:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch artists by genre',
      error: error.message
    });
  }
});

// Get events by genre
router.get('/:genreName/events', async (req, res) => {
  try {
    const { genreName } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: {
          isActive: true,
          genres: {
            has: genreName
          }
        },
        skip,
        take: limitNum,
        orderBy: { startDate: 'asc' },
        include: {
          organizer: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          },
          venue: {
            select: {
              id: true,
              name: true,
              location: true
            }
          }
        }
      }),
      prisma.event.count({
        where: {
          isActive: true,
          genres: {
            has: genreName
          }
        }
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        genre: genreName,
        events,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching events by genre:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events by genre',
      error: error.message
    });
  }
});

// Search genres
router.get('/search', async (req, res) => {
  try {
    const { q: query, limit = '20' } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    // Search in artist and event genres
    const [artists, events] = await Promise.all([
      prisma.artist.findMany({
        where: {
          isActive: true,
          genres: {
            hasSome: [query]
          }
        },
        select: { genres: true }
      }),
      prisma.event.findMany({
        where: {
          isActive: true,
          genres: {
            hasSome: [query]
          }
        },
        select: { genres: true }
      })
    ]);

    const matchingGenres = new Set();
    [...artists, ...events].forEach(item => {
      item.genres.forEach(genre => {
        if (genre.toLowerCase().includes(query.toLowerCase())) {
          matchingGenres.add(genre);
        }
      });
    });

    const genres = Array.from(matchingGenres).slice(0, limitNum).map(name => ({
      name,
      description: getGenreDescription(name),
      imageUrl: `https://alfarukhan.my.id/artwork${Math.floor(Math.random() * 10) + 1}.jpg`,
      color: getGenreColor(name)
    }));

    res.json({
      success: true,
      data: { genres }
    });
  } catch (error) {
    console.error('Error searching genres:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search genres',
      error: error.message
    });
  }
});

// @route   GET /api/genres/list
// @desc    Get list of genres for registration
// @access  Public
router.get('/list', asyncHandler(async (req, res) => {
  // Music genres list for registration
  const genres = [
    'Electronic', 'House', 'Techno', 'Trance', 'Dubstep', 'Drum & Bass', 
    'Progressive House', 'Deep House', 'Tech House', 'Minimal Techno', 
    'Ambient', 'Breakbeat', 'Hardstyle', 'Future Bass', 'Trap', 'EDM',
    'Psytrance', 'Electro', 'Garage', 'Jungle', 'IDM', 'Chillout',
    'Lounge', 'Trip Hop', 'Downtempo', 'Big Room', 'Melbourne Bounce',
    'Complextro', 'Moombahton', 'Glitch Hop', 'Neurofunk', 'Liquid DnB'
  ].sort();

  res.json({
    success: true,
    data: genres
  });
}));

// Helper functions
function getGenreDescription(genreName) {
  const descriptions = {
    'House': 'Four-on-the-floor beats with repetitive rhythms',
    'Techno': 'Electronic dance music with mechanical rhythms',
    'Deep House': 'Soulful house music with complex melodies',
    'Progressive': 'Gradually building electronic music',
    'Trance': 'Hypnotic electronic music with emotional builds',
    'Electronic': 'Broad category of electronic music',
    'Indie Electronic': 'Independent electronic music production',
    'Ambient': 'Atmospheric electronic soundscapes',
    'Chillwave': 'Nostalgic electronic music with lo-fi aesthetics',
    'Electronic Rock': 'Rock music enhanced with electronic elements',
    'Synthpop': 'Pop music featuring synthesizers',
    'Alternative': 'Non-mainstream electronic music',
    'Synthwave': 'Retro-futuristic electronic music',
    'Nu-Disco': 'Modern take on classic disco',
    'Electronic Pop': 'Pop music with electronic production'
  };
  return descriptions[genreName] || `${genreName} music genre`;
}

function getGenreColor(genreName) {
  const colors = {
    'House': '#FF6B6B',
    'Techno': '#4ECDC4',
    'Deep House': '#45B7D1',
    'Progressive': '#96CEB4',
    'Trance': '#FFEAA7',
    'Electronic': '#DDA0DD',
    'Indie Electronic': '#98D8C8',
    'Ambient': '#A8E6CF',
    'Chillwave': '#FFD93D',
    'Electronic Rock': '#FF8B94',
    'Synthpop': '#B4A7D6',
    'Alternative': '#D4A5A5',
    'Synthwave': '#FF7675',
    'Nu-Disco': '#6C5CE7',
    'Electronic Pop': '#FD79A8'
  };
  return colors[genreName] || '#2f4592';
}

module.exports = router;