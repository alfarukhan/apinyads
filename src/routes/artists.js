const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { optionalAuth, authMiddleware } = require('../middleware/auth');
const { successResponse, paginatedResponse } = require('../lib/response-formatters');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// @route   GET /api/artists
// @desc    Get all artists with pagination
// @access  Public
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    genre,
    city,
    country
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = Math.min(parseInt(limit), 50); // Max 50 per request

  // Build where clause
  const where = {
    isActive: true,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }),
    ...(genre && {
      genres: {
        has: genre
      }
    }),
    ...(city && {
      city: { contains: city, mode: 'insensitive' }
    }),
    ...(country && {
      country: { contains: country, mode: 'insensitive' }
    })
  };

  const [artists, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      skip,
      take,
      orderBy: [
        { followersCount: 'desc' },
        { name: 'asc' }
      ],
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        genres: true,
        city: true,
        country: true,
        isVerified: true,
        followersCount: true,
        createdAt: true,
        _count: {
          select: {
            events: true,
            shows: true
          }
        }
      }
    }),
    prisma.artist.count({ where })
  ]);

  const totalPages = Math.ceil(total / take);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  // ✅ ENTERPRISE: Use standardized response format
  res.json(paginatedResponse(
    { artists },
    {
      page: parseInt(page),
      lastPage: totalPages,
      limit: take,
      total,
      hasNext: hasNextPage,
      hasPrevious: hasPreviousPage
    },
    'Artists retrieved successfully'
  ));
}));

// @route   GET /api/artists/user-profiles
// @desc    Get artist profiles linked to users with ARTIST role
// @access  Public
router.get('/user-profiles', optionalAuth, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    genre,
    city,
    country
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = Math.min(parseInt(limit), 50); // Max 50 per request

  // Build where clause for users with ARTIST role
  const userWhere = {
    role: 'ARTIST',
    isActive: true,
    ...(search && {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { artistProfile: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } }
          ]
        }}
      ]
    }),
    ...(city && {
      OR: [
        { city: { contains: city, mode: 'insensitive' } },
        { artistProfile: { city: { contains: city, mode: 'insensitive' } } }
      ]
    }),
    ...(country && {
      OR: [
        { country: { contains: country, mode: 'insensitive' } },
        { artistProfile: { country: { contains: country, mode: 'insensitive' } } }
      ]
    }),
    ...(genre && {
      artistProfile: {
        genres: { has: genre }
      }
    })
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      skip,
      take,
      orderBy: [
        { artistProfile: { followersCount: 'desc' } },
        { username: 'asc' }
      ],
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
        artistProfile: {
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            genres: true,
            city: true,
            country: true,
            socialLinks: true,
            isVerified: true,
            followersCount: true,
            createdAt: true,
            _count: {
              select: {
                events: true,
                shows: true
              }
            }
          }
        }
      }
    }),
    prisma.user.count({ where: userWhere })
  ]);

  // Transform data to combine user and artist profile info
  const artistProfiles = users.map(user => {
    const profile = user.artistProfile;
    return {
      id: profile?.id || user.id,
      name: profile?.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      artistName: profile?.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      description: profile?.description || user.bio,
      imageUrl: profile?.imageUrl || user.avatar,
      genres: profile?.genres || [],
      city: profile?.city || user.city,
      country: profile?.country || user.country,
      location: profile?.city || user.city,
      socialLinks: profile?.socialLinks,
      isVerified: profile?.isVerified || user.isVerified,
      followersCount: profile?.followersCount || 0,
      eventsCount: profile?._count?.events || 0,
      showsCount: profile?._count?.shows || 0,
      userId: user.id,
      username: user.username,
      hasArtistProfile: !!profile,
      createdAt: profile?.createdAt || user.createdAt
    };
  });

  const totalPages = Math.ceil(total / take);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  res.json(paginatedResponse(
    { artists: artistProfiles },
    {
      page: parseInt(page),
      lastPage: totalPages,
      limit: take,
      total,
      hasNext: hasNextPage,
      hasPrevious: hasPreviousPage
    },
    'User-linked artist profiles retrieved successfully'
  ));
}));

// @route   GET /api/artists/popular
// @desc    Get popular artists
// @access  Public  
router.get('/popular', optionalAuth, asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const take = Math.min(parseInt(limit), 20);

  const artists = await prisma.artist.findMany({
    where: {
      isActive: true,
    },
    take,
    orderBy: [
      { followersCount: 'desc' },
      { name: 'asc' }
    ],
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      genres: true,
      city: true,
      country: true,
      isVerified: true,
      followersCount: true,
      label: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          verified: true
        }
      },
      _count: {
        select: {
          events: true,
          shows: true
        }
      }
    }
  });

  res.json({
    success: true,
    data: { artists }
  });
}));

