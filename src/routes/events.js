const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authMiddleware, optionalAuth, requireRole } = require('../middleware/auth');
const { getNotificationService } = require('../services/core');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized validation schemas
const { eventCreateSchema, eventUpdateSchema, paginationSchema, eventSearchSchema } = require('../lib/validation-schemas');

// ✅ ENTERPRISE: Use centralized user selectors
const { organizerSelect } = require('../lib/user-selectors');

// ✅ ENTERPRISE: Use centralized authorization utilities
const { requireEventOwnershipOrAdmin, requireExists, requireActive } = require('../lib/auth-utils');

// ✅ PRODUCTION: Enterprise caching for 100k+ users
const { 
  eventCaching, 
  accessTierCaching, 
  cacheInvalidation 
} = require('../middleware/enterprise-caching');

// ✅ REMOVED: Old Midtrans imports - replaced by centralized PaymentService
// const { getSnapClient, createTransactionParams, createItemDetails, isMidtransConfigured } = require('../lib/midtrans-config');

// ✅ ENTERPRISE: Use standardized response formatters
const { successResponse, errorResponse, eventsResponse, eventResponse } = require('../lib/response-formatters');

// ✅ SECURITY: Professional order ID generation
const { generateGuestlistOrderId, validateOrderId } = require('../utils/order-id-generator');

// ✅ DECIMAL: Coordinate conversion utilities
const { convertCoordinatesArray } = require('../utils/decimal-helpers');

const router = express.Router();

// ✅ REMOVED: Old payment logic replaced by centralized PaymentService
// All payment resume logic, expiry handling, and Midtrans integration
// is now handled by the centralized PaymentService in /services/core/

// ✅ REMOVED: Validation schemas moved to centralized lib/validation-schemas.js
// All validation schemas are now imported from '../lib/validation-schemas'

// @route   GET /api/events
// @desc    Get all events with pagination and filters
// @access  Public
router.get('/', 
  optionalAuth, 
  eventCaching.list, // ✅ CACHE: Cache event lists with smart key generation
  asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    category,
    city,
    search,
    sortBy = 'startDate',
    sortOrder = 'desc', // Changed default to desc untuk CMS agar yang terbaru di atas
    upcoming = 'true'
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Build where clause
  const where = {
    isActive: true,
    ...(upcoming === 'true' && { startDate: { gte: new Date() } }),
    ...(category && { category: { contains: category, mode: 'insensitive' } }),
    ...(city && { location: { contains: city, mode: 'insensitive' } }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ]
    }),
  };

  // Build orderBy clause - untuk CMS, jika tidak ada sortBy, sort by createdAt desc
  let orderBy;
  if (upcoming === 'false' && !req.query.sortBy) {
    // Untuk CMS, sort berdasarkan tanggal pembuatan terbaru dulu
    orderBy = { createdAt: 'desc' };
  } else {
    orderBy = { [sortBy]: sortOrder };
  }

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        location: true,
        address: true,
        latitude: true,
        longitude: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        price: true,
        currency: true,
        capacity: true,
        genres: true,
        category: true,
        hasGuestlist: true,
        isPublic: true,
        status: true,
        isActive: true,
        taxRate: true,
        taxType: true,
        taxName: true,
        guestlistCapacity: true,
        guestlistRequiresApproval: true,
        createdAt: true,
        updatedAt: true,
        organizerId: true,
        venueId: true,
        organizer: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        },
        _count: {
          select: {
            registrations: true,
            guestLists: true,
          }
        }
      }
    }),
    prisma.event.count({ where })
  ]);

  // ✅ DECIMAL: Convert Decimal coordinates to numbers for API response
  const eventsWithNumbers = convertCoordinatesArray(events);

  // ✅ DEBUG: Log coordinate data for debugging
  console.log('📍 Events API: Returning events with coordinates:');
  eventsWithNumbers.forEach((event, index) => {
    if (index < 3) { // Log first 3 events only
      console.log(`📍 Event ${event.title}: lat=${event.latitude}, lng=${event.longitude} (type: ${typeof event.latitude})`);
    }
  });

  res.json({
    success: true,
    data: {
      events: eventsWithNumbers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   GET /api/events/:id/featured-tracks
// @desc    Get up to 3 featured tracks for an event (Apple Music preferred)
// @access  Public
router.get('/:id/featured-tracks', optionalAuth, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;

  const eventExists = await prisma.event.findUnique({ where: { id: eventId, isActive: true }, select: { id: true } });
  if (!eventExists) throw new AppError('Event not found', 404);

  const tracks = await prisma.eventFeaturedTrack.findMany({
    where: { eventId, isActive: true },
    orderBy: { position: 'asc' },
    take: 3,
    select: {
      id: true,
      title: true,
      artistName: true,
      coverUrl: true,
      previewUrl: true,
      externalUrl: true,
      appleTrackId: true,
      durationMs: true,
      position: true,
      provider: true,
    }
  });

  res.json({ success: true, data: { featuredTracks: tracks } });
}));

// @route   GET /api/events/:id
// @desc    Get single event by ID
// @access  Public
router.get('/:id', 
  optionalAuth, 
  eventCaching.single, // ✅ CACHE: Cache individual events (high frequency access)
  asyncHandler(async (req, res) => {
  const { id } = req.params;

  const event = await prisma.event.findUnique({
    where: { id, isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      imageUrl: true,
      location: true,
      address: true,
      latitude: true,
      longitude: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      price: true,
      currency: true,
      capacity: true,
      genres: true,
      category: true,
      hasGuestlist: true,
      isPublic: true,
      status: true,
      isActive: true,
      taxRate: true,
      taxType: true,
      taxName: true,
      guestlistCapacity: true,
      guestlistRequiresApproval: true,
      createdAt: true,
      updatedAt: true,
      organizerId: true,
      venueId: true,
      organizer: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          bio: true,
        }
      },
      venue: {
        select: {
          id: true,
          name: true,
          description: true,
          imageUrl: true,
          location: true,
          address: true,
          latitude: true,
          longitude: true,
          phone: true,
          website: true,
          amenities: true,
          capacity: true,
        }
      },
      artists: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,  // Artist name (for both manual and existing)
          stageName: true,  // Stage name for display
          imageUrl: true,  // Profile image URL (for manual artists)
          isManual: true,  // True if manually entered
          sortOrder: true,  // Order in lineup
          artist: {  // Optional for manual artists
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              genres: true,
              country: true,
              city: true,
              isVerified: true,
              followersCount: true,
            }
          }
        }
      },
      // Note: Using 'artists' not 'eventArtists' - this is the relation name in Prisma schema
      // The artists relation maps to EventArtist model which contains lineup info
      /* Commenting out eventArtists as it's already covered by artists relation above
      eventArtists: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          isManual: true,
          sortOrder: true,
          artist: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
            }
          }
        }
      },
      */
      featuredTracks: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          title: true,
          artistName: true,
          coverUrl: true,
          previewUrl: true,
          externalUrl: true,
          appleTrackId: true,
          durationMs: true,
          position: true,
          provider: true,
        }
      },
      accessTiers: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          maxQuantity: true,
          soldQuantity: true,
          availableQuantity: true,
          benefits: true,
          saleStartDate: true,
          saleEndDate: true,
          sortOrder: true,
        }
      },
      _count: {
        select: {
          registrations: true,
          guestLists: true,
        }
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if current user is registered or on guest list
  let userStatus = null;
  if (req.user) {
    const [registration, guestList] = await Promise.all([
      prisma.eventRegistration.findUnique({
        where: {
          userId_eventId: {
            userId: req.user.id,
            eventId: id
          }
        }
      }),
      prisma.guestList.findUnique({
        where: {
          userId_eventId: {
            userId: req.user.id,
            eventId: id
          }
        }
      })
    ]);

    userStatus = {
      isRegistered: !!registration,
      registrationStatus: registration?.status || null,
      isOnGuestList: !!guestList,
      guestListStatus: guestList?.status || null,
    };
  }

  // Debug log to check accessTiers
  console.log('🔍 DEBUG: Event accessTiers before conversion:', {
    eventId: event.id,
    accessTiersCount: event.accessTiers?.length,
    accessTiers: event.accessTiers
  });

  // ✅ DECIMAL: Convert coordinates to numbers for API response (same as venues)
  const eventWithNumbers = convertCoordinatesArray([event])[0];

  // Debug log to check accessTiers after conversion
  console.log('🔍 DEBUG: Event accessTiers after conversion:', {
    eventId: eventWithNumbers.id,
    accessTiersCount: eventWithNumbers.accessTiers?.length,
    accessTiers: eventWithNumbers.accessTiers
  });

  res.json({
    success: true,
    data: {
      event: eventWithNumbers,
      userStatus
    }
  });
}));

