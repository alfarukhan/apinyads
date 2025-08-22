// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

class PlatformConfigService {
  static instance = null;
  
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
  }
  
  static getInstance() {
    if (!this.instance) {
      this.instance = new PlatformConfigService();
    }
    return this.instance;
  }

  /**
   * Get platform configuration value by key
   * @param {string} key - Configuration key
   * @param {any} defaultValue - Default value if not found
   * @returns {Promise<any>} Configuration value
   */
  async getConfig(key, defaultValue = null) {
    try {
      // Check cache first
      const cacheKey = `config_${key}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && cached.timestamp > Date.now() - this.cacheExpiry) {
        return cached.value;
      }

      // Get from database
      const config = await prisma.platformConfig.findUnique({
        where: { 
          key,
          isActive: true 
        }
      });

      if (!config) {
        console.warn(`⚠️ Platform config not found: ${key}, using default: ${defaultValue}`);
        return defaultValue;
      }

      // Parse value based on data type
      let value = config.value;
      switch (config.dataType) {
        case 'NUMBER':
          value = parseFloat(config.value);
          break;
        case 'BOOLEAN':
          value = config.value.toLowerCase() === 'true';
          break;
        case 'JSON':
          try {
            value = JSON.parse(config.value);
          } catch (e) {
            console.error(`❌ Error parsing JSON config ${key}:`, e);
            value = defaultValue;
          }
          break;
        // STRING is default, no parsing needed
      }

      // Cache the result
      this.cache.set(cacheKey, {
        value,
        timestamp: Date.now()
      });

      return value;
    } catch (error) {
      console.error(`❌ Error getting platform config ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Get multiple configurations at once
   * @param {string[]} keys - Array of configuration keys
   * @returns {Promise<Object>} Object with key-value pairs
   */
  async getConfigs(keys) {
    const results = {};
    await Promise.all(
      keys.map(async (key) => {
        results[key] = await this.getConfig(key);
      })
    );
    return results;
  }

  /**
   * Set platform configuration
   * @param {string} key - Configuration key
   * @param {any} value - Configuration value
   * @param {string} description - Description
   * @param {string} dataType - Data type (STRING, NUMBER, BOOLEAN, JSON)
   * @param {string} updatedBy - User ID who updated
   * @returns {Promise<Object>} Updated configuration
   */
  async setConfig(key, value, description = null, dataType = 'STRING', updatedBy = null) {
    try {
      // Convert value to string for storage
      const stringValue = dataType === 'JSON' ? JSON.stringify(value) : String(value);

      const config = await prisma.platformConfig.upsert({
        where: { key },
        update: {
          value: stringValue,
          description,
          dataType,
          updatedBy,
          updatedAt: new Date()
        },
        create: {
          key,
          value: stringValue,
          description,
          dataType,
          updatedBy
        }
      });

      // Clear cache for this key
      this.cache.delete(`config_${key}`);

      console.log(`✅ Platform config updated: ${key} = ${stringValue}`);
      return config;
    } catch (error) {
      console.error(`❌ Error setting platform config ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get current platform fee amount in rupiah
   * @returns {Promise<number>} Platform fee amount in rupiah
   */
  async getPlatformFeeAmount() {
    return await this.getConfig('PLATFORM_FEE_AMOUNT', 25000); // Default Rp 25,000 in rupiah
  }

  /**
   * Check if platform fee is enabled
   * @returns {Promise<boolean>} Whether platform fee is enabled
   */
  async isPlatformFeeEnabled() {
    return await this.getConfig('PLATFORM_FEE_ENABLED', true);
  }

  /**
   * Get platform fee currency
   * @returns {Promise<string>} Platform fee currency
   */
  async getPlatformFeeCurrency() {
    return await this.getConfig('PLATFORM_FEE_CURRENCY', 'IDR');
  }

  /**
   * Calculate total booking amount with fees
   * @param {number} unitPrice - Price per unit in rupiah
   * @param {number} quantity - Quantity
   * @param {Object} event - Event object with tax configuration
   * @returns {Promise<Object>} Calculation breakdown
   */
  async calculateBookingAmount(unitPrice, quantity, event = null) {
    try {
      // Calculate subtotal
      const subtotalAmount = unitPrice * quantity;

      // Get platform fee
      const isPlatformFeeEnabled = await this.isPlatformFeeEnabled();
      const platformFee = isPlatformFeeEnabled ? await this.getPlatformFeeAmount() : 0;

      // Calculate tax based on event configuration
      let taxAmount = 0;
      if (event && event.taxRate > 0) {
        if (event.taxType === 'PERCENTAGE') {
          // Tax calculated on subtotal only, not on platform fee
          taxAmount = Math.round(subtotalAmount * (event.taxRate / 100));
        } else if (event.taxType === 'FIXED') {
          // Fixed tax amount in rupiah
          taxAmount = Math.round(event.taxRate); // Already in rupiah
        }
      }

      // Calculate total
      const totalAmount = subtotalAmount + platformFee + taxAmount;

      return {
        subtotalAmount,
        platformFee,
        taxAmount,
        totalAmount,
        breakdown: {
          unitPrice,
          quantity,
          subtotal: subtotalAmount,
          platformFee,
          tax: {
            amount: taxAmount,
            rate: event?.taxRate || 0,
            type: event?.taxType || 'PERCENTAGE',
            name: event?.taxName || 'Tax'
          },
          total: totalAmount
        }
      };
    } catch (error) {
      console.error('❌ Error calculating booking amount:', error);
      throw error;
    }
  }

  /**
   * Clear all cached configurations
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Platform config cache cleared');
  }
}

module.exports = PlatformConfigService;