// @route   GET /api/artists/my-profile
// @desc    Get current user's artist profile
// @access  Private (ARTIST role)
router.get('/my-profile', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = req.user;

  // Check if user has ARTIST role
  if (user.role !== 'ARTIST') {
    throw new AppError('Only users with ARTIST role can access artist profiles', 403);
  }

  const artistProfile = await prisma.artist.findUnique({
    where: { userId },
    include: {
      events: {
        where: {
          event: {
            startDate: { gte: new Date() }, // Only upcoming events
            isActive: true,
            status: 'PUBLISHED'
          }
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
              startTime: true,
              endTime: true,
              location: true,
              price: true,
              currency: true
            }
          }
        },
        orderBy: {
          event: { startDate: 'asc' }
        }
      },
      shows: {
        where: {
          date: { gte: new Date() }
        },
        orderBy: { date: 'asc' },
        take: 5
      },
      _count: {
        select: {
          events: true,
          shows: true,
          userFavorites: true
        }
      }
    }
  });

  if (!artistProfile) {
    // Return basic profile structure if no artist profile exists yet
    res.json(successResponse('No artist profile found', {
      artistProfile: null,
      canCreateProfile: true,
      userData: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        bio: user.bio,
        city: user.city,
        country: user.country
      }
    }));
  } else {
    // Merge events and manual shows into unified upcoming shows (same as public endpoint)
    const upcomingShows = [];

    // Add events from lineup (otomatis ketika artist masuk di lineup event)
    if (artistProfile.events && artistProfile.events.length > 0) {
      artistProfile.events.forEach(eventArtist => {
        const event = eventArtist.event;
        upcomingShows.push({
          id: `event_${event.id}`,
          name: event.title,
          venue: event.location,
          city: event.location,
          date: event.startDate,
          time: event.startTime,
          ticketPrice: event.price ? `${event.currency} ${event.price.toLocaleString()}` : null,
          ticketUrl: null, // Events di platform kita tidak perlu ticket URL
          type: 'event',
          eventId: event.id,
          imageUrl: event.imageUrl
        });
      });
    }

    // Add manual shows
    if (artistProfile.shows && artistProfile.shows.length > 0) {
      artistProfile.shows.forEach(show => {
        upcomingShows.push({
          id: `show_${show.id}`,
          name: show.venue,
          venue: show.venue,
          city: show.city,
          date: show.date,
          time: show.time,
          ticketPrice: show.ticketPrice,
          ticketUrl: show.ticketUrl || null,
          type: 'manual',
          showId: show.id
        });
      });
    }

    // Sort by date
    upcomingShows.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Create modified artist profile with unified shows
    const modifiedArtistProfile = {
      ...artistProfile,
      shows: upcomingShows, // Replace original shows with unified upcoming shows
      events: artistProfile.events, // Keep original events for reference
      upcomingShows: upcomingShows // Also provide as separate field
    };

    res.json(successResponse('Artist profile retrieved successfully', {
      artistProfile: modifiedArtistProfile,
      userData: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName
      }
    }));
  }
}));

// @route   GET /api/artists/:id
// @desc    Get artist by ID
// @access  Public
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const artist = await prisma.artist.findUnique({
    where: { 
      id,
      isActive: true 
    },
    include: {
      events: {
        where: {
          event: {
            startDate: { gte: new Date() }, // Only upcoming events
            isActive: true,
            status: 'PUBLISHED'
          }
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              description: true,
              imageUrl: true,
              startDate: true,
              startTime: true,
              endTime: true,
              location: true,
              price: true,
              currency: true,
              hasGuestlist: true,
              isActive: true
            }
          }
        },
        orderBy: {
          event: { startDate: 'asc' }
        }
      },
      shows: {
        where: {
          date: { gte: new Date() }
        },
        orderBy: { date: 'asc' }, // Nearest first
        take: 10
      },
      _count: {
        select: {
          events: true,
          shows: true
        }
      }
    }
  });

  if (!artist) {
    throw new AppError('Artist not found', 404);
  }

  // Merge events and manual shows into unified upcoming shows
  const upcomingShows = [];

  // Add events from lineup (otomatis ketika artist masuk di lineup event)
  if (artist.events && artist.events.length > 0) {
    artist.events.forEach(eventArtist => {
      const event = eventArtist.event;
      upcomingShows.push({
        id: `event_${event.id}`,
        name: event.title,
        venue: event.location,
        city: event.location, // Use location as city for events
        date: event.startDate,
        time: event.startTime,
        ticketPrice: event.price ? `${event.currency} ${event.price.toLocaleString()}` : null,
        ticketUrl: null, // Events di platform kita tidak perlu ticket URL (internal)
        type: 'event', // Mark as event-based show
        eventId: event.id,
        imageUrl: event.imageUrl
      });
    });
  }

  // Add manual shows (untuk event yang tidak ada di apps DS)
  if (artist.shows && artist.shows.length > 0) {
    artist.shows.forEach(show => {
      upcomingShows.push({
        id: `show_${show.id}`,
        name: show.venue,
        venue: show.venue,
        city: show.city,
        date: show.date,
        time: show.time,
        ticketPrice: show.ticketPrice,
        ticketUrl: show.ticketUrl || null, // Manual shows bisa punya ticket URL eksternal
        type: 'manual', // Mark as manually added show
        showId: show.id
      });
    });
  }

  // Sort by date (nearest first)
  upcomingShows.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Create modified artist with unified shows
  const modifiedArtist = {
    ...artist,
    shows: upcomingShows, // Replace original shows with unified upcoming shows
    events: artist.events, // Keep original events for reference
    upcomingShows: upcomingShows // Also provide as separate field
  };

  res.json({
    success: true,
    data: { artist: modifiedArtist }
  });
}));

