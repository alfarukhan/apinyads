const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();
// ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../lib/prisma');

// ✅ ENTERPRISE: Use centralized user selectors
const userSelectors = require('../lib/user-selectors');

// ✅ TIMEZONE: Use Jakarta timezone for consistent date handling
const { 
  getJakartaNow,
  getJakartaToday, 
  getJakartaTomorrow, 
  getJakartaTodayUTCDate,
  getJakartaTomorrowUTCDate,
  getJakartaDateRange,
  toJakartaTime,
  formatJakartaDate,
  createJakartaDate,
  isDateMatchJakarta
} = require('../utils/timezone-helper');


// @route   GET /api/daily-drop
// @desc    Get today's daily drop track OR list daily drops for CMS
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    // Auto-cleanup old daily drops (older than 7 days)
    await cleanupOldDailyDrops();
    
    // Check if this is a CMS list request (has page, limit, search params)
    const { page, limit, search, date } = req.query;
    
    if (page || limit || search || date) {
      // CMS list request
      return await handleDailyDropsList(req, res);
    }
    
    // Regular single daily drop request - use UTC window derived from Jakarta calendar date
    // This ensures DB DATE column comparisons are stable and not shifted
    const today = getJakartaTodayUTCDate();
    const tomorrow = getJakartaTomorrowUTCDate();

    console.log(`🔍 Looking for daily drop on date: ${today.toISOString().split('T')[0]} (Jakarta GMT+7)`);
    console.log(`🔍 Server time range: ${formatJakartaDate(today)} to ${formatJakartaDate(tomorrow)}`);

    // Debug: Check what daily drops exist in the database
    const allDailyDrops = await prisma.dailyDrop.findMany({
      where: { isActive: true },
      select: { id: true, trackName: true, artistName: true, date: true },
      orderBy: { date: 'desc' }
    });
    console.log(`📋 All active daily drops in DB:`, allDailyDrops.map(d => ({
      track: d.trackName,
      artist: d.artistName, 
      date: d.date.toISOString().split('T')[0],
      dateUTC: d.date.toISOString(),
      dateJakarta: formatJakartaDate(d.date)
    })));

    console.log(`🎯 Looking for daily drop with date range (UTC window for Jakarta date):`);
    console.log(`   From (UTC): ${today.toISOString()}  | Jakarta: ${formatJakartaDate(today)}`);
    console.log(`   To   (UTC): ${tomorrow.toISOString()} | Jakarta: ${formatJakartaDate(tomorrow)}`);

    // Check if there's a daily drop configured for today
    let dailyDrop = await prisma.dailyDrop.findFirst({
      where: {
        date: {
          gte: today,
          lt: tomorrow
        },
        isActive: true
      },
      include: {
        artist: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            avatar: true
          }
        }
      }
    });

    // Only return daily drop for today - no fallback to latest
    if (!dailyDrop) {
      console.log(`❌ No daily drop found for ${today.toISOString().split('T')[0]}`);
      return res.json({
        success: true,
        data: null,
        message: 'No daily drop scheduled for today'
      });
    }

    console.log(`✅ Found daily drop for ${today.toISOString().split('T')[0]}: ${dailyDrop.trackName} by ${dailyDrop.artistName}`);
    console.log(`📅 Daily drop date in DB: ${dailyDrop.date.toISOString()} (${formatJakartaDate(dailyDrop.date)})`);

    // Format response
    const response = {
      id: dailyDrop.id,
      artistName: dailyDrop.artist ? 
        `${dailyDrop.artist.firstName} ${dailyDrop.artist.lastName}`.trim() || dailyDrop.artist.username :
        dailyDrop.artistName,
      artistImageUrl: dailyDrop.artist?.avatar || dailyDrop.artistImageUrl,
      track: {
        id: dailyDrop.spotifyTrackId || dailyDrop.id,
        name: dailyDrop.trackName,
        artist: dailyDrop.artistName,
        albumImageUrl: dailyDrop.albumImageUrl,
        previewUrl: dailyDrop.previewUrl,
        spotifyUrl: dailyDrop.spotifyUrl,
        durationMs: dailyDrop.durationMs
      },
      date: dailyDrop.date,
      isActive: dailyDrop.isActive
    };

    res.json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('Daily Drop Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get daily drop',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   POST /api/daily-drop
// @desc    Create/Update daily drop (Admin only)
// @access  Admin
router.post('/', authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const {
      artistName,
      artistImageUrl,
      trackName,
      albumImageUrl,
      previewUrl,
      spotifyUrl,
      spotifyTrackId,
      durationMs,
      date,
      artistId
    } = req.body;

    // Validate required fields
    if (!trackName || !artistName) {
      return res.status(400).json({
        success: false,
        message: 'Track name and artist name are required'
      });
    }

    // ✅ TIMEZONE: Accept 'YYYY-MM-DD' then convert to UTC midnight for that Jakarta calendar date
    const dropDate = date ? createJakartaDate(date) : getJakartaTodayUTCDate();
    
    console.log(`💾 Saving daily drop with date: ${dropDate.toISOString()} (${formatJakartaDate(dropDate)})`);

    // Check if daily drop already exists for this date
    const existingDrop = await prisma.dailyDrop.findFirst({
      where: {
        date: dropDate
      }
    });

    let dailyDrop;
    if (existingDrop) {
      // Update existing
      dailyDrop = await prisma.dailyDrop.update({
        where: { id: existingDrop.id },
        data: {
          artistName,
          artistImageUrl,
          trackName,
          albumImageUrl,
          previewUrl,
          spotifyUrl,
          spotifyTrackId,
          durationMs: durationMs || 30000,
          artistId,
          isActive: true
        },
        include: {
          artist: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              avatar: true
            }
          }
        }
      });
    } else {
      // Create new
      dailyDrop = await prisma.dailyDrop.create({
        data: {
          artistName,
          artistImageUrl,
          trackName,
          albumImageUrl,
          previewUrl,
          spotifyUrl,
          spotifyTrackId,
          durationMs: durationMs || 30000,
          date: dropDate,
          artistId,
          isActive: true
        },
        include: {
          artist: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              avatar: true
            }
          }
        }
      });
    }

    res.status(201).json({
      success: true,
      data: dailyDrop,
      message: existingDrop ? 'Daily drop updated successfully' : 'Daily drop created successfully'
    });

  } catch (error) {
    console.error('Create Daily Drop Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create daily drop',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PUT /api/daily-drop/:id
// @desc    Update daily drop (Admin only)
// @access  Admin
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const { id } = req.params;
    const {
      artistName,
      artistImageUrl,
      trackName,
      albumImageUrl,
      previewUrl,
      spotifyUrl,
      spotifyTrackId,
      durationMs,
      playlistId,
      playlistName,
      playlistUrl,
      playlistImageUrl,
      date,
      isActive,
      artistId
    } = req.body;

    // Validate required fields
    if (!trackName || !artistName) {
      return res.status(400).json({
        success: false,
        message: 'Track name and artist name are required'
      });
    }

    // Update the daily drop
    const dailyDrop = await prisma.dailyDrop.update({
      where: { id },
      data: {
        artistName,
        artistImageUrl,
        trackName,
        albumImageUrl,
        previewUrl,
        spotifyUrl,
        spotifyTrackId,
        durationMs: durationMs || 30000,
        playlistId,
        playlistName,
        playlistUrl,
        playlistImageUrl,
        date: date ? createJakartaDate(date) : undefined,
        isActive: isActive !== undefined ? isActive : true,
        artistId
      }
    });

    res.json({
      success: true,
      data: dailyDrop,
      message: 'Daily drop updated successfully'
    });

  } catch (error) {
    console.error('Update Daily Drop Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update daily drop',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/daily-drop/history
// @desc    Get daily drop history
// @access  Public
router.get('/history', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [dailyDrops, total] = await Promise.all([
      prisma.dailyDrop.findMany({
        where: {
          isActive: true
        },
        include: {
          artist: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              avatar: true
            }
          }
        },
        orderBy: {
          date: 'desc'
        },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.dailyDrop.count({
        where: {
          isActive: true
        }
      })
    ]);

    const formattedDrops = dailyDrops.map(drop => ({
      id: drop.id,
      artistName: drop.artist ? 
        `${drop.artist.firstName} ${drop.artist.lastName}`.trim() || drop.artist.username :
        drop.artistName,
      artistImageUrl: drop.artist?.avatar || drop.artistImageUrl,
      track: {
        id: drop.spotifyTrackId || drop.id,
        name: drop.trackName,
        artist: drop.artistName,
        albumImageUrl: drop.albumImageUrl,
        previewUrl: drop.previewUrl,
        spotifyUrl: drop.spotifyUrl,
        durationMs: drop.durationMs
      },
      date: drop.date,
      isActive: drop.isActive
    }));

    res.json({
      success: true,
      data: {
        dailyDrops: formattedDrops,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          total,
          hasNext: offset + parseInt(limit) < total,
          hasPrev: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Daily Drop History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get daily drop history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/daily-drop/:id
// @desc    Delete daily drop (Admin only)
// @access  Admin
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const { id } = req.params;

    // Check if daily drop exists
    const existingDrop = await prisma.dailyDrop.findUnique({
      where: { id }
    });

    if (!existingDrop) {
      return res.status(404).json({
        success: false,
        message: 'Daily drop not found'
      });
    }

    // Delete the daily drop
    await prisma.dailyDrop.delete({
      where: { id }
    });

    console.log(`🗑️ Daily drop deleted: ${existingDrop.trackName} by ${existingDrop.artistName}`);

    res.json({
      success: true,
      message: 'Daily drop deleted successfully'
    });

  } catch (error) {
    console.error('Delete Daily Drop Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete daily drop',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Handle CMS list request for daily drops
async function handleDailyDropsList(req, res) {
  try {
    // Auto-cleanup old daily drops when CMS loads the list
    await cleanupOldDailyDrops();
    
    const { page = 1, limit = 20, search, date } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build where clause
    const where = {};
    
    if (search) {
      where.OR = [
        { trackName: { contains: search, mode: 'insensitive' } },
        { artistName: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (date) {
      const { start: searchDate, end: nextDay } = getJakartaDateRange(date);
      
      where.date = {
        gte: searchDate,
        lt: nextDay
      };
    }

    const [dailyDrops, total] = await Promise.all([
      prisma.dailyDrop.findMany({
        where,
        include: {
          artist: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              username: true,
              avatar: true
            }
          }
        },
        orderBy: {
          date: 'desc'
        },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.dailyDrop.count({ where })
    ]);

    const formattedDrops = dailyDrops.map(drop => ({
      id: drop.id,
      artistName: drop.artist ? 
        `${drop.artist.firstName} ${drop.artist.lastName}`.trim() || drop.artist.username :
        drop.artistName,
      artistImageUrl: drop.artist?.avatar || drop.artistImageUrl,
      trackName: drop.trackName,
      albumImageUrl: drop.albumImageUrl,
      previewUrl: drop.previewUrl,
      spotifyUrl: drop.spotifyUrl,
      spotifyTrackId: drop.spotifyTrackId,
      durationMs: drop.durationMs,
      playlistId: drop.playlistId,
      playlistName: drop.playlistName,
      playlistUrl: drop.playlistUrl,
      playlistImageUrl: drop.playlistImageUrl,
      date: drop.date,
      isActive: drop.isActive,
      createdAt: drop.createdAt,
      updatedAt: drop.updatedAt
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: {
        dailyDrops: formattedDrops,
        total,
        pages: totalPages,
        currentPage: parseInt(page),
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Daily Drop List Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get daily drops list',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Auto-cleanup function to delete old daily drops
async function cleanupOldDailyDrops() {
  try {
    const today = getJakartaToday();

    // Delete daily drops that are older than today (past their featured date)
    const deletedCount = await prisma.dailyDrop.deleteMany({
      where: {
        date: {
          lt: today
        }
      }
    });

    if (deletedCount.count > 0) {
      console.log(`🗑️ Cleaned up ${deletedCount.count} expired daily drops (older than today)`);
    }
  } catch (error) {
    console.error('❌ Error cleaning up old daily drops:', error);
    // Don't throw error, just log it to avoid breaking the main request
  }
}

// @route   GET /api/daily-drop/debug
// @desc    Debug daily drop timezone and date handling
// @access  Public (for development debugging)
router.get('/debug', async (req, res) => {
  try {
    const now = getJakartaNow();
    const today = getJakartaToday();
    const tomorrow = getJakartaTomorrow();

    // Get all daily drops with detailed date info
    const allDrops = await prisma.dailyDrop.findMany({
      where: { isActive: true },
      select: { 
        id: true, 
        trackName: true, 
        artistName: true, 
        date: true,
        createdAt: true
      },
      orderBy: { date: 'desc' }
    });

    const debugInfo = {
      serverTime: {
        jakartaNow: formatJakartaDate(now),
        jakartaToday: formatJakartaDate(today),
        jakartaTomorrow: formatJakartaDate(tomorrow),
        systemTime: new Date().toISOString(),
        timezone: process.env.TZ || 'Not set'
      },
      searchRange: {
        from: today.toISOString(),
        to: tomorrow.toISOString(),
        fromJakarta: formatJakartaDate(today),
        toJakarta: formatJakartaDate(tomorrow)
      },
      dailyDrops: allDrops.map(drop => ({
        id: drop.id,
        track: drop.trackName,
        artist: drop.artistName,
        dateStored: drop.date.toISOString(),
        dateJakarta: formatJakartaDate(drop.date),
        dateOnly: drop.date.toISOString().split('T')[0],
        isToday: isDateMatchJakarta(drop.date, today),
        inRange: drop.date >= today && drop.date < tomorrow,
        createdAt: drop.createdAt.toISOString()
      })),
      explanation: {
        issue: "Daily drop returns latest instead of today's drop",
        cause: "Timezone mismatch between stored dates and query dates",
        solution: "Ensure both storage and query use consistent Jakarta timezone"
      }
    };

    res.json({
      success: true,
      debug: debugInfo
    });

  } catch (error) {
    console.error('Debug Daily Drop Error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
      error: error.message
    });
  }
});

module.exports = router;