// @route   POST /api/events
// @desc    Create new event
// @access  Private (Organizer/Admin)
router.post('/', authMiddleware, requireRole(['ORGANIZER', 'ADMIN']), asyncHandler(async (req, res) => {
  const { error, value } = eventCreateSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // Extract ticketTiers, guestlistAutoApprove, lineup, and featuredTracks from validated data
  const { ticketTiers, guestlistAutoApprove, lineup, featuredTracks, ...eventData } = value;
  
  // Convert guestlistAutoApprove to guestlistRequiresApproval (opposite logic)
  if (guestlistAutoApprove !== undefined) {
    eventData.guestlistRequiresApproval = !guestlistAutoApprove;
  }

  // Create event first
  const event = await prisma.event.create({
    data: {
      ...eventData,
      organizerId: req.user.id,
    },
    include: {
      organizer: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      }
    }
  });

  // Create access tiers if ticketTiers provided
  if (ticketTiers && ticketTiers.length > 0) {
    const accessTiersData = ticketTiers.map((tier, index) => ({
      eventId: event.id,
      name: tier.name,
      description: tier.description || '',
      price: parseInt(tier.price, 10),
      maxQuantity: parseInt(tier.quantity, 10),
      availableQuantity: parseInt(tier.quantity, 10), // Initially same as maxQuantity
      sortOrder: index,
      isActive: true,
    }));

    await prisma.accessTier.createMany({
      data: accessTiersData,
    });
  }

  // Create lineup if provided
  if (lineup && lineup.length > 0) {
    const lineupData = lineup.map((artist, index) => {
      const data = {
        eventId: event.id,
        name: artist.name,
        stageName: artist.stageName || null,
        imageUrl: artist.imageUrl || null,
        isManual: artist.isManual || false,
        sortOrder: index,
      };
      
      // Only include artistId if it exists (for existing artists)
      if (artist.artistId) {
        data.artistId = artist.artistId;
      }
      
      return data;
    });

    await prisma.eventArtist.createMany({
      data: lineupData,
    });
  }

  // Create featured tracks if provided
  if (featuredTracks && featuredTracks.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < featuredTracks.length; i += 1) {
        const track = featuredTracks[i];
        await tx.eventFeaturedTrack.create({
          data: {
            eventId: event.id,
            title: track.title,
            artistName: track.artistName,
            coverUrl: track.coverUrl || null,
            previewUrl: track.previewUrl || null,
            externalUrl: track.externalUrl || null,
            appleTrackId: track.appleTrackId || null,
            durationMs: track.durationMs || null,
            position: i + 1,
          }
        });
      }
    });
  }

  // Fetch event with access tiers, lineup, and featured tracks
  const eventWithTiers = await prisma.event.findUnique({
    where: { id: event.id },
    include: {
      organizer: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      accessTiers: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      artists: {
        orderBy: { sortOrder: 'asc' },
        include: {
          artist: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
            }
          }
        }
      },
      featuredTracks: {
        orderBy: { position: 'asc' },
      }
    }
  });

  // Invalidate caches so subsequent GET /events/:id returns fresh tiers
  try {
    await cacheInvalidation.invalidateEvent(event.id);
  } catch (e) {
    console.warn('Cache invalidation failed (non-blocking):', e?.message || e);
  }

  res.status(201).json({
    success: true,
    message: 'Event created successfully',
    data: { event: eventWithTiers }
  });
}));