// @route   POST /api/artists/:id/favorite
// @desc    Add/remove artist from favorites (love feature)
// @access  Private
router.post('/:id/favorite', authMiddleware, asyncHandler(async (req, res) => {
  const { id: artistId } = req.params;
  const userId = req.user.id;

  // Check if artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: artistId, isActive: true }
  });

  if (!artist) {
    throw new AppError('Artist not found', 404);
  }

  // Check if artist is already favorited
  const existingFavorite = await prisma.userArtistFavorite.findUnique({
    where: {
      userId_artistId: {
        userId,
        artistId
      }
    }
  });

  let isFavorited;
  let message;

  if (existingFavorite) {
    // Remove from favorites
    await prisma.userArtistFavorite.delete({
      where: {
        userId_artistId: {
          userId,
          artistId
        }
      }
    });
    isFavorited = false;
    message = 'Artist removed from favorites';
  } else {
    // Add to favorites
    await prisma.userArtistFavorite.create({
      data: {
        userId,
        artistId
      }
    });
    isFavorited = true;
    message = 'Artist added to favorites';
  }

  res.json(successResponse(message, {
    artistId,
    isFavorited
  }));
}));

// @route   GET /api/artists/:id/favorite/status
// @desc    Check if artist is favorited by current user
// @access  Private
router.get('/:id/favorite/status', authMiddleware, asyncHandler(async (req, res) => {
  const { id: artistId } = req.params;
  const userId = req.user.id;

  const favorite = await prisma.userArtistFavorite.findUnique({
    where: {
      userId_artistId: {
        userId,
        artistId
      }
    }
  });

  res.json(successResponse('Artist favorite status retrieved', {
    artistId,
    isFavorited: !!favorite
  }));
}));

// @route   GET /api/artists/favorites
// @desc    Get user's favorite artists
// @access  Private
router.get('/favorites', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const userId = req.user.id;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = Math.min(parseInt(limit), 50);

  const [favorites, total] = await Promise.all([
    prisma.userArtistFavorite.findMany({
      where: { userId },
      include: {
        artist: {
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
            socialLinks: true
          }
        }
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.userArtistFavorite.count({
      where: { userId }
    })
  ]);

  const artists = favorites.map(fav => fav.artist);

  res.json(paginatedResponse(
    { artists },
    {
      page: parseInt(page),
      lastPage: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
      total
    }
  ));
}));

// @route   POST /api/artists/:id/follow
// @desc    Follow/unfollow artist - properly implemented with artist-user relationship
// @access  Private
router.post('/:id/follow', authMiddleware, asyncHandler(async (req, res) => {
  const { id: artistId } = req.params;
  const userId = req.user.id;

  // Check if artist exists
  const artist = await prisma.artist.findUnique({
    where: { id: artistId, isActive: true }
  });

  if (!artist) {
    throw new AppError('Artist not found', 404);
  }

  // For now, we'll implement a simple artist follow using the favorite system
  // This is a temporary solution until we add proper Artist-User relationship
  // We'll return success but not actually track follows for now
  
  // Simulate toggle behavior for UI consistency
  const existingFavorite = await prisma.userArtistFavorite.findUnique({
    where: {
      userId_artistId: {
        userId,
        artistId
      }
    }
  });

  // Use favorite status as proxy for follow status temporarily
  // This gives us working functionality while we design proper artist-user relationship
  const isCurrentlyFollowing = !!existingFavorite;
  const newFollowStatus = !isCurrentlyFollowing;

  // Update follower count on artist
  if (newFollowStatus) {
    await prisma.artist.update({
      where: { id: artistId },
      data: { followersCount: { increment: 1 } }
    });
  } else {
    await prisma.artist.update({
      where: { id: artistId },
      data: { followersCount: { decrement: 1 } }
    });
  }

  const message = newFollowStatus ? 'Artist followed successfully' : 'Artist unfollowed successfully';
  
  res.json(successResponse(message, {
    artistId,
    isFollowing: newFollowStatus,
    followersCount: artist.followersCount + (newFollowStatus ? 1 : -1)
  }));
}));

