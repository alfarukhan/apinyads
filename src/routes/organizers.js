const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// ✅ ENTERPRISE: Use centralized authorization utilities
const authUtils = require('../lib/auth-utils');


// Get all event organizers
router.get('/', async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '50', 
      city, 
      category,
      verified 
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build where conditions for both User organizers and EO table
    const userWhere = {
      isActive: true,
      role: 'ORGANIZER'
    };

    const eoWhere = {
      verified: verified !== undefined ? verified === 'true' : undefined
    };

    if (city) {
      userWhere.city = {
        contains: city,
        mode: 'insensitive'
      };
      eoWhere.city = {
        contains: city,
        mode: 'insensitive'
      };
    }

    // Get organizers from both User table (role: ORGANIZER) and EO table
    const [userOrganizers, eoOrganizers, userTotal, eoTotal] = await Promise.all([
      prisma.user.findMany({
        where: userWhere,
        skip: Math.floor(skip / 2), // Split pagination between sources
        take: Math.floor(limitNum / 2),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
          city: true,
          country: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: {
              events: true
            }
          }
        }
      }),
      prisma.eO.findMany({
        where: eoWhere,
        skip: Math.floor(skip / 2),
        take: Math.ceil(limitNum / 2),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where: userWhere }),
      prisma.eO.count({ where: eoWhere })
    ]);

    // Convert to unified format
    const organizers = [
      ...userOrganizers.map(user => ({
        id: user.id,
        name: user.firstName && user.lastName ? 
          `${user.firstName} ${user.lastName}` : user.username,
        logoUrl: user.avatar || 'https://alfarukhan.my.id/artwork1.jpg',
        city: user.city || 'Unknown City',
        about: user.bio || 'Event organizer and music enthusiast',
        verified: user.isVerified,
        eventsCount: user._count.events,
        type: 'USER',
        createdAt: user.createdAt
      })),
      ...eoOrganizers.map(eo => ({
        id: eo.id,
        name: eo.name,
        logoUrl: eo.photoUrl || 'https://alfarukhan.my.id/artwork1.jpg',
        city: eo.city || 'Unknown City',
        about: eo.about || 'Professional event organizer',
        verified: eo.verified,
        eventsCount: 0, // Would need to calculate from events table
        type: 'EO',
        createdAt: eo.createdAt
      }))
    ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limitNum);

    const total = userTotal + eoTotal;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        organizers,
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
    console.error('Error fetching organizers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizers',
      error: error.message
    });
  }
});

// Get organizer by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Try to find in both User and EO tables
    const [userOrganizer, eoOrganizer] = await Promise.all([
      prisma.user.findUnique({
        where: { 
          id,
          role: 'ORGANIZER',
          isActive: true
        },
        include: {
          events: {
            where: { isActive: true },
            select: {
              id: true,
              title: true,
              description: true,
              imageUrl: true,
              startDate: true,
              endDate: true,
              price: true,
              currency: true,
              location: true,
              capacity: true,
              category: true,
              hasGuestlist: true,
              isPublic: true,
              status: true
            },
            orderBy: { startDate: 'desc' },
            take: 20
          },
          _count: {
            select: {
              events: true,
              followers: true
            }
          }
        }
      }),
      prisma.eO.findUnique({
        where: { id }
      })
    ]);

    let organizer = null;

    if (userOrganizer) {
      organizer = {
        id: userOrganizer.id,
        name: userOrganizer.firstName && userOrganizer.lastName ? 
          `${userOrganizer.firstName} ${userOrganizer.lastName}` : userOrganizer.username,
        logoUrl: userOrganizer.avatar || 'https://alfarukhan.my.id/artwork1.jpg',
        city: userOrganizer.city || 'Unknown City',
        country: userOrganizer.country || 'Unknown Country',
        about: userOrganizer.bio || 'Event organizer and music enthusiast',
        verified: userOrganizer.isVerified,
        eventsCount: userOrganizer._count.events,
        followersCount: userOrganizer._count.followers,
        events: userOrganizer.events,
        type: 'USER',
        createdAt: userOrganizer.createdAt
      };
    } else if (eoOrganizer) {
      // Get events for EO organizer - updated to use eoId relation
      const events = await prisma.event.findMany({
        where: {
          eoId: eoOrganizer.id,
          isActive: true
        },
        select: {
          id: true,
          title: true,
          description: true,
          imageUrl: true,
          startDate: true,
          endDate: true,
          price: true,
          currency: true,
          location: true,
          capacity: true,
          category: true,
          hasGuestlist: true,
          isPublic: true,
          status: true
        },
        orderBy: { startDate: 'desc' },
        take: 20
      });

      organizer = {
        id: eoOrganizer.id,
        name: eoOrganizer.name,
        logoUrl: eoOrganizer.photoUrl || 'https://alfarukhan.my.id/artwork1.jpg',
        city: eoOrganizer.city || 'Unknown City',
        country: 'Indonesia', // Default
        about: eoOrganizer.about || 'Professional event organizer',
        verified: eoOrganizer.verified,
        eventsCount: events.length,
        followersCount: 0, // EO table doesn't have followers
        events: events,
        type: 'EO',
        createdAt: eoOrganizer.createdAt
      };
    }

    if (!organizer) {
      return res.status(404).json({
        success: false,
        message: 'Organizer not found'
      });
    }

    res.json({
      success: true,
      data: { organizer }
    });
  } catch (error) {
    console.error('Error fetching organizer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizer',
      error: error.message
    });
  }
});

