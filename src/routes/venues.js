const express = require('express');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

// ✅ DECIMAL: Coordinate conversion utilities
const { convertCoordinatesArray } = require('../utils/decimal-helpers');

// ✅ MIDDLEWARE: Auth middleware for protected routes
const { authMiddleware, requireRole } = require('../middleware/auth');


// Get all venues with pagination and filters
router.get('/', async (req, res) => {
  try {
    const { 
      page = '1', 
      limit = '50', 
      city, 
      category,
      search 
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build where conditions
    const where = {
      isActive: true,
    };

    if (city) {
      where.location = {
        contains: city,
        mode: 'insensitive'
      };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get venues with pagination
    const [venues, total] = await Promise.all([
      prisma.venue.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          location: true,
          address: true,
          latitude: true,
          longitude: true,
          capacity: true,
          amenities: true,
          phone: true,
          website: true,
          email: true,
          operatingHours: true,
          createdAt: true,
          _count: {
            select: {
              events: true
            }
          },
          // Include RSVP events data
          events: {
            where: {
              category: 'VENUE_RSVP',
              isActive: true
            },
            select: {
              id: true,
              title: true,
              description: true,
              capacity: true,
              accessTiers: {
                where: {
                  isActive: true
                },
                select: {
                  id: true,
                  name: true,
                  description: true,
                  price: true,
                  currency: true,
                  maxQuantity: true,
                  availableQuantity: true,
                  benefits: true
                }
              }
            }
          }
        }
      }),
      prisma.venue.count({ where })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // ✅ DECIMAL: Convert Decimal coordinates to numbers for API response
    const venuesWithNumbers = convertCoordinatesArray(venues);

    // ✅ RSVP: Add RSVP information to venues
    const venuesWithRSVP = venuesWithNumbers.map(venue => {
      const rsvpEvent = venue.events && venue.events.length > 0 ? venue.events[0] : null;
      const rsvpTier = rsvpEvent?.accessTiers && rsvpEvent.accessTiers.length > 0 ? rsvpEvent.accessTiers[0] : null;
      
      return {
        ...venue,
        // Add RSVP configuration
        rsvp: rsvpEvent && rsvpEvent.accessTiers.length > 0 ? {
          enabled: true,
          eventId: rsvpEvent.id,
          tiers: rsvpEvent.accessTiers.map(tier => ({
            id: tier.id,
            name: tier.name,
            price: tier.price,
            currency: tier.currency,
            maxQuantity: tier.maxQuantity < 999999 ? tier.maxQuantity : null,
            availableQuantity: tier.availableQuantity,
            description: tier.description,
            benefits: tier.benefits
          }))
        } : {
          enabled: false
        },
        // Remove events array from response (only used internally)
        events: undefined
      };
    });

    // ✅ DEBUG: Log coordinate data for debugging
    console.log('📍 Venues API: Returning venues with coordinates:');
    venuesWithRSVP.forEach((venue, index) => {
      if (index < 3) { // Log first 3 venues only
        console.log(`📍 Venue ${venue.name}: lat=${venue.latitude}, lng=${venue.longitude} (type: ${typeof venue.latitude}), RSVP: ${venue.rsvp.enabled}`);
      }
    });

    res.json({
      success: true,
      data: {
        venues: venuesWithRSVP,
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
    console.error('Error fetching venues:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch venues',
      error: error.message
    });
  }
});

// Get venue by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const venue = await prisma.venue.findUnique({
      where: { id },
      include: {
        events: {
          where: {
            isActive: true,
            startDate: {
              gte: new Date()
            }
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
            category: true,
            capacity: true
          },
          take: 10,
          orderBy: { startDate: 'asc' }
        },
        _count: {
          select: {
            events: true
          }
        },
        // Include RSVP events data  
        rsvpEvents: {
          where: {
            category: 'VENUE_RSVP',
            isActive: true
          },
          select: {
            id: true,
            title: true,
            description: true,
            capacity: true,
            accessTiers: {
              where: {
                isActive: true
              },
              select: {
                id: true,
                name: true,
                description: true,
                price: true,
                currency: true,
                maxQuantity: true,
                availableQuantity: true,
                benefits: true
              }
            }
          }
        }
      }
    });

    if (!venue || !venue.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Venue not found'
      });
    }

    // ✅ RSVP: Add RSVP information to venue
    const rsvpEvent = venue.rsvpEvents && venue.rsvpEvents.length > 0 ? venue.rsvpEvents[0] : null;
    const rsvpTier = rsvpEvent?.accessTiers && rsvpEvent.accessTiers.length > 0 ? rsvpEvent.accessTiers[0] : null;
    
    const venueWithRSVP = {
      ...venue,
      // Add RSVP configuration
      rsvp: rsvpEvent && rsvpEvent.accessTiers.length > 0 ? {
        enabled: true,
        eventId: rsvpEvent.id,
        tiers: rsvpEvent.accessTiers.map(tier => ({
          id: tier.id,
          name: tier.name,
          price: tier.price,
          currency: tier.currency,
          maxQuantity: tier.maxQuantity < 999999 ? tier.maxQuantity : null,
          availableQuantity: tier.availableQuantity,
          description: tier.description,
          benefits: tier.benefits
        }))
      } : {
        enabled: false
      },
      // Filter out RSVP events from regular events list
      events: venue.events.filter(event => event.category !== 'VENUE_RSVP'),
      // Remove rsvpEvents array from response (only used internally)
      rsvpEvents: undefined
    };

    res.json({
      success: true,
      data: { venue: venueWithRSVP }
    });
  } catch (error) {
    console.error('Error fetching venue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch venue',
      error: error.message
    });
  }
});

