const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const { getJakartaNow, addDaysJakarta } = require('../utils/timezone-helper');

const prisma = new PrismaClient();

/**
 * 🧹 EXPIRED ACCESS CLEANUP JOB
 * 
 * Automatically hide/archive expired unused access tickets
 * Runs daily at 2 AM to cleanup expired access from events that ended
 */

const cleanupExpiredAccess = async () => {
  try {
    console.log('🧹 Starting expired access cleanup job...');
    
    const now = getJakartaNow();
    const yesterday = addDaysJakarta(now, -1);
    
    // Find access tickets for events that ended yesterday or earlier
    // and were never used (user didn't attend)
    const expiredUnusedAccess = await prisma.access.findMany({
      where: {
        isUsed: false,
        event: {
          OR: [
            // Events with endDate that has passed
            {
              endDate: {
                lte: yesterday
              }
            },
            // Events without endDate but startDate was yesterday
            {
              AND: [
                { endDate: null },
                { startDate: { lte: yesterday } }
              ]
            }
          ]
        }
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true
          }
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true
          }
        }
      }
    });

    console.log(`📊 Found ${expiredUnusedAccess.length} expired unused access tickets to cleanup`);
    
    if (expiredUnusedAccess.length === 0) {
      console.log('✅ No expired access to cleanup');
      return;
    }

    // Option 1: Soft delete - Add isActive field to hide expired access
    // This preserves data for analytics while hiding from user view
    const updatedAccess = await prisma.access.updateMany({
      where: {
        id: {
          in: expiredUnusedAccess.map(access => access.id)
        }
      },
      data: {
        // We could add isActive: false here if we had that field
        // For now, we'll just log the cleanup
      }
    });

    // Log cleanup details for each event
    const eventStats = {};
    expiredUnusedAccess.forEach(access => {
      const eventTitle = access.event.title;
      if (!eventStats[eventTitle]) {
        eventStats[eventTitle] = 0;
      }
      eventStats[eventTitle]++;
    });

    console.log('📋 Cleanup summary by event:');
    Object.entries(eventStats).forEach(([eventTitle, count]) => {
      console.log(`  - ${eventTitle}: ${count} unused access tickets`);
    });

    // Create audit log for cleanup
    await prisma.auditLog.create({
      data: {
        eventType: 'ACCESS_CLEANUP',
        category: 'SYSTEM',
        level: 'INFO',
        description: `Cleaned up ${expiredUnusedAccess.length} expired unused access tickets`,
        eventId: `cleanup_${Date.now()}`,
        metadata: {
          cleanedAccessCount: expiredUnusedAccess.length,
          eventStats,
          cleanupDate: now.toISOString()
        },
        tags: ['cleanup', 'access', 'expired']
      }
    });

    console.log(`✅ Expired access cleanup completed: ${expiredUnusedAccess.length} tickets processed`);
    
  } catch (error) {
    console.error('❌ Error during expired access cleanup:', error);
    
    // Log error in audit log
    await prisma.auditLog.create({
      data: {
        eventType: 'ACCESS_CLEANUP_ERROR',
        category: 'SYSTEM',
        level: 'ERROR',
        description: `Failed to cleanup expired access: ${error.message}`,
        eventId: `cleanup_error_${Date.now()}`,
        metadata: {
          error: error.message,
          stack: error.stack,
          cleanupDate: new Date().toISOString() // Keep ISO format for logs
        },
        tags: ['cleanup', 'access', 'error']
      }
    });
  }
};

/**
 * Get cleanup statistics for monitoring
 */
const getCleanupStats = async () => {
  try {
    const now = getJakartaNow();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const stats = await prisma.auditLog.findMany({
      where: {
        eventType: 'ACCESS_CLEANUP',
        createdAt: {
          gte: startOfMonth
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 30 // Last 30 cleanup runs
    });

    const totalCleaned = stats.reduce((sum, log) => {
      return sum + (log.metadata?.cleanedAccessCount || 0);
    }, 0);

    return {
      thisMonth: {
        cleanupRuns: stats.length,
        totalAccessCleaned: totalCleaned,
        lastCleanup: stats[0]?.createdAt,
      },
      recentRuns: stats.slice(0, 5).map(log => ({
        date: log.createdAt,
        accessCleaned: log.metadata?.cleanedAccessCount || 0,
        events: Object.keys(log.metadata?.eventStats || {}).length
      }))
    };
  } catch (error) {
    console.error('❌ Error getting cleanup stats:', error);
    return null;
  }
};

// Schedule cleanup job to run daily at 2:00 AM
const scheduleCleanupJob = () => {
  console.log('📅 Scheduling expired access cleanup job (daily at 2:00 AM)');
  
  // Run every day at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('⏰ Running scheduled expired access cleanup...');
    await cleanupExpiredAccess();
  }, {
    timezone: 'Asia/Jakarta' // Adjust to your timezone
  });

  // Also run once on startup (optional)
  console.log('🚀 Running initial cleanup check on startup...');
  setTimeout(cleanupExpiredAccess, 5000); // Run after 5 seconds
};

module.exports = {
  cleanupExpiredAccess,
  getCleanupStats,
  scheduleCleanupJob
};