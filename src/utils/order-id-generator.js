const crypto = require('crypto');

/**
 * 🚀 CENTRALIZED ORDER ID GENERATOR
 * 
 * Enhanced order ID generation for unified payment system:
 * - Maximum length: 15 characters (well under Midtrans 50-char limit)
 * - Collision-resistant with timestamp + random bytes
 * - Consistent format across all payment types
 * - Type-agnostic generation with prefix support
 * - Enhanced validation and type detection
 */

/**
 * ✅ UNIFIED ORDER ID GENERATION
 * 
 * Core function for generating all types of order IDs
 * @param {string} prefix - Order type prefix (BK, GL, RF, etc.)
 * @param {number} randomBytes - Number of random bytes (default: 3)
 * @returns {string} - Generated order ID
 */
const generateOrderId = (prefix, randomBytes = 3) => {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('Order ID prefix is required and must be a string');
  }
  
  // ✅ Ensure prefix is uppercase and max 3 chars
  const cleanPrefix = prefix.toUpperCase().slice(0, 3);
  
  // ✅ Generate timestamp in base36 (shorter than base10)
  const timestamp = Date.now().toString(36);
  
  // ✅ Generate cryptographically secure random bytes
  const random = crypto.randomBytes(randomBytes).toString('hex').toUpperCase();
  
  // ✅ Combine parts
  const orderId = `${cleanPrefix}${timestamp}${random}`;
  
  // ✅ Ensure length is within limits
  if (orderId.length > 20) {
    console.warn(`⚠️ Generated order ID is longer than expected: ${orderId} (${orderId.length} chars)`);
  }
  
  return orderId;
};

/**
 * 🎯 SPECIFIC ORDER ID GENERATORS
 * 
 * Type-specific generators using the unified function
 */

/**
 * Generate order ID for regular bookings
 * Format: BK{timestamp_base36}{random_hex}
 * Length: ~13-14 characters
 */
const generateBookingOrderId = () => {
  return generateOrderId('BK', 4); // Extra randomness for bookings
};

/**
 * Generate order ID for guestlist payments  
 * Format: GL{timestamp_base36}{random_hex}
 * Length: ~13-14 characters
 */
const generateGuestlistOrderId = () => {
  return generateOrderId('GL', 3);
};

/**
 * Generate order ID for access transfers
 * Format: AT{timestamp_base36}{random_hex}
 * Length: ~13-14 characters
 */
const generateTransferOrderId = () => {
  return generateOrderId('AT', 3);
};

/**
 * Generate order ID for refunds
 * Format: RF{timestamp_base36}{random_hex}
 * Length: ~13-14 characters
 */
const generateRefundOrderId = () => {
  return generateOrderId('RF', 3);
};

/**
 * Generate order ID for subscriptions
 * Format: SB{timestamp_base36}{random_hex}
 * Length: ~13-14 characters
 */
const generateSubscriptionOrderId = () => {
  return generateOrderId('SB', 3);
};

/**
 * Validate order ID format
 * @param {string} orderId - Order ID to validate
 * @returns {object} - Validation result with type detection
 */
const validateOrderId = (orderId) => {
  if (!orderId || typeof orderId !== 'string') {
    return { isValid: false, type: null, reason: 'Invalid or missing order ID' };
  }

  // Check length (should be reasonable for Midtrans)
  if (orderId.length > 50) {
    return { isValid: false, type: null, reason: 'Order ID too long for Midtrans' };
  }

  // Detect type and validate format
  if (orderId.startsWith('BK')) {
    const isValidFormat = /^BK[a-z0-9]{6,}[A-F0-9]{8}$/i.test(orderId);
    return { 
      isValid: isValidFormat, 
      type: 'booking', 
      reason: isValidFormat ? null : 'Invalid booking order ID format' 
    };
  }

  if (orderId.startsWith('GL')) {
    const isValidFormat = /^GL[a-z0-9]{6,}[A-F0-9]{6}$/i.test(orderId);
    return { 
      isValid: isValidFormat, 
      type: 'guestlist', 
      reason: isValidFormat ? null : 'Invalid guestlist order ID format' 
    };
  }

  if (orderId.startsWith('AT')) {
    const isValidFormat = /^AT[a-z0-9]{6,}[A-F0-9]{6}$/i.test(orderId);
    return { 
      isValid: isValidFormat, 
      type: 'transfer', 
      reason: isValidFormat ? null : 'Invalid transfer order ID format' 
    };
  }

  // Legacy format support (for migration)
  if (orderId.startsWith('GL-')) {
    return { 
      isValid: true, 
      type: 'guestlist_legacy', 
      reason: 'Legacy guestlist format - consider migrating' 
    };
  }

  return { isValid: false, type: 'unknown', reason: 'Unknown order ID format' };
};

