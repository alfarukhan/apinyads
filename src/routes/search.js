const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth, authMiddleware } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');


// @route   GET /api/search
// @desc    Unified search for events, users, and communities
// @access  Private (for user search) / Public (for events)
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const {
    q: query = '',
    type = 'all', // all, events, users, communities
    limit = 10,
    city,
    category,
  } = req.query;

  if (!query || query.trim().length < 2) {
    return res.json({
      success: true,
      data: {
        events: [],
        users: [],
        communities: [],
        total: 0
      }
    });
  }

  const searchTerm = query.trim();
  const take = Math.min(parseInt(limit), 50); // Max 50 results

  const results = {};

  // Search Events
  if (type === 'all' || type === 'events') {
    const eventWhere = {
      isActive: true,
      date: { gte: new Date() }, // Only upcoming events
      OR: [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { location: { contains: searchTerm, mode: 'insensitive' } },
        { category: { contains: searchTerm, mode: 'insensitive' } },
      ],
      ...(city && { location: { contains: city, mode: 'insensitive' } }),
      ...(category && { category: { contains: category, mode: 'insensitive' } }),
    };

    results.events = await prisma.event.findMany({
      where: eventWhere,
      take,
      orderBy: [
        { date: 'asc' },
        { title: 'asc' }
      ],
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
        _count: {
          select: {
            registrations: true,
            guestLists: true,
          }
        }
      }
    });
  }

  // Search Users
  if (type === 'all' || type === 'users') {
    const userWhere = {
      isActive: true,
      OR: [
        { username: { contains: searchTerm, mode: 'insensitive' } },
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
        { bio: { contains: searchTerm, mode: 'insensitive' } },
      ],
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
    };

    const users = await prisma.user.findMany({
      where: userWhere,
      take,
      orderBy: { username: 'asc' },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        city: true,
        isVerified: true,
        _count: {
          select: {
            followers: true,
            events: true,
          }
        }
      }
    });

    // Add follow status for current user
    const currentUserId = req.user?.id;
    if (currentUserId) {
      const usersWithFollowStatus = await Promise.all(
        users.map(async (user) => {
          const isFollowing = await prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUserId,
                followingId: user.id
              }
            }
          });

          return {
            ...user,
            isFollowing: !!isFollowing
          };
        })
      );
      results.users = usersWithFollowStatus;
    } else {
      results.users = users.map(user => ({ ...user, isFollowing: false }));
    }
  }

  // Search Communities
  if (type === 'all' || type === 'communities') {
    const communityWhere = {
      OR: [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { category: { contains: searchTerm, mode: 'insensitive' } },
      ],
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(category && { category: { contains: category, mode: 'insensitive' } }),
    };

    results.communities = await prisma.community.findMany({
      where: communityWhere,
      take,
      orderBy: [
        { memberCount: 'desc' },
        { name: 'asc' }
      ],
      include: {
        admin: {
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
  }

  // Calculate total results
  const total = (results.events?.length || 0) + 
                (results.users?.length || 0) + 
                (results.communities?.length || 0);

  res.json({
    success: true,
    data: {
      query: searchTerm,
      type,
      events: results.events || [],
      users: results.users || [],
      communities: results.communities || [],
      total
    }
  });
}));

// @route   GET /api/search/suggestions
// @desc    Get search suggestions/autocomplete
// @access  Public
router.get('/suggestions', asyncHandler(async (req, res) => {
  const { q: query = '', type = 'all' } = req.query;

  if (!query || query.trim().length < 2) {
    return res.json({
      success: true,
      data: { suggestions: [] }
    });
  }

  const searchTerm = query.trim();
  const suggestions = [];

  // Event suggestions
  if (type === 'all' || type === 'events') {
    const events = await prisma.event.findMany({
      where: {
        isActive: true,
        date: { gte: new Date() },
        title: { contains: searchTerm, mode: 'insensitive' }
      },
      take: 5,
      select: {
        id: true,
        title: true,
        date: true,
        location: true,
      },
      orderBy: { title: 'asc' }
    });

    suggestions.push(...events.map(event => ({
      type: 'event',
      id: event.id,
      text: event.title,
      subtitle: `${event.location} • ${new Date(event.date).toLocaleDateString()}`,
    })));
  }

  // User suggestions
  if (type === 'all' || type === 'users') {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { username: { contains: searchTerm, mode: 'insensitive' } },
          { firstName: { contains: searchTerm, mode: 'insensitive' } },
          { lastName: { contains: searchTerm, mode: 'insensitive' } },
        ]
      },
      take: 5,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
      },
      orderBy: { username: 'asc' }
    });

    suggestions.push(...users.map(user => ({
      type: 'user',
      id: user.id,
      text: user.username,
      subtitle: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username,
      avatar: user.avatar,
    })));
  }

  // Community suggestions
  if (type === 'all' || type === 'communities') {
    const communities = await prisma.community.findMany({
      where: {
        name: { contains: searchTerm, mode: 'insensitive' }
      },
      take: 5,
      select: {
        id: true,
        name: true,
        memberCount: true,
        category: true,
      },
      orderBy: { memberCount: 'desc' }
    });

    suggestions.push(...communities.map(community => ({
      type: 'community',
      id: community.id,
      text: community.name,
      subtitle: `${community.memberCount} members${community.category ? ` • ${community.category}` : ''}`,
    })));
  }

  // Sort suggestions by relevance (exact matches first)
  suggestions.sort((a, b) => {
    const aExact = a.text.toLowerCase().startsWith(searchTerm.toLowerCase());
    const bExact = b.text.toLowerCase().startsWith(searchTerm.toLowerCase());
    
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.text.localeCompare(b.text);
  });

  res.json({
    success: true,
    data: {
      query: searchTerm,
      suggestions: suggestions.slice(0, 10) // Max 10 suggestions
    }
  });
}));

// @route   GET /api/search/trending
// @desc    Get trending searches and popular content
// @access  Public
router.get('/trending', asyncHandler(async (req, res) => {
  const { type = 'all' } = req.query;

  const results = {};

  // Trending events (most registrations in last 7 days)
  if (type === 'all' || type === 'events') {
    results.events = await prisma.event.findMany({
      where: {
        isActive: true,
        date: { gte: new Date() },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      },
      take: 5,
      orderBy: {
        registrations: {
          _count: 'desc'
        }
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
        },
        _count: {
          select: {
            registrations: true,
          }
        }
      }
    });
  }

  // Popular users (most followers)
  if (type === 'all' || type === 'users') {
    results.users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['ORGANIZER', 'USER'] }
      },
      take: 5,
      orderBy: {
        followers: {
          _count: 'desc'
        }
      },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        bio: true,
        isVerified: true,
        _count: {
          select: {
            followers: true,
            events: true,
          }
        }
      }
    });
  }

  // Popular communities (most members)
  if (type === 'all' || type === 'communities') {
    results.communities = await prisma.community.findMany({
      where: {
        isPrivate: false
      },
      take: 5,
      orderBy: { memberCount: 'desc' },
      include: {
        admin: {
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
  }

  res.json({
    success: true,
    data: {
      trending: results
    }
  });
}));

module.exports = router; 