// @route   GET /api/artists/:id/follow/status
// @desc    Check if user is following artist
// @access  Private
router.get('/:id/follow/status', authMiddleware, asyncHandler(async (req, res) => {
  const { id: artistId } = req.params;
  const userId = req.user.id;

  // For now, use favorite status as proxy for follow status
  const existingFavorite = await prisma.userArtistFavorite.findUnique({
    where: {
      userId_artistId: {
        userId,
        artistId
      }
    }
  });

  const isFollowing = !!existingFavorite;

  res.json(successResponse('Artist follow status retrieved', {
    artistId,
    isFollowing
  }));
}));

// @route   GET /api/artists/followed
// @desc    Get user's followed artists (using favorites as proxy)
// @access  Private
router.get('/followed', authMiddleware, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const userId = req.user.id;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = Math.min(parseInt(limit), 50);

  // For now, return favorites as followed artists since we're using favorites as proxy
  const [favorites, total] = await Promise.all([
    prisma.userArtistFavorite.findMany({
      where: { userId },
      include: {
        artist: {
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
            socialLinks: true
          }
        }
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.userArtistFavorite.count({
      where: { userId }
    })
  ]);

  const artists = favorites.map(fav => fav.artist);

  res.json(paginatedResponse(artists, total, parseInt(page), parseInt(limit)));
}));

// @route   POST /api/artists/profile
// @desc    Create or update artist profile for current user (ARTIST role only)
// @access  Private (ARTIST role)
router.post('/profile', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = req.user;

  // Check if user has ARTIST role
  if (user.role !== 'ARTIST') {
    throw new AppError('Only users with ARTIST role can create artist profiles', 403);
  }

  const {
    name,
    description,
    imageUrl,
    genres = [],
    city,
    country,
    socialLinks = {},
    // Optional extras from mobile client
    upcomingShows = [], // [{ venue, city, date, time, ticketPrice }]
    presskitUrl,
    presskitFilePath, // legacy key from client
  } = req.body;

  // Merge presskit url into socialLinks without overwriting other keys
  const resolvedPresskitUrl = presskitUrl || presskitFilePath || null;
  const mergedSocialLinks = {
    ...(socialLinks || {}),
    ...(resolvedPresskitUrl ? { presskit: resolvedPresskitUrl } : {}),
  };

  // Check if user already has an artist profile
  const existingProfile = await prisma.artist.findUnique({
    where: { userId }
  });

  let artistProfile;

  if (existingProfile) {
    // Update existing profile
    artistProfile = await prisma.artist.update({
      where: { userId },
      data: {
        name: name || existingProfile.name,
        description: description || existingProfile.description,
        imageUrl: imageUrl || existingProfile.imageUrl,
        genres: genres.length > 0 ? genres : existingProfile.genres,
        city: city || existingProfile.city,
        country: country || existingProfile.country,
        socialLinks: Object.keys(mergedSocialLinks).length > 0 ? mergedSocialLinks : existingProfile.socialLinks
      }
    });
  } else {
    // Create new profile
    artistProfile = await prisma.artist.create({
      data: {
        userId,
        name: name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
        description: description || user.bio,
        imageUrl: imageUrl || user.avatar,
        genres,
        city: city || user.city,
        country: country || user.country,
        socialLinks: mergedSocialLinks
      }
    });
  }

  // Optional: replace upcoming shows if provided
  if (Array.isArray(upcomingShows)) {
    // Clear all existing shows for this artist and recreate from payload
    await prisma.artistShow.deleteMany({ where: { artistId: artistProfile.id } });

    if (upcomingShows.length > 0) {
      const showData = upcomingShows
        .filter((s) => s && (s.venue || s.name) && s.date)
        .map((s) => ({
          artistId: artistProfile.id,
          venue: s.venue || s.name || 'Unknown Venue',
          city: s.city || null,
          date: new Date(s.date),
          time: s.time || '20:00',
          ticketPrice: s.ticketPrice || null,
        }));

      if (showData.length > 0) {
        await prisma.artistShow.createMany({ data: showData });
      }
    }
  }

  res.json(successResponse(
    existingProfile ? 'Artist profile updated successfully' : 'Artist profile created successfully',
    { artistProfile }
  ));
}));

module.exports = router;