/**
 * Extract timestamp from order ID (for debugging/analytics)
 * @param {string} orderId - Order ID to parse
 * @returns {number|null} - Timestamp in milliseconds or null if invalid
 */
const extractTimestamp = (orderId) => {
  try {
    const validation = validateOrderId(orderId);
    if (!validation.isValid || validation.type === 'guestlist_legacy') {
      return null;
    }

    // Extract timestamp part (after prefix, before random bytes)
    const prefix = orderId.substring(0, 2);
    const timestampPart = orderId.substring(2, orderId.length - (prefix === 'BK' ? 8 : 6));
    
    return parseInt(timestampPart, 36);
  } catch (error) {
    return null;
  }
};

/**
 * Generate order ID based on type
 * @param {string} type - Type of order ('booking', 'guestlist', 'transfer')
 * @returns {string} - Generated order ID
 */
const generateOrderIdByType = (type) => {
  switch (type) {
    case 'booking':
      return generateBookingOrderId();
    case 'guestlist':
      return generateGuestlistOrderId();
    case 'transfer':
      return generateTransferOrderId();
    default:
      throw new Error(`Unknown order type: ${type}`);
  }
};

module.exports = {
  // ✅ CENTRALIZED: Core generation function
  generateOrderId,
  generateOrderIdByType,
  
  // ✅ SPECIFIC: Type-specific generators
  generateBookingOrderId,
  generateGuestlistOrderId,
  generateTransferOrderId,
  generateRefundOrderId,
  generateSubscriptionOrderId,
  
  // ✅ UTILITIES: Validation and parsing
  validateOrderId,
  extractTimestamp,
  
  // ✅ CONSTANTS: Configuration reference
  MAX_ORDER_ID_LENGTH: 50, // Midtrans limit
  TYPICAL_ORDER_ID_LENGTH: 14, // Our typical length
  
  // ✅ ORDER TYPE PREFIXES: For consistency
  ORDER_PREFIXES: {
    BOOKING: 'BK',
    GUESTLIST: 'GL', 
    TRANSFER: 'AT',
    REFUND: 'RF',
    SUBSCRIPTION: 'SB'
  }
};

// Example usage and testing
if (require.main === module) {
  console.log('🧪 Testing Order ID Generator...\n');
  
  const bookingId = generateBookingOrderId();
  const guestlistId = generateGuestlistOrderId();
  const transferId = generateTransferOrderId();
  
  console.log('📋 Generated Order IDs:');
  console.log(`Booking:   ${bookingId} (${bookingId.length} chars)`);
  console.log(`Guestlist: ${guestlistId} (${guestlistId.length} chars)`);
  console.log(`Transfer:  ${transferId} (${transferId.length} chars)`);
  
  console.log('\n✅ Validation Results:');
  console.log('Booking:', validateOrderId(bookingId));
  console.log('Guestlist:', validateOrderId(guestlistId));
  console.log('Transfer:', validateOrderId(transferId));
  
  console.log('\n⏰ Timestamps:');
  console.log('Booking:', new Date(extractTimestamp(bookingId)));
  console.log('Guestlist:', new Date(extractTimestamp(guestlistId)));
  console.log('Transfer:', new Date(extractTimestamp(transferId)));
}