// Get events for a specific venue
router.get('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Check if venue exists
    const venue = await prisma.venue.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true }
    });

    if (!venue || !venue.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Venue not found'
      });
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where: {
          venueId: id,
          isActive: true
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
              registrations: true
            }
          }
        }
      }),
      prisma.event.count({
        where: {
          venueId: id,
          isActive: true
        }
      })
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: {
        venue: {
          id: venue.id,
          name: venue.name
        },
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
    console.error('Error fetching venue events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch venue events',
      error: error.message
    });
  }
});

// Search venues
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

    const venues = await prisma.venue.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { location: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { amenities: { has: query } }
        ]
      },
      take: limitNum,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        location: true,
        capacity: true,
        amenities: true,
        _count: {
          select: {
            events: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: { venues }
    });
  } catch (error) {
    console.error('Error searching venues:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search venues',
      error: error.message
    });
  }
});

// Create new venue (Protected - Admin/Organizer only)
router.post('/', authMiddleware, requireRole(['ADMIN', 'ORGANIZER']), async (req, res) => {
  try {
    const {
      name,
      description,
      imageUrl,
      location,
      address,
      latitude,
      longitude,
      phone,
      website,
      email,
      capacity,
      amenities,
      operatingHours,
      isActive = true,
      // RSVP Configuration
      enableRSVP,
      rsvpTiers
    } = req.body;

    // Validate required fields
    if (!name || !location) {
      return res.status(400).json({
        success: false,
        message: 'Name and location are required'
      });
    }

    // Check if venue with same name and location already exists
    const existingVenue = await prisma.venue.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        location: { equals: location, mode: 'insensitive' }
      }
    });

    if (existingVenue) {
      return res.status(409).json({
        success: false,
        message: 'A venue with this name and location already exists'
      });
    }

    // Create venue first
    const venue = await prisma.venue.create({
      data: {
        name,
        description,
        imageUrl,
        location,
        address,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        phone,
        website,
        email,
        capacity: capacity ? parseInt(capacity) : null,
        amenities: amenities || [],
        operatingHours: operatingHours || {},
        isActive
      }
    });

    // Create RSVP Event and AccessTiers if enabled
    if (enableRSVP && rsvpTiers && rsvpTiers.length > 0) {
      // Create a special RSVP event for this venue
      const rsvpEvent = await prisma.event.create({
        data: {
          title: `${venue.name} - RSVP Access`,
          description: `RSVP reservations for ${venue.name}`,
          imageUrl: venue.imageUrl || '',
          startDate: new Date(), // Always available
          endDate: new Date('2099-12-31'), // Far future
          location: venue.location,
          address: venue.address || '',
          latitude: venue.latitude,
          longitude: venue.longitude,
          capacity: null, // Will be managed per tier
          category: 'VENUE_RSVP',
          isActive: true,
          isPublic: true,
          venueId: venue.id,
          organizerId: req.user.id,
        }
      });

      // Create AccessTiers for each RSVP tier
      for (let i = 0; i < rsvpTiers.length; i++) {
        const tier = rsvpTiers[i];
        await prisma.accessTier.create({
          data: {
            name: tier.name || `RSVP Tier ${i + 1}`,
            description: tier.description || 'Venue reservation access',
            price: tier.price || 0,
            currency: tier.currency || 'IDR',
            maxQuantity: tier.maxQuantity || 999999,
            availableQuantity: tier.maxQuantity || 999999,
            benefits: tier.benefits || [`Access to ${venue.name}`],
            isActive: true,
            sortOrder: i,
            eventId: rsvpEvent.id
          }
        });
      }
    }

    console.log(`✅ Venue created: ${venue.name} in ${venue.location}`);

    res.status(201).json({
      success: true,
      data: { venue },
      message: 'Venue created successfully'
    });
  } catch (error) {
    console.error('Error creating venue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create venue',
      error: error.message
    });
  }
});