// @route   PUT /api/events/:id
// @desc    Update event
// @access  Private (Event organizer/Admin)
router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { error, value } = eventUpdateSchema.validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  // ✅ ENTERPRISE: Use centralized authorization utilities
  const existingEvent = await prisma.event.findUnique({
    where: { id, isActive: true }
  });

  requireExists(existingEvent, 'Event');
  requireEventOwnershipOrAdmin(existingEvent, req.user, 'update your own events');

  // Extract ticketTiers, lineup, featuredTracks and other data
  const { ticketTiers, guestlistAutoApprove, lineup, featuredTracks, ...eventData } = value;
  
  // Convert guestlistAutoApprove to guestlistRequiresApproval (opposite logic)
  if (guestlistAutoApprove !== undefined) {
    eventData.guestlistRequiresApproval = !guestlistAutoApprove;
  }

  // Update event data
  const event = await prisma.event.update({
    where: { id },
    data: eventData,
    include: {
      organizer: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      }
    }
  });

  // Update access tiers if ticketTiers provided
  if (ticketTiers && ticketTiers.length > 0) {
    const incomingNames = ticketTiers.map((t) => t.name);

    await prisma.$transaction(async (tx) => {
      // 1) Deactivate tiers that are not present in payload
      await tx.accessTier.updateMany({
        where: {
          eventId: id,
          name: { notIn: incomingNames }
        },
        data: { isActive: false }
      });

      // 2) Upsert each incoming tier by composite unique (eventId, name)
      for (let index = 0; index < ticketTiers.length; index += 1) {
        const tier = ticketTiers[index];
        const price = parseInt(tier.price, 10);
        const maxQty = parseInt(tier.quantity, 10);

        // Read existing to preserve sold/reserved counts when updating availableQuantity
        const existing = await tx.accessTier.findUnique({
          where: { eventId_name: { eventId: id, name: tier.name } },
          select: { soldQuantity: true, reservedQuantity: true }
        });

        const preservedSold = existing?.soldQuantity ?? 0;
        const preservedReserved = existing?.reservedQuantity ?? 0;
        const recalculatedAvailable = Math.max(0, maxQty - preservedSold - preservedReserved);

        await tx.accessTier.upsert({
          where: { eventId_name: { eventId: id, name: tier.name } },
          create: {
            eventId: id,
            name: tier.name,
            description: tier.description || '',
            price,
            maxQuantity: maxQty,
            availableQuantity: Math.max(0, maxQty),
            sortOrder: index,
            isActive: true,
          },
          update: {
            description: tier.description || '',
            price,
            maxQuantity: maxQty,
            // Keep availability consistent with sold/reserved
            availableQuantity: recalculatedAvailable,
            sortOrder: index,
            isActive: true,
          }
        });
      }
    });
  }

  // Update lineup if provided
  if (lineup !== undefined) {
    // Delete existing lineup
    await prisma.eventArtist.deleteMany({
      where: { eventId: id }
    });

    // Create new lineup if provided
    if (lineup && lineup.length > 0) {
      const lineupData = lineup.map((artist, index) => {
        const data = {
          eventId: id,
          name: artist.name,
          stageName: artist.stageName || null,
          imageUrl: artist.imageUrl || null,
          isManual: artist.isManual || false,
          sortOrder: index,
        };
        
        // Only include artistId if it exists (for existing artists)
        if (artist.artistId) {
          data.artistId = artist.artistId;
        }
        
        return data;
      });

      await prisma.eventArtist.createMany({
        data: lineupData,
      });
    }
  }

  // Update featured tracks if provided
  if (featuredTracks !== undefined) {
    await prisma.$transaction(async (tx) => {
      await tx.eventFeaturedTrack.deleteMany({ where: { eventId: id } });
      if (featuredTracks && featuredTracks.length > 0) {
        for (let i = 0; i < featuredTracks.length; i += 1) {
          const track = featuredTracks[i];
          await tx.eventFeaturedTrack.create({
            data: {
              eventId: id,
              title: track.title,
              artistName: track.artistName,
              coverUrl: track.coverUrl || null,
              previewUrl: track.previewUrl || null,
              externalUrl: track.externalUrl || null,
              appleTrackId: track.appleTrackId || null,
              durationMs: track.durationMs || null,
              position: i + 1,
            }
          });
        }
      }
    });
  }

  // Fetch updated event with access tiers, lineup, and featured tracks
  const eventWithTiers = await prisma.event.findUnique({
    where: { id },
    include: {
      organizer: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
        }
      },
      accessTiers: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      artists: {
        orderBy: { sortOrder: 'asc' },
        include: {
          artist: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
            }
          }
        }
      },
      featuredTracks: {
        orderBy: { position: 'asc' },
      }
    }
  });

  try {
    await cacheInvalidation.invalidateEvent(id);
  } catch (e) {
    console.warn('Cache invalidation failed (non-blocking):', e?.message || e);
  }

  res.json({
    success: true,
    message: 'Event updated successfully',
    data: { event: eventWithTiers }
  });
}));

// @route   PUT /api/events/:id/featured-tracks
// @desc    Upsert featured tracks (max 3) for an event (Organizer/Admin)
// @access  Private
router.put('/:id/featured-tracks', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const { tracks } = req.body;

  // Validate event
  const event = await prisma.event.findUnique({ where: { id: eventId, isActive: true } });
  if (!event) throw new AppError('Event not found', 404);

  // Authorization: organizer or admin
  requireEventOwnershipOrAdmin(event, req.user, 'update featured tracks');

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new AppError('tracks must be a non-empty array', 400);
  }
  if (tracks.length > 3) {
    throw new AppError('Maximum 3 featured tracks are allowed per event', 400);
  }

  // Normalize and constrain inputs
  const normalized = tracks.map((t, idx) => ({
    title: String(t.title || '').trim(),
    artistName: String(t.artistName || '').trim(),
    coverUrl: t.coverUrl ? String(t.coverUrl) : null,
    previewUrl: t.previewUrl ? String(t.previewUrl) : null,
    externalUrl: t.externalUrl ? String(t.externalUrl) : null,
    appleTrackId: t.appleTrackId ? String(t.appleTrackId) : null,
    durationMs: Number.isFinite(t.durationMs) ? t.durationMs : null,
    position: Number.isFinite(t.position) ? Math.max(1, Math.min(3, t.position)) : idx + 1,
    provider: (t.provider ? String(t.provider) : 'APPLE_MUSIC').toUpperCase(),
  }));

  // Upsert sequentially within transaction to maintain unique(eventId, position)
  const result = await prisma.$transaction(async (tx) => {
    // Soft-disable existing to avoid duplicates, then insert new
    await tx.eventFeaturedTrack.updateMany({ where: { eventId }, data: { isActive: false } });

    const saved = [];
    for (const t of normalized) {
      const created = await tx.eventFeaturedTrack.create({
        data: {
          eventId,
          title: t.title,
          artistName: t.artistName,
          coverUrl: t.coverUrl,
          previewUrl: t.previewUrl,
          externalUrl: t.externalUrl,
          appleTrackId: t.appleTrackId,
          durationMs: t.durationMs,
          position: t.position,
          provider: t.provider,
          isActive: true,
        },
        select: {
          id: true, title: true, artistName: true, coverUrl: true, previewUrl: true, externalUrl: true, appleTrackId: true, durationMs: true, position: true, provider: true
        }
      });
      saved.push(created);
    }
    return saved.sort((a, b) => a.position - b.position);
  });

  res.json({ success: true, message: 'Featured tracks updated', data: { featuredTracks: result } });
}));

