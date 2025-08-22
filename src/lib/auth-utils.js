/**
 * 🔐 CENTRALIZED AUTHORIZATION UTILITIES
 * 
 * Enterprise-grade authorization helpers to eliminate duplicate logic
 * and ensure consistent permission checking across all routes.
 */

const { AppError } = require('../middleware/errorHandler');

/**
 * Check if user can modify a resource (owner or admin)
 * @param {Object} resource - Resource object with organizerId
 * @param {Object} user - Current user object  
 * @param {string} action - Action being performed (for error message)
 * @throws {AppError} If user doesn't have permission
 */
const requireOwnershipOrAdmin = (resource, user, action = 'access this resource') => {
  if (!resource) {
    throw new AppError('Resource not found', 404);
  }

  if (resource.organizerId !== user.id && user.role !== 'ADMIN') {
    throw new AppError(`Access denied. You can only ${action}.`, 403);
  }
};

/**
 * Check if user can modify event-related resource
 * @param {Object} event - Event object
 * @param {Object} user - Current user object
 * @param {string} action - Action being performed
 * @throws {AppError} If user doesn't have permission
 */
const requireEventOwnershipOrAdmin = (event, user, action = 'access this event') => {
  requireOwnershipOrAdmin(event, user, action);
};

/**
 * Check if user can modify access ticket
 * @param {Object} accessTicket - Access ticket with event relation
 * @param {Object} user - Current user object  
 * @param {string} action - Action being performed
 * @throws {AppError} If user doesn't have permission
 */
const requireAccessTicketPermission = (accessTicket, user, action = 'modify this access ticket') => {
  if (!accessTicket) {
    throw new AppError('Access ticket not found', 404);
  }

  if (accessTicket.event?.organizerId !== user.id && user.role !== 'ADMIN') {
    throw new AppError(`Access denied. Only event organizers can ${action}.`, 403);
  }
};

/**
 * Check if user can modify access tier
 * @param {Object} tier - Access tier with event relation
 * @param {Object} user - Current user object
 * @param {string} action - Action being performed  
 * @throws {AppError} If user doesn't have permission
 */
const requireAccessTierPermission = (tier, user, action = 'modify this access tier') => {
  if (!tier) {
    throw new AppError('Access tier not found', 404);
  }

  if (tier.event?.organizerId !== user.id && user.role !== 'ADMIN') {
    throw new AppError(`Access denied. Only event organizers can ${action}.`, 403);
  }
};

/**
 * Check if user has admin role
 * @param {Object} user - Current user object
 * @param {string} action - Action being performed
 * @throws {AppError} If user is not admin
 */
const requireAdmin = (user, action = 'perform this action') => {
  if (user.role !== 'ADMIN') {
    throw new AppError(`Access denied. Admin privileges required to ${action}.`, 403);
  }
};

/**
 * Check if user has specific role(s)
 * @param {Object} user - Current user object
 * @param {string|string[]} roles - Required role(s)
 * @param {string} action - Action being performed
 * @throws {AppError} If user doesn't have required role
 */
const requireRole = (user, roles, action = 'perform this action') => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  
  if (!allowedRoles.includes(user.role)) {
    throw new AppError(`Access denied. Required role(s): ${allowedRoles.join(', ')} to ${action}.`, 403);
  }
};

/**
 * Check if resource is active
 * @param {Object} resource - Resource object
 * @param {string} resourceType - Type of resource for error message
 * @throws {AppError} If resource is not active
 */
const requireActive = (resource, resourceType = 'Resource') => {
  if (!resource || !resource.isActive) {
    throw new AppError(`${resourceType} not found or not active`, 404);
  }
};

/**
 * Validate resource existence
 * @param {Object} resource - Resource object
 * @param {string} resourceType - Type of resource for error message  
 * @throws {AppError} If resource doesn't exist
 */
const requireExists = (resource, resourceType = 'Resource') => {
  if (!resource) {
    throw new AppError(`${resourceType} not found`, 404);
  }
};

module.exports = {
  requireOwnershipOrAdmin,
  requireEventOwnershipOrAdmin,
  requireAccessTicketPermission,
  requireAccessTierPermission,
  requireAdmin,
  requireRole,
  requireActive,
  requireExists
};