// Update venue (Protected - Admin/Organizer only)
router.put('/:id', authMiddleware, requireRole(['ADMIN', 'ORGANIZER']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      imageUrl,
      location,
      address,
      latitude,
      longitude,
      phone,
      website,
      email,
      capacity,
      amenities,
      operatingHours,
      isActive,
      // RSVP Configuration
      enableRSVP,
      rsvpTiers
    } = req.body;

    // Check if venue exists
    const existingVenue = await prisma.venue.findUnique({
      where: { id }
    });

    if (!existingVenue) {
      return res.status(404).json({
        success: false,
        message: 'Venue not found'
      });
    }

    // Check for duplicate name/location (excluding current venue)
    if (name && location) {
      const duplicateVenue = await prisma.venue.findFirst({
        where: {
          AND: [
            { id: { not: id } },
            { name: { equals: name, mode: 'insensitive' } },
            { location: { equals: location, mode: 'insensitive' } }
          ]
        }
      });

      if (duplicateVenue) {
        return res.status(409).json({
          success: false,
          message: 'A venue with this name and location already exists'
        });
      }
    }

    // Handle RSVP configuration changes
    if (enableRSVP !== undefined) {
      // Check if venue already has RSVP event
      const existingRSVPEvent = await prisma.event.findFirst({
        where: {
          venueId: id,
          category: 'VENUE_RSVP'
        },
        include: {
          accessTiers: true
        }
      });

      if (enableRSVP && rsvpTiers && rsvpTiers.length > 0) {
        if (existingRSVPEvent) {
          // Update existing RSVP event
          await prisma.event.update({
            where: { id: existingRSVPEvent.id },
            data: {
              title: `${name || existingVenue.name} - RSVP Access`,
              description: `RSVP reservations for ${name || existingVenue.name}`,
              isActive: true
            }
          });

          // Delete existing access tiers
          await prisma.accessTier.deleteMany({
            where: { eventId: existingRSVPEvent.id }
          });

          // Create new access tiers
          for (let i = 0; i < rsvpTiers.length; i++) {
            const tier = rsvpTiers[i];
            await prisma.accessTier.create({
              data: {
                name: tier.name || `RSVP Tier ${i + 1}`,
                description: tier.description || 'Venue reservation access',
                price: tier.price || 0,
                currency: tier.currency || 'IDR',
                maxQuantity: tier.maxQuantity || 999999,
                availableQuantity: tier.maxQuantity || 999999,
                benefits: tier.benefits || [`Access to ${name || existingVenue.name}`],
                isActive: true,
                sortOrder: i,
                eventId: existingRSVPEvent.id
              }
            });
          }
        } else {
          // Create new RSVP event and access tiers
          const rsvpEvent = await prisma.event.create({
            data: {
              title: `${name || existingVenue.name} - RSVP Access`,
              description: `RSVP reservations for ${name || existingVenue.name}`,
              imageUrl: imageUrl || existingVenue.imageUrl || '',
              startDate: new Date(),
              endDate: new Date('2099-12-31'),
              location: location || existingVenue.location,
              address: address || existingVenue.address || '',
              latitude: latitude !== undefined ? (latitude ? parseFloat(latitude) : null) : existingVenue.latitude,
              longitude: longitude !== undefined ? (longitude ? parseFloat(longitude) : null) : existingVenue.longitude,
              capacity: null,
              category: 'VENUE_RSVP',
              isActive: true,
              isPublic: true,
              venueId: id,
              organizerId: req.user.id
            }
          });

          // Create access tiers
          for (let i = 0; i < rsvpTiers.length; i++) {
            const tier = rsvpTiers[i];
            await prisma.accessTier.create({
              data: {
                name: tier.name || `RSVP Tier ${i + 1}`,
                description: tier.description || 'Venue reservation access',
                price: tier.price || 0,
                currency: tier.currency || 'IDR',
                maxQuantity: tier.maxQuantity || 999999,
                availableQuantity: tier.maxQuantity || 999999,
                benefits: tier.benefits || [`Access to ${name || existingVenue.name}`],
                isActive: true,
                sortOrder: i,
                eventId: rsvpEvent.id
              }
            });
          }
        }
      } else {
        // Disable RSVP - deactivate the RSVP event
        if (existingRSVPEvent) {
          await prisma.event.update({
            where: { id: existingRSVPEvent.id },
            data: { isActive: false }
          });

          // Deactivate access tiers
          await prisma.accessTier.updateMany({
            where: { eventId: existingRSVPEvent.id },
            data: { isActive: false }
          });
        }
      }
    }

    const venue = await prisma.venue.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(location && { location }),
        ...(address !== undefined && { address }),
        ...(latitude !== undefined && { latitude: latitude ? parseFloat(latitude) : null }),
        ...(longitude !== undefined && { longitude: longitude ? parseFloat(longitude) : null }),
        ...(phone !== undefined && { phone }),
        ...(website !== undefined && { website }),
        ...(email !== undefined && { email }),
        ...(capacity !== undefined && { capacity: capacity ? parseInt(capacity) : null }),
        ...(amenities !== undefined && { amenities }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(isActive !== undefined && { isActive })
      }
    });

    console.log(`✅ Venue updated: ${venue.name}`);

    res.json({
      success: true,
      data: { venue },
      message: 'Venue updated successfully'
    });
  } catch (error) {
    console.error('Error updating venue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update venue',
      error: error.message
    });
  }
});