// @route   GET /api/events/:id/stats
// @desc    Get event statistics
// @access  Private (Event organizer/Admin)
router.get('/:id/stats', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const event = await prisma.event.findUnique({
    where: { id, isActive: true },
    include: {
      accessTiers: {
        where: { isActive: true }
      },
      _count: {
        select: {
          accessTickets: true,
          guestLists: true,
          posts: true,
        }
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if user is organizer or admin
  requireEventOwnershipOrAdmin(event, req.user, 'view statistics');

  // Get actual ticket sales data
  const ticketSales = await prisma.access.groupBy({
    by: ['accessTierId'],
    where: { eventId: id },
    _count: {
      id: true
    },
    _sum: {
      price: true
    }
  });

  // Get guestlist statistics
  const guestlistStats = await prisma.guestList.groupBy({
    by: ['status'],
    where: { eventId: id },
    _count: {
      id: true
    }
  });

  // Calculate total revenue from actual sales
  const totalRevenue = ticketSales.reduce((sum, sale) => 
    sum + (sale._sum.price || 0), 0
  );

  // Calculate total capacity from access tiers
  const totalCapacity = event.accessTiers.reduce((sum, tier) => 
    sum + tier.maxQuantity, 0
  ) || event.capacity || 0;

  // Get total sold from actual access tickets
  const totalSold = await prisma.access.count({
    where: { eventId: id }
  });

  // Calculate occupancy rate
  const occupancyRate = totalCapacity > 0 ? (totalSold / totalCapacity) * 100 : 0;

  // Get guestlist breakdown
  const guestlistBreakdown = guestlistStats.reduce((acc, stat) => {
    acc[stat.status] = stat._count.id;
    return acc;
  }, {});

  // Get recent sales for peak time calculation
  const recentSales = await prisma.access.findMany({
    where: { 
      eventId: id,
      createdAt: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      }
    },
    select: {
      createdAt: true
    }
  });

  // Calculate peak sales hour
  const salesByHour = {};
  recentSales.forEach(sale => {
    const hour = new Date(sale.createdAt).getHours();
    salesByHour[hour] = (salesByHour[hour] || 0) + 1;
  });
  
  let peakHour = 19; // Default to 7 PM
  let maxSales = 0;
  Object.entries(salesByHour).forEach(([hour, count]) => {
    if (count > maxSales) {
      maxSales = count;
      peakHour = parseInt(hour);
    }
  });

  const stats = {
    totalRevenue,
    totalCapacity,
    totalSold,
    occupancyRate: parseFloat(occupancyRate.toFixed(2)),
    totalAccessTickets: event._count.accessTickets,
    totalGuestlist: event._count.guestLists,
    guestlistApproved: guestlistBreakdown.APPROVED || 0,
    guestlistPending: guestlistBreakdown.PENDING || 0,
    guestlistRejected: guestlistBreakdown.REJECTED || 0,
    totalPosts: event._count.posts,
    averageTicketPrice: totalSold > 0 ? Math.round(totalRevenue / totalSold) : 0,
    conversionRate: 0, // Will be calculated when we have page view tracking
    peakSalesTime: `${peakHour}:00`,
    accessTiers: event.accessTiers.map(tier => ({
      id: tier.id,
      name: tier.name,
      price: tier.price,
      maxQuantity: tier.maxQuantity,
      soldQuantity: ticketSales.find(s => s.accessTierId === tier.id)?._count.id || 0,
      revenue: ticketSales.find(s => s.accessTierId === tier.id)?._sum.price || 0
    }))
  };

  res.json({
    success: true,
    data: stats
  });
}));

// @route   GET /api/events/:id/registrations
// @desc    Get event attendees (ticket holders)
// @access  Private (Event organizer/Admin)
router.get('/:id/registrations', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 50, status } = req.query;

  const event = await prisma.event.findUnique({
    where: { id, isActive: true }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if user is organizer or admin
  requireEventOwnershipOrAdmin(event, req.user, 'view registrations');

  // Get access tickets (actual ticket holders) 
  console.log('🔍 DEBUG: Fetching access tickets for event:', id);
  console.log('🔍 DEBUG: Request query params:', req.query);
  
  const whereClause = { eventId: id };
  if (status) {
    whereClause.status = status;
  }
  console.log('🔍 DEBUG: Where clause:', whereClause);

  // First check if there are any access tickets for this event
  const checkCount = await prisma.access.count({
    where: { eventId: id }
  });
  console.log('📊 DEBUG: Total access tickets for event:', checkCount);
  
  // Also check without eventId to see if there are any access records at all
  const totalAccessCount = await prisma.access.count();
  console.log('📊 DEBUG: Total access tickets in database:', totalAccessCount);

  const accessTickets = await prisma.access.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatar: true,
        }
      },
      accessTier: {
        select: {
          id: true,
          name: true,
          price: true,
        }
      },
      booking: {
        select: {
          paymentMethod: true,
          paymentId: true,
        }
      }
    },
    skip: (parseInt(page) - 1) * parseInt(limit),
    take: parseInt(limit),
    orderBy: { createdAt: 'desc' }
  });

  console.log('✅ DEBUG: Found access tickets:', accessTickets.length);
  if (accessTickets.length > 0) {
    console.log('✅ DEBUG: First access ticket sample:', JSON.stringify(accessTickets[0], null, 2));
  } else {
    console.log('⚠️ DEBUG: No access tickets found. Let me check what access tickets exist...');
    
    // Check if there are any access tickets at all  
    const allAccessTickets = await prisma.access.findMany({
      select: { 
        id: true, 
        eventId: true, 
        ticketCode: true,
        user: { select: { username: true, email: true } }
      },
      take: 5
    });
    console.log('📋 DEBUG: All access tickets in database:', allAccessTickets);
    
    // Check if the event exists
    const eventExists = await prisma.event.findUnique({
      where: { id },
      select: { id: true, title: true }
    });
    console.log('📋 DEBUG: Event exists?', eventExists);
  }

  // Format the data for frontend
  const formattedRegistrations = accessTickets.map(ticket => ({
    id: ticket.id,
    name: ticket.user.firstName && ticket.user.lastName 
      ? `${ticket.user.firstName} ${ticket.user.lastName}` 
      : ticket.user.username,
    username: ticket.user.username,
    email: ticket.user.email,
    phone: ticket.user.phone,
    avatar: ticket.user.avatar,
    ticketType: ticket.accessTier?.name || 'General',
    ticketPrice: ticket.price || 0,
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    isUsed: ticket.isUsed,
    usedAt: ticket.usedAt,
    createdAt: ticket.createdAt,
    paymentMethod: ticket.booking?.paymentMethod,
    paymentId: ticket.booking?.paymentId,
  }));

  // Get total count for pagination
  const totalCount = await prisma.access.count({
    where: whereClause
  });

  // Add no-cache headers for fresh data
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.json({
    success: true,
    data: formattedRegistrations,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalCount,
      totalPages: Math.ceil(totalCount / parseInt(limit))
    }
  });
}));

// @route   GET /api/events/:id/guestlist
// @desc    Get event guestlist
// @access  Private (Event organizer/Admin)
router.get('/:id/guestlist', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 50, status } = req.query;

  const event = await prisma.event.findUnique({
    where: { id, isActive: true }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check if user is organizer or admin
  requireEventOwnershipOrAdmin(event, req.user, 'view guestlist');

  const whereClause = { eventId: id };
  if (status) {
    whereClause.status = status;
  }

  const guestlist = await prisma.guestList.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatar: true,
        }
      }
    },
    skip: (parseInt(page) - 1) * parseInt(limit),
    take: parseInt(limit),
    orderBy: { createdAt: 'desc' }
  });

  // Format the data for frontend with proper status handling
  const formattedGuestlist = guestlist.map(guest => ({
    id: guest.id,
    name: guest.user.firstName && guest.user.lastName 
      ? `${guest.user.firstName} ${guest.user.lastName}` 
      : guest.user.username,
    username: guest.user.username,
    email: guest.user.email,
    phone: guest.user.phone,
    avatar: guest.user.avatar,
    status: guest.status, // PENDING, APPROVED, REJECTED
    isPaid: guest.isPaid,
    paidAt: guest.paidAt,
    paymentId: guest.paymentId,
    platformFee: guest.platformFee,
    createdAt: guest.createdAt,
    approvedAt: guest.approvedAt,
    rejectedAt: guest.rejectedAt,
    approvedBy: guest.approvedBy,
  }));

  // Get total count for pagination
  const totalCount = await prisma.guestList.count({
    where: whereClause
  });

  res.json({
    success: true,
    data: formattedGuestlist,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalCount,
      totalPages: Math.ceil(totalCount / parseInt(limit))
    }
  });
}));

