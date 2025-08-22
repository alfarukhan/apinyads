const redisServiceInstance = require('../services/cache/RedisService');

/**
 * 🚀 REDIS SINGLETON INSTANCE
 * 
 * Centralized Redis instance for the entire application
 * - Same pattern as prisma.js for consistency
 * - Uses existing singleton from RedisService
 * - Ready for use across all services
 */

function getRedisService() {
  return redisServiceInstance;
}

module.exports = {
  redis: redisServiceInstance.redis, // Direct Redis client
  redisService: redisServiceInstance, // Full service with helper methods
  getRedisService
};