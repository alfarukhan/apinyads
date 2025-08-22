/**
 * 🕐 UNIFIED TIME HELPERS
 * 
 * Ensures consistent local time across all API responses
 * No more UTC confusion for mobile apps!
 */

/**
 * Get current local time as Date object
 */
function now() {
  return new Date();
}

/**
 * Get current local time as string (for responses)
 * Using ISO string format for better Flutter compatibility
 */
function nowString() {
  return new Date().toISOString();
}

/**
 * Get current local time as timestamp
 */
function nowTimestamp() {
  return Date.now();
}

/**
 * Convert any date to local time string
 */
function toLocalString(date) {
  if (!date) return null;
  if (typeof date === 'string') {
    return new Date(date).toString();
  }
  return date.toString();
}

/**
 * Convert database timestamps to local time for API responses
 * Using ISO string format for better Flutter compatibility
 */
function formatApiTimestamp(dbTimestamp) {
  if (!dbTimestamp) return null;
  
  // If already a string and looks like ISO, return as-is
  if (typeof dbTimestamp === 'string' && dbTimestamp.includes('T')) {
    return dbTimestamp;
  }
  
  try {
    const date = new Date(dbTimestamp);
    if (isNaN(date.getTime())) {
      console.log('⚠️ formatApiTimestamp: Invalid date value:', dbTimestamp);
      return null;
    }
    // Use ISO string untuk better Flutter parsing
    return date.toISOString();
  } catch (e) {
    console.log('⚠️ formatApiTimestamp error:', e, 'for value:', dbTimestamp);
    return null;
  }
}

/**
 * Transform object with timestamps to use local time (RECURSIVE)
 */
function localizeTimestamps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(localizeTimestamps);
  }
  
  const localized = { ...obj };
  
  // Common timestamp fields to convert
  const timestampFields = ['createdAt', 'updatedAt', 'paidAt', 'usedAt', 'approvedAt', 'rejectedAt', 'sentAt', 'timestamp', 'dateOfBirth', 'startDate', 'endDate', 'expiresAt', 'expiredAt', 'saleStartDate', 'saleEndDate', 'validUntil', 'lastTransferAt'];
  
  // Convert timestamp fields at this level
  timestampFields.forEach(field => {
    if (localized.hasOwnProperty(field)) {
      // Handle null, undefined values
      if (localized[field] === null || localized[field] === undefined) {
        localized[field] = null;
      } 
      // Handle empty objects {} -> convert to null
      else if (typeof localized[field] === 'object' && 
               localized[field].constructor === Object && 
               Object.keys(localized[field]).length === 0) {
        localized[field] = null;
      } 
      // Handle valid timestamps (Date objects, ISO strings, or timestamps)
      else if (localized[field] instanceof Date || 
               typeof localized[field] === 'string' || 
               typeof localized[field] === 'number') {
        localized[field] = formatApiTimestamp(localized[field]);
      }
    }
  });
  
  // Recursively process nested objects and arrays
  Object.keys(localized).forEach(key => {
    if (localized[key] && typeof localized[key] === 'object') {
      localized[key] = localizeTimestamps(localized[key]);
    }
  });
  
  return localized;
}

/**
 * Transform array of objects with timestamps
 */
function localizeTimestampsArray(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.map(localizeTimestamps);
}

module.exports = {
  now,
  nowString,
  nowTimestamp,
  toLocalString,
  formatApiTimestamp,
  localizeTimestamps,
  localizeTimestampsArray
};
