/**
 * 👤 CENTRALIZED USER SELECTION OBJECTS
 * 
 * Enterprise-grade user field selectors to ensure consistency
 * across all database queries and eliminate duplicate selections.
 */

// =============================
// BASIC USER SELECTORS
// =============================

/**
 * Basic user info (public profile)
 */
const basicUserSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  isVerified: true,
  createdAt: true,
};

/**
 * User profile info (authenticated user viewing profile)
 */
const profileUserSelect = {
  ...basicUserSelect,
  email: true,
  phone: true,
  bio: true,
  city: true,
  country: true,
  dateOfBirth: true,
  gender: true,
  favoriteGenres: true,
  points: true,
  role: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  status: true,
};

/**
 * Admin user view (includes sensitive fields)
 */
const adminUserSelect = {
  ...profileUserSelect,
  isActive: true,
  suspendedUntil: true,
  banReason: true,
  fcmTokens: true,
  updatedAt: true,
};

/**
 * Authentication user select (for login/register)
 */
const authUserSelect = {
  id: true,
  email: true,
  username: true,
  password: true, // Only used during auth, removed before response
  firstName: true,
  lastName: true,
  avatar: true,
  city: true,
  points: true,
  role: true,
  isVerified: true,
  isActive: true,
  createdAt: true,
};

/**
 * User select without password (for responses)
 */
const safeUserSelect = {
  id: true,
  email: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  city: true,
  points: true,
  role: true,
  isVerified: true,
  isActive: true,
  createdAt: true,
};

// =============================
// USER SELECTORS WITH RELATIONS
// =============================

/**
 * User with follower counts
 */
const userWithCountsSelect = {
  ...profileUserSelect,
  _count: {
    select: {
      followers: true,
      follows: true,
      eventRegistrations: true,
      posts: true,
      accessTickets: true,
      events: true,
    }
  }
};

/**
 * Event organizer info
 */
const organizerSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  isVerified: true,
  role: true,
};

/**
 * User info for access tickets
 */
const accessUserSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  email: true, // Sometimes needed for ticket validation
};

/**
 * User info for transfers
 */
const transferUserSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
};

/**
 * User info for comments and posts
 */
const authorSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  isVerified: true,
};

/**
 * User info for chat
 */
const chatUserSelect = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  avatar: true,
  isActive: true,
};

// =============================
// DYNAMIC SELECTOR BUILDERS
// =============================

/**
 * Get user selector based on context and permissions
 * @param {string} context - Context: 'public', 'profile', 'admin', 'auth'
 * @param {Object} user - Current user (for permission checking)
 * @param {string} targetUserId - Target user ID (for permission checking)
 * @returns {Object} Appropriate user selector
 */
const getUserSelector = (context, user = null, targetUserId = null) => {
  switch (context) {
    case 'admin':
      return adminUserSelect;
    
    case 'auth':
      return authUserSelect;
    
    case 'profile':
      // If viewing own profile or admin, return full profile
      if (user && (user.id === targetUserId || user.role === 'ADMIN')) {
        return profileUserSelect;
      }
      // Otherwise return basic info
      return basicUserSelect;
    
    case 'public':
    default:
      return basicUserSelect;
  }
};

/**
 * Get user selector with counts
 * @param {string} context - Context for base selector
 * @param {Object} user - Current user
 * @param {string} targetUserId - Target user ID
 * @returns {Object} User selector with counts
 */
const getUserWithCountsSelector = (context, user = null, targetUserId = null) => {
  const baseSelect = getUserSelector(context, user, targetUserId);
  
  return {
    ...baseSelect,
    _count: {
      select: {
        followers: true,
        follows: true,
        eventRegistrations: true,
        posts: true,
        accessTickets: true,
        events: true,
      }
    }
  };
};

module.exports = {
  // Basic selectors
  basicUserSelect,
  profileUserSelect,
  adminUserSelect,
  authUserSelect,
  safeUserSelect,
  
  // Relational selectors
  userWithCountsSelect,
  organizerSelect,
  accessUserSelect,
  transferUserSelect,
  authorSelect,
  chatUserSelect,
  
  // Dynamic builders
  getUserSelector,
  getUserWithCountsSelector,
};