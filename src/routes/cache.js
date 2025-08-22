const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/auth');
const AdvancedCacheService = require('../services/cache/AdvancedCacheService');
const { prisma } = require('../lib/prisma');
const userSelectors = require('../lib/user-selectors');

const router = express.Router();
const cacheService = new AdvancedCacheService();

/**
 * 📱 OFFLINE CACHE & SYNC API ENDPOINTS
 * 
 * API untuk mendukung offline functionality di Flutter:
 * - Cache manifest download
 * - Offline content pre-loading  
 * - Sync detection dan updates
 * - Cache management
 * - Offline-first data strategy
 */

// @route   GET /api/cache/manifest
// @desc    📱 Get offline cache manifest for user
// @access  Private
router.get('/manifest', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { limit = 100, priority = 'all' } = req.query;

  try {
    // Get user's offline cache manifest
    const manifest = await cacheService.getOfflineCacheManifest(userId, parseInt(limit));
    
    // Filter by priority if specified
    const filteredManifest = priority === 'all' 
      ? manifest 
      : manifest.filter(item => item.priority === priority);

    // Get cache statistics
    const stats = await cacheService.getCacheStats(userId);
    
    res.json({
      success: true,
      data: {
        manifest: filteredManifest,
        totalItems: filteredManifest.length,
        stats,
        generatedAt: new Date().toISOString(),
        cacheVersion: cacheService.cacheVersion
      },
      message: `Cache manifest generated with ${filteredManifest.length} items`
    });

    console.log(`📱 Cache manifest delivered to user ${userId}: ${filteredManifest.length} items`);
  } catch (error) {
    console.error(`❌ Failed to generate cache manifest for user ${userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate cache manifest'
    });
  }
}));

// @route   POST /api/cache/preload
// @desc    📱 Pre-load content for offline access
// @access  Private
router.post('/preload', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { 
    contentTypes = ['events', 'artists', 'news'], 
    limit = 50,
    includeImages = false 
  } = req.body;

  try {
    const preloadedData = {};
    let totalCached = 0;

    // ✅ EVENTS: Pre-load upcoming events
    if (contentTypes.includes('events')) {
      const events = await prisma.event.findMany({
        where: {
          startDate: { gte: new Date() },
          isActive: true
        },
        include: {
          organizer: { select: userSelectors.basic },
          venue: true,
          accessTiers: true
        },
        orderBy: { startDate: 'asc' },
        take: limit
      });

      for (const event of events) {
        await cacheService.setCache('events', event.id, event, userId);
        totalCached++;
      }

      preloadedData.events = events.length;
    }

    // ✅ ARTISTS: Pre-load popular artists
    if (contentTypes.includes('artists')) {
      const artists = await prisma.user.findMany({
        where: {
          role: 'ARTIST',
          isActive: true
        },
        select: {
          ...userSelectors.basic,
          bio: true,
          genres: true,
          socialLinks: true,
          _count: {
            select: {
              followers: true,
              posts: true
            }
          }
        },
        orderBy: {
          followers: { _count: 'desc' }
        },
        take: limit
      });

      for (const artist of artists) {
        await cacheService.setCache('artists', artist.id, artist, userId);
        totalCached++;
      }

      preloadedData.artists = artists.length;
    }

    // ✅ NEWS: Pre-load recent news
    if (contentTypes.includes('news')) {
      const news = await prisma.news.findMany({
        where: {
          publishedDate: { lte: new Date() }
        },
        orderBy: { publishedDate: 'desc' },
        take: limit
      });

      for (const article of news) {
        await cacheService.setCache('news', article.id, article, userId);
        totalCached++;
      }

      preloadedData.news = news.length;
    }

    // ✅ COMMUNITIES: Pre-load user's communities
    if (contentTypes.includes('communities')) {
      const userCommunities = await prisma.community.findMany({
        where: {
          members: {
            some: { id: userId }
          }
        },
        include: {
          _count: {
            select: {
              members: true,
              posts: true
            }
          }
        },
        take: limit
      });

      for (const community of userCommunities) {
        await cacheService.setCache('communities', community.id, community, userId);
        totalCached++;
      }

      preloadedData.communities = userCommunities.length;
    }

    // ✅ CHAT MESSAGES: Pre-load recent chat messages
    if (contentTypes.includes('chatMessages')) {
      const userChatRooms = await prisma.chatRoom.findMany({
        where: {
          members: { some: { id: userId } }
        },
        select: { id: true }
      });

      for (const room of userChatRooms) {
        const messages = await prisma.message.findMany({
          where: {
            chatRoomId: room.id,
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
            }
          },
          include: {
            sender: { select: userSelectors.basic },
            replyTo: {
              include: {
                sender: { select: userSelectors.basic }
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 100
        });

        await cacheService.setCache('chatMessages', room.id, messages, userId);
        totalCached++;
      }

      preloadedData.chatMessages = userChatRooms.length;
    }

    res.json({
      success: true,
      data: {
        preloadedData,
        totalCached,
        contentTypes,
        cacheExpiry: '5-30 minutes depending on content type',
        offlineSupport: true
      },
      message: `Pre-loaded ${totalCached} items for offline access`
    });

    console.log(`📱 Pre-loaded ${totalCached} items for offline access - User: ${userId}`);
  } catch (error) {
    console.error(`❌ Failed to pre-load content for user ${userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to pre-load content for offline access'
    });
  }
}));