// Get events by organizer
router.get('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20', status } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build where conditions
    const where = {
      organizerId: id,
      isActive: true
    };

    if (status) {
      where.status = status.toUpperCase();
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { startDate: 'desc' },
        include: {
          venue: {
            select: {
              id: true,
              name: true,
              location: true
            }
          },
          artists: {
            include: {
              artist: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  genres: true
                }
              }
            }
          },
          _count: {
            select: {
              registrations: true,
              guestLists: true
            }
          }
        }
      }),
      prisma.event.count({ where })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
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
    console.error('Error fetching organizer events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizer events',
      error: error.message
    });
  }
});

// Search organizers
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

    // Search in both User organizers and EO table
    const [userOrganizers, eoOrganizers] = await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          role: 'ORGANIZER',
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { bio: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: Math.floor(limitNum / 2),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
          city: true,
          country: true,
          isVerified: true,
          _count: {
            select: {
              events: true
            }
          }
        }
      }),
      prisma.eO.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { about: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: Math.ceil(limitNum / 2),
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Convert to unified format
    const organizers = [
      ...userOrganizers.map(user => ({
        id: user.id,
        name: user.firstName && user.lastName ? 
          `${user.firstName} ${user.lastName}` : user.username,
        logoUrl: user.avatar || 'https://alfarukhan.my.id/artwork1.jpg',
        city: user.city || 'Unknown City',
        about: user.bio || 'Event organizer and music enthusiast',
        verified: user.isVerified,
        eventsCount: user._count.events,
        type: 'USER'
      })),
      ...eoOrganizers.map(eo => ({
        id: eo.id,
        name: eo.name,
        logoUrl: eo.photoUrl || 'https://alfarukhan.my.id/artwork1.jpg',
        city: eo.city || 'Unknown City',
        about: eo.about || 'Professional event organizer',
        verified: eo.verified,
        eventsCount: 0,
        type: 'EO'
      }))
    ].slice(0, limitNum);

    res.json({
      success: true,
      data: { organizers }
    });
  } catch (error) {
    console.error('Error searching organizers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search organizers',
      error: error.message
    });
  }
});

// @route   GET /api/organizers/:id/artists
// @desc    Get artists associated with specific organizer through their events
// @access  Public
router.get('/:id/artists', async (req, res) => {
  try {
    const { id } = req.params;

    // Get artists who performed in events organized by this EO
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { organizerId: id },
          { eoId: id }
        ],
        isActive: true
      },
      include: {
        artists: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                city: true,
                country: true,
                genres: true,
                isVerified: true,
                followersCount: true
              }
            }
          }
        }
      }
    });

    // Extract unique artists from all events
    const artistsMap = new Map();
    events.forEach(event => {
      event.artists.forEach(eventArtist => {
        const artist = eventArtist.artist;
        if (!artistsMap.has(artist.id)) {
          artistsMap.set(artist.id, artist);
        }
      });
    });

    const artists = Array.from(artistsMap.values());

    res.json({
      success: true,
      data: { artists },
    });
  } catch (error) {
    console.error('Error fetching organizer artists:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizer artists',
      error: error.message
    });
  }
});

// @route   GET /api/organizers/:id/venues
// @desc    Get venues associated with specific organizer
// @access  Public
router.get('/:id/venues', async (req, res) => {
  try {
    const { id } = req.params;

    // Get venues used by this organizer through their events
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { organizerId: id },
          { eoId: id }
        ],
        isActive: true,
        venueId: { not: null }
      },
      include: {
        venue: true
      },
      distinct: ['venueId']
    });

    const venues = events
      .filter(event => event.venue)
      .map(event => event.venue)
      .filter((venue, index, self) => 
        index === self.findIndex(v => v.id === venue.id)
      ); // Remove duplicates

    res.json({
      success: true,
      data: { venues },
    });
  } catch (error) {
    console.error('Error fetching organizer venues:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizer venues',
      error: error.message
    });
  }
});

// @route   GET /api/organizers/:id/events/upcoming
// @desc    Get upcoming events organized by specific organizer
// @access  Public
router.get('/:id/events/upcoming', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = '10' } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    const events = await prisma.event.findMany({
      where: {
        OR: [
          { organizerId: id },
          { eoId: id }
        ],
        isActive: true,
        startDate: {
          gte: new Date()
        }
      },
      take: limitNum,
      orderBy: { startDate: 'asc' },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            location: true
          }
        },
        artists: {
          include: {
            artist: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                genres: true
              }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      data: { events },
    });
  } catch (error) {
    console.error('Error fetching organizer upcoming events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organizer upcoming events',
      error: error.message
    });
  }
});

module.exports = router;