// @route   GET /api/events/:id/debug-attendees
// @desc    Debug attendees data (Development only)
// @access  Private (Admin)
router.get('/:id/debug-attendees', authMiddleware, asyncHandler(async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('This endpoint is only available in development', 403);
  }

  const { id } = req.params;

  console.log('🔍 DEBUG ATTENDEES: Event ID:', id);

  // 1. Check if event exists
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true, isActive: true }
  });
  console.log('📋 DEBUG: Event found:', event);

  // 2. Count all access tickets for this event
  const accessCount = await prisma.access.count({
    where: { eventId: id }
  });
  console.log('📊 DEBUG: Access tickets count for this event:', accessCount);

  // 3. Get actual access tickets
  const accessTickets = await prisma.access.findMany({
    where: { eventId: id },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true
        }
      }
    },
    take: 10
  });
  console.log('✅ DEBUG: Access tickets found:', accessTickets.length);

  // 4. Get all access tickets in database (sample)
  const allAccess = await prisma.access.findMany({
    select: {
      id: true,
      eventId: true,
      ticketCode: true,
      user: { select: { username: true } }
    },
    take: 10
  });
  console.log('📋 DEBUG: All access tickets (sample):', allAccess);

  res.json({
    success: true,
    debug: {
      eventId: id,
      eventExists: !!event,
      eventTitle: event?.title,
      eventActive: event?.isActive,
      accessCountForEvent: accessCount,
      accessTicketsForEvent: accessTickets,
      allAccessTicketsSample: allAccess
    }
  });
}));

// @route   POST /api/events/:id/test-ticket
// @desc    Create test access ticket (Development only)
// @access  Private (Admin)
router.post('/:id/test-ticket', authMiddleware, asyncHandler(async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('This endpoint is only available in development', 403);
  }

  const { id } = req.params;

  // Check if event exists
  const event = await prisma.event.findUnique({
    where: { id, isActive: true },
    include: {
      accessTiers: {
        where: { isActive: true },
        take: 1
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  requireEventOwnershipOrAdmin(event, req.user, 'create test ticket');

  // Use first access tier or create dummy data
  const accessTier = event.accessTiers[0];
  const ticketCode = `TEST-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  const qrCode = `QR-${ticketCode}`;

  // Create test access ticket
  const testTicket = await prisma.access.create({
    data: {
      type: 'TICKET', // Using valid AccessType enum value
      ticketCode,
      qrCode,
      status: 'CONFIRMED',
      currency: event.currency || 'IDR',
      price: accessTier?.price || 100000,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Valid for 30 days
      userId: req.user.id, // Use current user
      eventId: id,
      accessTierId: accessTier?.id || null,
    },
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      },
      accessTier: true
    }
  });

  console.log('✅ Test ticket created:', testTicket);

  res.json({
    success: true,
    message: 'Test ticket created successfully',
    data: testTicket
  });
}));

// @route   POST /api/events/:id/test-guestlist
// @desc    Create test guestlist entry (Development only)
// @access  Private (Admin)
router.post('/:id/test-guestlist', authMiddleware, asyncHandler(async (req, res) => {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('This endpoint is only available in development', 403);
  }

  const { id } = req.params;
  const { status = 'PENDING' } = req.body;

  // Check if event exists
  const event = await prisma.event.findUnique({
    where: { id, isActive: true }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  requireEventOwnershipOrAdmin(event, req.user, 'create test guestlist');

  // Check if user already in guestlist
  const existing = await prisma.guestList.findUnique({
    where: {
      userId_eventId: {
        userId: req.user.id,
        eventId: id
      }
    }
  });

  if (existing) {
    // Update existing instead
    const updated = await prisma.guestList.update({
      where: { id: existing.id },
      data: {
        status: status,
        ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedBy: req.user.id } : {}),
        ...(status === 'REJECTED' ? { rejectedAt: new Date(), approvedBy: req.user.id } : {})
      },
      include: {
        user: {
          select: {
            username: true,
            email: true
          }
        }
      }
    });

    return res.json({
      success: true,
      message: 'Test guestlist entry updated',
      data: updated
    });
  }

  // Create new guestlist entry
  const testGuestlist = await prisma.guestList.create({
    data: {
      userId: req.user.id,
      eventId: id,
      status: status,
      isPaid: status === 'APPROVED',
      ...(status === 'APPROVED' ? { 
        approvedAt: new Date(), 
        approvedBy: req.user.id,
        paidAt: new Date(),
        platformFee: 25000
      } : {}),
      ...(status === 'REJECTED' ? { 
        rejectedAt: new Date(), 
        approvedBy: req.user.id 
      } : {})
    },
    include: {
      user: {
        select: {
          username: true,
          email: true
        }
      }
    }
  });

  console.log('✅ Test guestlist entry created:', testGuestlist);

  res.json({
    success: true,
    message: 'Test guestlist entry created successfully',
    data: testGuestlist
  });
}));

// @route   DELETE /api/events/:id
// @desc    Delete event (soft delete)
// @access  Private (Event organizer/Admin)
router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // ✅ ENTERPRISE: Use centralized authorization utilities
  const existingEvent = await prisma.event.findUnique({
    where: { id }
  });

  if (!existingEvent) {
    throw new AppError('Event not found', 404);
  }

  if (!existingEvent.isActive) {
    throw new AppError('Event has already been deleted', 410); // 410 Gone
  }
  requireEventOwnershipOrAdmin(existingEvent, req.user, 'delete your own events');

  await prisma.event.update({
    where: { id },
    data: { isActive: false }
  });

  // Invalidate cache after deletion
  await cacheInvalidation.invalidateEvent(id);

  res.json({
    success: true,
    message: 'Event deleted successfully'
  });
}));

// @route   POST /api/events/:id/register
// @desc    Register for an event
// @access  Private
router.post('/:id/register', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  // ✅ ENTERPRISE: Inline validation for simple schemas
  const { error, value } = Joi.object({
    guestlistOnly: Joi.boolean().default(false),
  }).validate(req.body);
  if (error) {
    throw new AppError(error.details[0].message, 400);
  }

  const { ticketType, quantity } = value;

  // Check if event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true },
    include: {
      _count: {
        select: {
          registrations: { where: { status: 'CONFIRMED' } }
        }
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  // Check capacity
  if (event.capacity && event._count.registrations >= event.capacity) {
    throw new AppError('Event is fully booked', 400);
  }

  // Check if user already registered
  const existingRegistration = await prisma.eventRegistration.findUnique({
    where: {
      userId_eventId: {
        userId: req.user.id,
        eventId
      }
    }
  });

  if (existingRegistration) {
    throw new AppError('You are already registered for this event', 400);
  }

  // Calculate total amount
  const totalAmount = event.price ? event.price * quantity : 0;

  // Create registration
  const registration = await prisma.eventRegistration.create({
    data: {
      userId: req.user.id,
      eventId,
      ticketType,
      quantity,
      totalAmount,
      status: 'CONFIRMED', // In real app, this might be PENDING until payment
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          startDate: true,
          location: true,
          price: true,
          imageUrl: true,
        }
      }
    }
  });

  // ✅ CENTRALIZED: Send event registration success notification
  try {
    const notificationService = getNotificationService();
    await notificationService.sendToUser(req.user.id, {
      title: '🎉 Registration Successful!',
      body: `You've successfully registered for "${registration.event.title}"`,
      type: 'EVENT_REGISTRATION_SUCCESS',
      image: registration.event.imageUrl,
      action: 'VIEW_EVENT',
      actionData: {
        eventId: registration.eventId,
        registrationId: registration.id,
        action: 'VIEW_EVENT'
      }
    });
  } catch (notifError) {
    console.error('❌ Error sending event registration push notification:', notifError);
  }

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: { registration }
  });
}));