// @route   POST /api/cache/sync
// @desc    🔄 Sync cache after coming back online
// @access  Private
router.post('/sync', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { lastSyncTimestamp, cacheVersion } = req.body;

  try {
    if (!lastSyncTimestamp) {
      return res.status(400).json({
        success: false,
        message: 'lastSyncTimestamp is required for sync'
      });
    }

    // Check if cache version is compatible
    const currentVersion = cacheService.cacheVersion;
    const versionCompatible = cacheVersion === currentVersion;

    let updates = [];
    let invalidated = [];

    if (versionCompatible) {
      // Get updates since last sync
      updates = await cacheService.syncUserCache(userId, lastSyncTimestamp);
      
      // Apply updates to cache
      for (const update of updates) {
        if (update.action === 'update') {
          await cacheService.setCache(update.type, update.identifier, update.data, userId);
        } else if (update.action === 'delete') {
          await cacheService.invalidateCache(update.type, update.identifier, userId);
          invalidated.push(`${update.type}:${update.identifier}`);
        }
      }
    } else {
      // Version mismatch - invalidate all cache
      console.log(`🔄 Cache version mismatch for user ${userId}: ${cacheVersion} → ${currentVersion}`);
      await cacheService.invalidateCache('*', '*', userId);
      invalidated.push('all_cache_due_to_version_mismatch');
    }

    res.json({
      success: true,
      data: {
        updates: updates.length,
        invalidated: invalidated.length,
        updateList: updates.map(u => ({ type: u.type, identifier: u.identifier, action: u.action })),
        invalidatedList: invalidated,
        newCacheVersion: currentVersion,
        versionCompatible,
        syncTimestamp: new Date().toISOString()
      },
      message: `Sync completed: ${updates.length} updates, ${invalidated.length} invalidated`
    });

    console.log(`🔄 Cache sync completed for user ${userId}: ${updates.length} updates`);
  } catch (error) {
    console.error(`❌ Failed to sync cache for user ${userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync cache'
    });
  }
}));

// @route   GET /api/cache/stats
// @desc    📊 Get cache statistics
// @access  Private  
router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { includeGlobal = false } = req.query;

  try {
    const userStats = await cacheService.getCacheStats(userId);
    const globalStats = includeGlobal ? await cacheService.getCacheStats() : null;

    res.json({
      success: true,
      data: {
        user: {
          ...userStats,
          userId,
          offlinePercentage: userStats.totalKeys > 0 
            ? Math.round((userStats.offlineSupported / userStats.totalKeys) * 100) 
            : 0
        },
        ...(globalStats && { global: globalStats }),
        cacheVersion: cacheService.cacheVersion,
        policies: Object.keys(cacheService.cachePolicies).reduce((acc, key) => {
          const policy = cacheService.cachePolicies[key];
          acc[key] = {
            ttl: policy.ttl,
            offlineSupport: policy.offlineSupport,
            priority: policy.priority
          };
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error(`❌ Failed to get cache stats for user ${userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache statistics'
    });
  }
}));

// @route   DELETE /api/cache/clear
// @desc    🗑️ Clear user cache (for troubleshooting)
// @access  Private
router.delete('/clear', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { types = [] } = req.body;

  try {
    let clearedCount = 0;

    if (types.length === 0) {
      // Clear all user cache
      clearedCount = await cacheService.invalidateCache('*', '*', userId);
    } else {
      // Clear specific types
      for (const type of types) {
        const count = await cacheService.invalidateCache(type, '*', userId);
        clearedCount += count;
      }
    }

    res.json({
      success: true,
      data: {
        clearedCount,
        clearedTypes: types.length > 0 ? types : ['all'],
        userId
      },
      message: `Cleared ${clearedCount} cache entries`
    });

    console.log(`🗑️ Cleared ${clearedCount} cache entries for user ${userId}`);
  } catch (error) {
    console.error(`❌ Failed to clear cache for user ${userId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache'
    });
  }
}));

// @route   GET /api/cache/offline-check
// @desc    🔍 Check if content is available offline
// @access  Private
router.get('/offline-check', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { type, identifier } = req.query;

  if (!type || !identifier) {
    return res.status(400).json({
      success: false,
      message: 'type and identifier parameters are required'
    });
  }

  try {
    const cached = await cacheService.getCache(type, identifier, userId);
    const isOfflineSupported = cacheService.isOfflineSupported(type);
    
    res.json({
      success: true,
      data: {
        available: !!cached,
        offlineSupported: isOfflineSupported,
        cached: !!cached,
        expiresAt: cached?.metadata?.expiresAt || null,
        priority: cached?.metadata?.priority || null,
        type,
        identifier
      }
    });
  } catch (error) {
    console.error(`❌ Failed to check offline availability:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to check offline availability'
    });
  }
}));

// @route   POST /api/cache/priority-update
// @desc    ⭐ Update cache priority for specific content
// @access  Private
router.post('/priority-update', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { items } = req.body; // [{ type, identifier, priority }]

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({
      success: false,
      message: 'items array is required'
    });
  }

  try {
    let updatedCount = 0;

    for (const item of items) {
      const { type, identifier, priority } = item;
      
      if (!type || !identifier || !priority) continue;
      
      // Get current cache data
      const cached = await cacheService.getCache(type, identifier, userId);
      
      if (cached && cacheService.isOfflineSupported(type)) {
        // Update priority in offline index
        await cacheService.addToOfflineIndex(type, identifier, userId, priority);
        updatedCount++;
      }
    }

    res.json({
      success: true,
      data: {
        updatedCount,
        totalRequested: items.length
      },
      message: `Updated priority for ${updatedCount} items`
    });

    console.log(`⭐ Updated cache priority for ${updatedCount} items - User: ${userId}`);
  } catch (error) {
    console.error(`❌ Failed to update cache priorities:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to update cache priorities'
    });
  }
}));

module.exports = router;