// Delete venue (Protected - Admin only)
router.delete('/:id', authMiddleware, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if venue exists
    const venue = await prisma.venue.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            events: true
          }
        }
      }
    });

    if (!venue) {
      return res.status(404).json({
        success: false,
        message: 'Venue not found'
      });
    }

    // Check if venue has associated events
    if (venue._count.events > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete venue. It has ${venue._count.events} associated events. Please remove or transfer events first.`
      });
    }

    await prisma.venue.delete({
      where: { id }
    });

    console.log(`🗑️ Venue deleted: ${venue.name}`);

    res.json({
      success: true,
      message: 'Venue deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting venue:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete venue',
      error: error.message
    });
  }
});

// Create sample venues for testing (Dev only)
// Create venue RSVP for user
router.post('/:id/rsvp', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { requestedDate, partySize, specialRequests } = req.body;

    // Check if venue exists and has RSVP enabled
    const venue = await prisma.venue.findUnique({
      where: { id },
      include: {
        events: {
          where: {
            category: 'VENUE_RSVP',
            isActive: true
          },
          include: {
            accessTiers: {
              where: { isActive: true }
            }
          }
        }
      }
    });

    if (!venue || !venue.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Venue not found'
      });
    }

    const rsvpEvent = venue.events[0];
    const rsvpTier = rsvpEvent?.accessTiers[0];
    
    if (!rsvpEvent || !rsvpTier) {
      return res.status(400).json({
        success: false,
        message: 'RSVP is not available for this venue'
      });
    }

    // Check if user already has RSVP for this venue
    const existingRSVP = await prisma.access.findFirst({
      where: {
        userId: req.user.id,
        event: {
          venueId: id,
          category: 'VENUE_RSVP'
        }
      }
    });

    if (existingRSVP) {
      return res.status(409).json({
        success: false,
        message: 'You already have an RSVP for this venue'
      });
    }

    // Create user RSVP
    const userRSVP = await prisma.access.create({
      data: {
        type: 'RSVP',
        ticketCode: `RSVP-${id}-${req.user.id}-${Date.now()}`,
        status: 'CONFIRMED',
        currency: rsvpTier.currency,
        price: rsvpTier.price,
        venueDetails: `${rsvpTier.description} | Party size: ${partySize || 1}${specialRequests ? ` | ${specialRequests}` : ''}`,
        validUntil: new Date('2099-12-31'),
        userId: req.user.id,
        eventId: rsvpEvent.id,
        accessTierId: rsvpTier.id
      }
    });

    console.log(`✅ RSVP created: User ${req.user.id} for venue ${venue.name}`);

    res.status(201).json({
      success: true,
      data: { rsvp: userRSVP },
      message: 'RSVP reservation successful'
    });
  } catch (error) {
    console.error('Error creating venue RSVP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create RSVP',
      error: error.message
    });
  }
});

router.post('/dev/create-samples', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only available in development'
      });
    }

    const sampleVenues = [
      {
        name: 'Jakarta International Expo',
        description: 'Premier event venue for concerts and exhibitions in Jakarta',
        imageUrl: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800',
        location: 'Jakarta',
        address: 'Arena PRJ Kemayoran, Jl. Benyamin Sueb, Jakarta Pusat',
        latitude: -6.1478,
        longitude: 106.8469,
        phone: '+62 21 2928 1234',
        website: 'https://jiexpo.com',
        email: 'info@jiexpo.com',
        capacity: 50000,
        amenities: ['Parking', 'Wi-Fi', 'Sound System', 'Lighting', 'Air Conditioning', 'Security', 'VIP Area'],
        operatingHours: {
          'Monday': '08:00-22:00',
          'Tuesday': '08:00-22:00',
          'Wednesday': '08:00-22:00',
          'Thursday': '08:00-22:00',
          'Friday': '08:00-24:00',
          'Saturday': '08:00-24:00',
          'Sunday': '08:00-22:00'
        },
        isActive: true
      },
      {
        name: 'Balai Sarbini',
        description: 'Historic cultural center perfect for music events and performances',
        imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800',
        location: 'Jakarta',
        address: 'Jl. Sisingamangaraja No.15, Kebayoran Baru, Jakarta Selatan',
        latitude: -6.2443,
        longitude: 106.7963,
        phone: '+62 21 725 7201',
        website: 'https://balaisarbini.com',
        email: 'info@balaisarbini.com',
        capacity: 1200,
        amenities: ['Parking', 'Wi-Fi', 'Sound System', 'Lighting', 'Air Conditioning', 'Stage'],
        operatingHours: {
          'Monday': '09:00-21:00',
          'Tuesday': '09:00-21:00',
          'Wednesday': '09:00-21:00',
          'Thursday': '09:00-21:00',
          'Friday': '09:00-23:00',
          'Saturday': '09:00-23:00',
          'Sunday': '09:00-21:00'
        },
        isActive: true
      },
      {
        name: 'The Pallas',
        description: 'Modern nightclub and event space in SCBD Jakarta',
        imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800',
        location: 'Jakarta',
        address: 'SCBD Lot 11A, Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan',
        latitude: -6.2257,
        longitude: 106.8096,
        phone: '+62 21 2993 4567',
        website: 'https://thepallas.com',
        email: 'events@thepallas.com',
        capacity: 800,
        amenities: ['Parking', 'Wi-Fi', 'Sound System', 'Lighting', 'Bar', 'VIP Area', 'DJ Booth', 'Dance Floor'],
        operatingHours: {
          'Monday': 'Closed',
          'Tuesday': 'Closed',
          'Wednesday': 'Closed',
          'Thursday': '20:00-03:00',
          'Friday': '20:00-04:00',
          'Saturday': '20:00-04:00',
          'Sunday': 'Closed'
        },
        isActive: true
      },
      {
        name: 'Saparua Backyard',
        description: 'Cozy outdoor venue perfect for indie music events',
        imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800',
        location: 'Bandung',
        address: 'Jl. Saparua No.9, Bandung Wetan, Bandung',
        latitude: -6.9034,
        longitude: 107.6181,
        phone: '+62 22 423 5678',
        email: 'hello@saparuabackyard.com',
        capacity: 300,
        amenities: ['Outdoor Space', 'Sound System', 'Bar', 'Wi-Fi', 'Stage'],
        operatingHours: {
          'Monday': 'Closed',
          'Tuesday': 'Closed',
          'Wednesday': '17:00-23:00',
          'Thursday': '17:00-23:00',
          'Friday': '17:00-01:00',
          'Saturday': '17:00-01:00',
          'Sunday': '17:00-23:00'
        },
        isActive: true
      },
      {
        name: 'Bali International Convention Centre',
        description: 'Premier convention center and event venue in Nusa Dua, Bali',
        imageUrl: 'https://images.unsplash.com/photo-1582719471137-c3967ffb1c42?w=800',
        location: 'Bali',
        address: 'Jl. Raya Nusa Dua Selatan, Benoa, Nusa Dua, Bali',
        latitude: -8.8001,
        longitude: 115.2283,
        phone: '+62 361 703 1000',
        website: 'https://bicc.co.id',
        email: 'info@bicc.co.id',
        capacity: 2500,
        amenities: ['Parking', 'Wi-Fi', 'Sound System', 'Lighting', 'Air Conditioning', 'Security', 'VIP Area', 'Kitchen'],
        operatingHours: {
          'Monday': '08:00-22:00',
          'Tuesday': '08:00-22:00',
          'Wednesday': '08:00-22:00',
          'Thursday': '08:00-22:00',
          'Friday': '08:00-22:00',
          'Saturday': '08:00-22:00',
          'Sunday': '08:00-22:00'
        },
        isActive: true
      }
    ];

    const createdVenues = [];
    
    for (const venueData of sampleVenues) {
      // Check if venue already exists
      const existing = await prisma.venue.findFirst({
        where: {
          name: { equals: venueData.name, mode: 'insensitive' },
          location: { equals: venueData.location, mode: 'insensitive' }
        }
      });

      if (!existing) {
        const venue = await prisma.venue.create({
          data: venueData
        });
        createdVenues.push(venue);
        console.log(`✅ Sample venue created: ${venue.name}`);
      } else {
        console.log(`⏭️ Sample venue already exists: ${venueData.name}`);
      }
    }

    res.json({
      success: true,
      data: { 
        created: createdVenues,
        message: `Created ${createdVenues.length} new sample venues` 
      }
    });
  } catch (error) {
    console.error('Error creating sample venues:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sample venues',
      error: error.message
    });
  }
});

module.exports = router;