// @route   POST /api/events/:id/guest-list
// @desc    Join event guest list
// @access  Private
router.post('/:id/guest-list', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;

  // Check if event exists and has guestlist enabled
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true },
    include: {
      _count: {
        select: {
          guestLists: { where: { status: { in: ['PENDING', 'APPROVED'] } } }
        }
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  if (!event.hasGuestlist) {
    throw new AppError('This event does not have a guest list', 400);
  }

  // Check if user already on guest list
  const existingEntry = await prisma.guestList.findUnique({
    where: {
      userId_eventId: {
        userId: req.user.id,
        eventId
      }
    }
  });

  if (existingEntry) {
    throw new AppError('You are already on the guest list for this event', 400);
  }

  // Check guestlist capacity
  if (event.guestlistCapacity) {
    const currentCount = event._count.guestLists;
    if (currentCount >= event.guestlistCapacity) {
      throw new AppError('Guest list is full', 400);
    }
  }

  // Determine initial status based on approval requirement
  const initialStatus = event.guestlistRequiresApproval ? 'PENDING' : 'APPROVED';
  const approvalData = event.guestlistRequiresApproval ? {} : {
    approvedAt: new Date(),
    approvedBy: 'AUTO_APPROVED'
  };

  // Create guest list entry
  const guestListEntry = await prisma.guestList.create({
    data: {
      userId: req.user.id,
      eventId,
      status: initialStatus,
      ...approvalData
    },
    include: {
      event: {
        select: {
          id: true,
          title: true,
          startDate: true,
          location: true,
          guestlistRequiresApproval: true,
        }
      }
    }
  });

  // Send appropriate notification
  try {
    const notificationTitle = initialStatus === 'APPROVED' 
      ? '🎉 Guestlist Approved!' 
      : '⏳ Guestlist Request Submitted';
    const notificationBody = initialStatus === 'APPROVED'
      ? `You're approved for "${event.title}" guestlist. Complete payment to secure your spot.`
      : `Your guestlist request for "${event.title}" is pending approval.`;

    // ✅ CENTRALIZED: Send guestlist notification
    const notificationService = getNotificationService();
    await notificationService.sendToUser(req.user.id, {
      title: notificationTitle,
      body: notificationBody,
      type: initialStatus === 'APPROVED' ? 'GUESTLIST_APPROVED' : 'GUESTLIST_PENDING',
      image: event.imageUrl,
      action: 'VIEW_EVENT',
      actionData: {
        type: 'GUESTLIST_STATUS_UPDATE',
        eventId: event.id,
        guestListId: guestListEntry.id,
        action: initialStatus === 'APPROVED' ? 'PROCEED_TO_PAYMENT' : 'VIEW_STATUS'
      }
    });
  } catch (notifError) {
    console.error('❌ Error sending guestlist notification:', notifError);
  }

  res.status(201).json({
    success: true,
    message: initialStatus === 'APPROVED' 
      ? 'Approved for guest list! Proceed to payment.' 
      : 'Successfully joined guest list. Awaiting approval.',
    data: { guestListEntry }
  });
}));

// @route   GET /api/events/:id/guest-list
// @desc    Get event guest list (organizer only)
// @access  Private
router.get('/:id/guest-list', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const { page = 1, limit = 20, status } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Check if user is event organizer or admin
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true }
  });

  // ✅ ENTERPRISE: Use centralized authorization utilities
  requireExists(event, 'Event');
  requireEventOwnershipOrAdmin(event, req.user, 'view guest list');

  const where = {
    eventId,
    ...(status && { status })
  };

  const [guestList, total] = await Promise.all([
    prisma.guestList.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            avatar: true,
          }
        }
      }
    }),
    prisma.guestList.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      guestList,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / take),
        totalItems: total,
        itemsPerPage: take,
      }
    }
  });
}));

// @route   PUT /api/events/:eventId/guest-list/:userId
// @desc    Update guest list status (organizer only)
// @access  Private
router.put('/:eventId/guest-list/:userId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId, userId } = req.params;
  const { status } = req.body;

  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    throw new AppError('Invalid status. Must be PENDING, APPROVED, or REJECTED', 400);
  }

  // Check if user is event organizer or admin
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true }
  });

  // ✅ ENTERPRISE: Use centralized authorization utilities
  requireExists(event, 'Event');
  requireEventOwnershipOrAdmin(event, req.user, 'update guest list');

  const updatedEntry = await prisma.guestList.update({
    where: {
      userId_eventId: {
        userId,
        eventId
      }
    },
    data: { status },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
        }
      }
    }
  });

  res.json({
    success: true,
    message: 'Guest list status updated successfully',
    data: { guestListEntry: updatedEntry }
  });
}));

