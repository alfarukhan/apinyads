/**
 * Convert Prisma Decimal coordinates to JavaScript numbers
 * Handles Decimal objects, strings, and regular numbers
 */
function convertCoordinatesToNumbers(obj) {
  if (!obj) return obj;
  
  const converted = { ...obj };
  
  // Convert latitude - handle any type that Prisma Decimal might return
  if (converted.latitude !== null && converted.latitude !== undefined) {
    if (typeof converted.latitude === 'object' && converted.latitude.toString) {
      // Prisma Decimal object
      converted.latitude = parseFloat(converted.latitude.toString());
    } else if (typeof converted.latitude === 'string') {
      converted.latitude = parseFloat(converted.latitude);
    } else if (typeof converted.latitude === 'number') {
      // Already a number, keep as is
      converted.latitude = converted.latitude;
    }
  }
  
  // Convert longitude - handle any type that Prisma Decimal might return
  if (converted.longitude !== null && converted.longitude !== undefined) {
    if (typeof converted.longitude === 'object' && converted.longitude.toString) {
      // Prisma Decimal object
      converted.longitude = parseFloat(converted.longitude.toString());
    } else if (typeof converted.longitude === 'string') {
      converted.longitude = parseFloat(converted.longitude);
    } else if (typeof converted.longitude === 'number') {
      // Already a number, keep as is
      converted.longitude = converted.longitude;
    }
  }
  
  return converted;
}

/**
 * Convert coordinates in an array of objects
 */
function convertCoordinatesArray(array) {
  if (!Array.isArray(array)) return array;
  
  return array.map(item => convertCoordinatesToNumbers(item));
}

/**
 * Convert coordinates in nested objects (like venue in event)
 */
function convertNestedCoordinates(obj) {
  if (!obj) return obj;
  
  const converted = convertCoordinatesToNumbers(obj);
  
  // Handle nested venue object
  if (converted.venue) {
    converted.venue = convertCoordinatesToNumbers(converted.venue);
  }
  
  // Handle nested event object
  if (converted.event) {
    converted.event = convertCoordinatesToNumbers(converted.event);
  }
  
  return converted;
}

module.exports = {
  convertCoordinatesToNumbers,
  convertCoordinatesArray,
  convertNestedCoordinates
};