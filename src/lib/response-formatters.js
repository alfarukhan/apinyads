/**
 * 📤 STANDARDIZED API RESPONSE FORMATTERS
 * 
 * Enterprise-grade response formatting to ensure consistency
 * across all API endpoints and match Flutter app expectations.
 * 
 * ✅ FIXED: Auto-converts all timestamps to local time for mobile apps
 */

const { localizeTimestamps, localizeTimestampsArray, nowString } = require('../utils/time-helpers');

/**
 * Standard success response format
 * @param {string} message - Success message
 * @param {*} data - Response data
 * @param {Object} meta - Additional metadata (pagination, etc)
 * @returns {Object} Formatted response
 */
const successResponse = (message, data = null, meta = null) => {
  // ✅ AUTO-LOCALIZE: Convert timestamps to local time for mobile apps
  let localizedData = data;
  if (data) {
    if (Array.isArray(data)) {
      localizedData = localizeTimestampsArray(data);
    } else if (typeof data === 'object') {
      localizedData = localizeTimestamps(data);
    }
  }

  const response = {
    success: true,
    message,
    data: localizedData,
    serverTime: nowString() // Always include server time for debugging
  };

  if (meta) {
    response.meta = meta;
  }

  return response;
};

/**
 * Standard error response format
 * @param {string} message - Error message
 * @param {Array} errors - Array of error details
 * @param {Object} meta - Additional metadata
 * @returns {Object} Formatted error response
 */
const errorResponse = (message, errors = null, meta = null) => {
  const response = {
    success: false,
    message,
    serverTime: nowString() // Always include server time for debugging
  };

  if (errors) {
    response.errors = Array.isArray(errors) ? errors : [errors];
  }

  if (meta) {
    response.meta = meta;
  }

  return response;
};

/**
 * Paginated response format
 * @param {Array} data - Array of data items
 * @param {Object} pagination - Pagination info
 * @param {string} message - Success message
 * @returns {Object} Formatted paginated response
 */
const paginatedResponse = (data, pagination, message = 'Success') => {
  return successResponse(message, data, {
    pagination: {
      currentPage: pagination.page || 1,
      totalPages: pagination.lastPage || 1,
      totalItems: pagination.total || (Array.isArray(data) ? data.length : Object.keys(data)[0] ? data[Object.keys(data)[0]].length : 0),
      itemsPerPage: pagination.limit || 10,
      hasNextPage: pagination.hasNext || false,
      hasPreviousPage: pagination.hasPrevious || false,
    }
  });
};

/**
 * Authentication response format (for login/register)
 * @param {Object} user - User data
 * @param {string} token - JWT token
 * @param {string} message - Success message
 * @returns {Object} Formatted auth response
 */
const authResponse = (user, token, message = 'Authentication successful') => {
  return successResponse(message, {
    user: formatUserData(user),
    token
  });
};

/**
 * User profile response format
 * @param {Object} user - User data
 * @param {string} message - Success message
 * @returns {Object} Formatted user response
 */
const userResponse = (user, message = 'User data retrieved') => {
  return successResponse(message, {
    user: formatUserData(user)
  });
};

/**
 * Events list response format
 * @param {Array} events - Array of events
 * @param {Object} pagination - Pagination info
 * @param {string} message - Success message
 * @returns {Object} Formatted events response
 */
const eventsResponse = (events, pagination = null, message = 'Events retrieved successfully') => {
  const formattedEvents = events.map(formatEventData);
  
  if (pagination) {
    return paginatedResponse(formattedEvents, pagination, message);
  } else {
    return successResponse(message, { events: formattedEvents });
  }
};

/**
 * Single event response format
 * @param {Object} event - Event data
 * @param {string} message - Success message
 * @returns {Object} Formatted event response
 */
const eventResponse = (event, message = 'Event retrieved successfully') => {
  return successResponse(message, {
    data: formatEventData(event)
  });
};

/**
 * Format user data to match Flutter expectations
 * @param {Object} user - Raw user data
 * @returns {Object} Formatted user data
 */
const formatUserData = (user) => {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatar || null, // Flutter expects avatarUrl
    phone: user.phone || null,
    dateOfBirth: user.dateOfBirth || null,
    city: user.city || null,
    country: user.country || null,
    bio: user.bio || null,
    favoriteGenres: user.favoriteGenres || [],
    points: user.points || 0,
    isVerified: user.isVerified || false,
    isActive: user.isActive || true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    // Include count data if available
    ...(user._count && {
      _count: user._count
    })
  };
};

/**
 * Format event data to match Flutter expectations
 * @param {Object} event - Raw event data
 * @returns {Object} Formatted event data
 */
const formatEventData = (event) => {
  if (!event) return null;

  return {
    id: event.id,
    eventName: event.title, // Flutter expects eventName, API has title
    description: event.description || '',
    imageUrl: event.imageUrl || '',
    location: event.location,
    address: event.address || '',
    latitude: event.latitude || 0,
    longitude: event.longitude || 0,
    startDate: event.startDate,
    endDate: event.endDate || null,
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    genres: event.genres || [],
    artists: event.artists || [],
    hasGuestlist: event.hasGuestlist || false,
    isActive: event.isActive || true,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    // Include additional data if available
    ...(event.venue && { venue: event.venue }),
    ...(event.accessTiers && { accessTiers: event.accessTiers }),
    ...(event.organizer && { organizer: formatUserData(event.organizer) }),
    ...(event.artistsData && { artistsData: event.artistsData }),
  };
};

/**
 * Format artist data to match Flutter expectations
 * @param {Object} artist - Raw artist data
 * @returns {Object} Formatted artist data
 */
const formatArtistData = (artist) => {
  if (!artist) return null;

  return {
    id: artist.id,
    name: artist.name,
    description: artist.description || '',
    imageUrl: artist.imageUrl || '',
    genres: artist.genres || [],
    country: artist.country || '',
    city: artist.city || '',
    socialLinks: artist.socialLinks || {},
    isVerified: artist.isVerified || false,
    followersCount: artist.followersCount || 0,
    isActive: artist.isActive || true,
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
  };
};

/**
 * Format venue data to match Flutter expectations
 * @param {Object} venue - Raw venue data
 * @returns {Object} Formatted venue data
 */
const formatVenueData = (venue) => {
  if (!venue) return null;

  return {
    id: venue.id,
    name: venue.name,
    description: venue.description || '',
    imageUrl: venue.imageUrl || '',
    location: venue.location,
    address: venue.address || '',
    latitude: venue.latitude || 0,
    longitude: venue.longitude || 0,
    phone: venue.phone || '',
    website: venue.website || '',
    email: venue.email || '',
    operatingHours: venue.operatingHours || {},
    amenities: venue.amenities || [],
    capacity: venue.capacity || 0,
    isActive: venue.isActive || true,
    createdAt: venue.createdAt,
    updatedAt: venue.updatedAt,
  };
};

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  authResponse,
  userResponse,
  eventsResponse,
  eventResponse,
  formatUserData,
  formatEventData,
  formatArtistData,
  formatVenueData,
};