// @route   POST /api/events/:id/guest-list/payment
// @desc    Process guestlist payment (platform fee only) - ✅ SECURE VERSION WITH QUOTA
// @access  Private
router.post('/:id/guest-list/payment', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const { paymentMethod } = req.body;

  // ✅ SECURE: Use guestlist quota service
  const GuestlistQuotaService = require('../services/core/GuestlistQuotaService');
  const quotaService = new GuestlistQuotaService();
  
  // ✅ CENTRALIZED: Use centralized payment service
  const { getPaymentService } = require('../services/core');
  const paymentService = getPaymentService();

  console.log(`🎫 SECURE GUESTLIST PAYMENT: Event ${eventId}, User ${req.user.id}`);

  let reservation; // ✅ FIX: Declare outside try block for catch access
  try {
    // ✅ STEP 1: Validate quota and reserve spot
    reservation = await quotaService.reserveGuestlistSpot(eventId, req.user.id);
    console.log(`🎫 SPOT RESERVED: ${reservation.id}`);

    // ✅ STEP 2: Basic validation (detailed validation in PaymentService)
    if (!paymentMethod) {
      await quotaService.releaseReservation(reservation.id, 'invalid_payment_method');
      throw new AppError('Payment method is required', 400);
    }

    // ✅ STEP 3: Check if user has approved guestlist entry
    const guestListEntry = await prisma.guestList.findUnique({
      where: {
        userId_eventId: {
          userId: req.user.id,
          eventId
        }
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            location: true,
            imageUrl: true,
          }
        }
      }
    });

    if (!guestListEntry) {
      await quotaService.releaseReservation(reservation.id, 'not_on_guestlist');
      throw new AppError('You are not on the guest list for this event', 404);
    }

    if (guestListEntry.status !== 'APPROVED') {
      await quotaService.releaseReservation(reservation.id, 'not_approved');
      throw new AppError('Your guestlist request is not approved yet', 400);
    }

    if (guestListEntry.isPaid) {
      await quotaService.releaseReservation(reservation.id, 'already_paid');
      throw new AppError('You have already paid for this guestlist', 400);
    }

    // ✅ STEP 4: Get platform fee
    const platformConfig = new (require('../services/platform-config-service'))();
    const platformFeeAmount = await platformConfig.getPlatformFeeAmount();

    if (!platformFeeAmount || platformFeeAmount <= 0) {
      await quotaService.releaseReservation(reservation.id, 'platform_fee_error');
      throw new AppError('Platform fee not configured', 500);
    }

    // ✅ STEP 5: Create atomic transaction for guestlist payment
    const result = await prisma.$transaction(async (tx) => {
      // Re-validate guestlist entry within transaction
      const entry = await tx.guestList.findUnique({
        where: {
          userId_eventId: {
            userId: req.user.id,
            eventId
          }
        }
      });

      if (!entry || entry.status !== 'APPROVED' || entry.isPaid) {
        throw new AppError('Guestlist entry validation failed', 400);
      }

      // Create payment request for centralized service
      const paymentRequest = {
        type: 'GUESTLIST',
        userId: req.user.id,
        eventId: eventId,
        amount: platformFeeAmount,
        currency: 'IDR',
        paymentMethod: paymentMethod,
        
        // User details
        userEmail: req.user.email,
        userFirstName: req.user.firstName,
        userLastName: req.user.lastName,
        userPhone: req.user.phone,
        username: req.user.username,
        
        // Item details
        itemName: 'Guestlist Access',
        category: 'Guestlist',
        itemDetails: [{
          id: 'guestlist_platform_fee',
          price: platformFeeAmount,
          quantity: 1,
          name: 'Guestlist Access',
          category: 'Guestlist'
        }]
      };

      // ✅ ATOMIC: Create payment within transaction
      const paymentResult = await paymentService.createPayment(paymentRequest);

      // ✅ ATOMIC: Update guestlist entry with payment ID within transaction
      const updatedEntry = await tx.guestList.update({
        where: { id: entry.id },
        data: {
          paymentId: paymentResult.data.paymentId,
          platformFee: platformFeeAmount,
          // Note: paymentInitiatedAt doesn't exist in schema, but paymentId and platformFee do
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startDate: true,
              location: true,
              imageUrl: true
            }
          }
        }
      });

      console.log(`✅ ATOMIC TRANSACTION COMPLETED: Payment ${paymentResult.data.paymentId} linked to guestlist entry`);

      return {
        entry: updatedEntry,
        payment: paymentResult.data,
        reservation: reservation
      };
      
    }, {
      isolationLevel: 'Serializable' // Highest isolation level for safety
    });

    // ✅ STEP 6: Confirm reservation (cleanup memory) - payment ID saved but isPaid still false
    await quotaService.confirmReservation(reservation.id, {
      paymentId: result.payment.paymentId,
      amount: platformFeeAmount
    });
    console.log(`✅ Payment created and reservation cleaned up. isPaid=false until webhook confirms payment`);

    // ✅ STEP 7: Send payment created notification (outside transaction)
    try {
      console.log(`📤 Sending guestlist payment created notification to user ${req.user.id}`);
      const { getNotificationService } = require('../services/core');
      const notificationService = getNotificationService();
      await notificationService.sendPaymentCreated(req.user.id, {
        eventName: result.entry.event?.title || 'Event',
        eventImage: result.entry.event?.imageUrl,
        paymentId: result.payment.paymentId,
        eventId: result.entry.eventId,
        totalAmount: platformFeeAmount,
        paymentType: 'GUESTLIST'
      });
      console.log(`📱 Guestlist payment created notification sent successfully`);
    } catch (notifError) {
      console.error('❌ Error sending guestlist payment created notification:', notifError);
      // Don't fail the request for notification errors
    }

    // ✅ STEP 8: Return secure response with quota information
    const quotaStats = await quotaService.getGuestlistStats(eventId);
    
    res.json({
      success: true,
      message: result.payment.isResumed ? 'Resuming existing guestlist payment' : 'Guestlist payment initiated securely',
      data: {
        guestListEntry: result.entry,
        payment: result.payment, // ✅ Use PaymentService response directly - already has midtransRedirectUrl
        quota: {
          spotsRemaining: quotaStats.availableSpots,
          totalSpots: quotaStats.totalSpots,
          yourReservation: reservation.id
        }
      }
    });

  } catch (error) {
    // ✅ CLEANUP: Release reservation on any error
    if (reservation) {
      await quotaService.releaseReservation(reservation.id, error.message);
    }

    // ✅ CUSTOMER COMMUNICATION: Send appropriate error notification
    try {
      const GuestlistNotificationService = require('../services/core/GuestlistNotificationService');
      const notificationService = new GuestlistNotificationService();
      
      if (error.message.includes('quota') || error.message.includes('available')) {
        await notificationService.sendQuotaFull(req.user.id, eventId);
      } else if (error.message.includes('payment')) {
        await notificationService.sendPaymentFailed(req.user.id, eventId, null, error.message);
      }
    } catch (notifError) {
      console.error('❌ Failed to send error notification:', {
        originalError: error.message,
        notificationErrorMessage: notifError.message,
        notificationErrorType: notifError.constructor.name,
        eventId,
        userId: req.user.id,
        stack: process.env.NODE_ENV === 'development' ? notifError.stack : undefined
      });
    }

    console.error(`❌ SECURE GUESTLIST PAYMENT FAILED:`, {
      eventId,
      userId: req.user.id,
      errorMessage: error.message,
      errorType: error.constructor.name,
      paymentMethod: paymentMethod,
      reservationId: reservation?.id,
      platformFeeAmount: platformFeeAmount || 0,
      correlationId: error.correlationId || 'unknown',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // ✅ CENTRALIZED: Error handling through PaymentService
    if (error.isOperational) {
      throw error; // Re-throw operational errors (handled by ErrorHandler)
    } else {
      throw new AppError('Failed to create guestlist payment. Please try again.', 500);
    }
  }
}));

// @route   GET /api/events/:id/guest-list/status
// @desc    Get user's guestlist status for an event
// @access  Private
router.get('/:id/guest-list/status', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;

  // Check if event exists and has guestlist
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true },
    select: {
      id: true,
      title: true,
      hasGuestlist: true,
      guestlistCapacity: true,
      guestlistRequiresApproval: true,
      _count: {
        select: {
          guestLists: { where: { status: { in: ['PENDING', 'APPROVED'] } } }
        }
      }
    }
  });

  if (!event) {
    throw new AppError('Event not found', 404);
  }

  if (!event.hasGuestlist) {
    return res.json({
      success: true,
      message: 'Event does not have guestlist',
      data: {
        hasGuestlist: false,
        guestListEntry: null
      }
    });
  }

  // Get user's guestlist entry if exists
  const guestListEntry = await prisma.guestList.findUnique({
    where: {
      userId_eventId: {
        userId: req.user.id,
        eventId
      }
    },
    select: {
      id: true,
      status: true,
      isPaid: true,
      paidAt: true,
      platformFee: true,
      createdAt: true,
      approvedAt: true,
      rejectedAt: true
    }
  });

  res.json({
    success: true,
    message: 'Guestlist status retrieved successfully',
    data: {
      hasGuestlist: true,
      guestListEntry: guestListEntry,
      eventInfo: {
        guestlistCapacity: event.guestlistCapacity,
        currentCount: event._count.guestLists,
        requiresApproval: event.guestlistRequiresApproval,
        isFull: event.guestlistCapacity ? event._count.guestLists >= event.guestlistCapacity : false
      }
    }
  });
}));

// @route   GET /api/events/:eventId/guest-list/payment-status/:paymentId
// @desc    Check guestlist payment status by paymentId
// @access  Private
router.get('/:eventId/guest-list/payment-status/:paymentId', authMiddleware, asyncHandler(async (req, res) => {
  const { eventId, paymentId } = req.params;
  const userId = req.user.id;

  // ✅ SECURITY FIX: Find guestlist entry by exact paymentId match only
  // With new short order ID format, we rely on exact paymentId match for security
  const guestListEntry = await prisma.guestList.findFirst({
    where: {
      paymentId: paymentId, // Exact match with stored paymentId
      userId: userId,       // Security: ensure user owns this guestlist entry
      eventId: eventId      // Security: ensure entry is for correct event
    },
    select: {
      id: true,
      status: true,
      isPaid: true,
      paidAt: true,
      paymentId: true,
      platformFee: true
    }
  });

  if (!guestListEntry) {
    throw new AppError('Guestlist payment not found', 404);
  }

  res.json({
    success: true,
    message: 'Guestlist payment status retrieved',
    data: {
      isPaid: guestListEntry.isPaid,
      status: guestListEntry.status,
      paidAt: guestListEntry.paidAt,
      paymentId: guestListEntry.paymentId,
      platformFee: guestListEntry.platformFee
    }
  });
}));

// DEPRECATED: Use /users/me/favorite-events instead - this endpoint was returning registered events, not favorites

// @route   GET /api/events/guest-list/payment-status/:paymentId
// @desc    DEPRECATED: Use universal payment endpoint at /api/payments/status/:paymentId
// @access  Private
// ❌ DEPRECATED: This endpoint is replaced by universal payment system
router.get('/guest-list/payment-status/:paymentId', authMiddleware, asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  
  console.log(`⚠️ DEPRECATED: /api/events/guest-list/payment-status/${paymentId} called - redirecting to universal endpoint`);
  
  // Redirect to universal payment endpoint
  res.status(301).json({
    success: false,
    message: 'This guestlist payment endpoint is deprecated. Please use the universal payment endpoint instead.',
    deprecated: true,
    redirect: `/api/payments/status/${paymentId}`,
    timestamp: new Date().toISOString()
  });
}));

module.exports = router; 
// @route   GET /api/events/my-events
// @desc    Get user's registered events (Flutter expects this)
// @access  Private
router.get('/my-events', authMiddleware, asyncHandler(async (req, res) => {
  const userEvents = await prisma.eventRegistration.findMany({
    where: { 
      userId: req.user.id,
      status: 'CONFIRMED'
    },
    include: {
      event: {
        include: {
          organizer: { select: organizerSelect },
          venue: true,
          artists: { include: { artist: true } }
        }
      }
    }
  });

  const events = userEvents.map(reg => reg.event);
  res.json(eventsResponse(events, null, 'User events retrieved successfully'));
}));
// DEPRECATED: Duplicate endpoint removed - use /users/me/favorite-events instead

// @route   POST /api/events/:id/favorite
// @desc    Add event to user's favorites
// @access  Private
router.post('/:id/favorite', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const userId = req.user.id;

  // Check if event exists and is active
  const event = await prisma.event.findUnique({
    where: { id: eventId, isActive: true },
    select: { id: true, title: true }
  });
  
  if (!event) throw new AppError('Event not found', 404);

  // Check if already favorited
  const existingFavorite = await prisma.userEventFavorite.findUnique({
    where: { userId_eventId: { userId, eventId } }
  });

  if (existingFavorite) {
    return res.json({
      success: true,
      message: 'Event already in favorites',
      data: { isFavorited: true }
    });
  }

  // Add to favorites
  await prisma.userEventFavorite.create({
    data: { userId, eventId }
  });

  res.json({
    success: true,
    message: 'Event added to favorites',
    data: { isFavorited: true }
  });
}));

// @route   DELETE /api/events/:id/favorite
// @desc    Remove event from user's favorites
// @access  Private
router.delete('/:id/favorite', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const userId = req.user.id;

  // Check if event exists
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true }
  });
  
  if (!event) throw new AppError('Event not found', 404);

  // Remove from favorites if exists
  await prisma.userEventFavorite.deleteMany({
    where: { userId, eventId }
  });

  res.json({
    success: true,
    message: 'Event removed from favorites',
    data: { isFavorited: false }
  });
}));

// @route   GET /api/events/:id/favorite-status
// @desc    Check if event is favorited by current user
// @access  Private
router.get('/:id/favorite-status', authMiddleware, asyncHandler(async (req, res) => {
  const { id: eventId } = req.params;
  const userId = req.user.id;

  const favorite = await prisma.userEventFavorite.findUnique({
    where: { userId_eventId: { userId, eventId } }
  });

  res.json({
    success: true,
    data: { isFavorited: !!favorite }
  });
}));

// MOVED TO USERS ROUTER: /api/users/me/favorite-events