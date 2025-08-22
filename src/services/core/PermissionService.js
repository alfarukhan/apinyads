const { PrismaClient } = require('@prisma/client');

/**
 * 🛡️ CENTRALIZED PERMISSION SERVICE
 * 
 * Advanced role-based access control (RBAC) for DanceSignal:
 * - Permission checking & validation
 * - Resource-based authorization
 * - Dynamic permission computation
 * - Audit logging for access control
 * - Fine-grained access control
 * 
 * ✅ Security: Principle of least privilege
 * ✅ Scalability: Cached permission computations
 * ✅ Flexibility: Resource-specific permissions
 */
class PermissionService {
  constructor() {
    // ✅ ENTERPRISE: Use centralized singleton
const { prisma } = require('../../../lib/prisma');
    this.prisma = prisma; // new PrismaClient();
    
    // ✅ CENTRALIZED: Permission definitions
    this.permissions = {
      // User Management
      'read:users': 'View user profiles and data',
      'create:users': 'Create new user accounts',
      'update:users': 'Update any user profile',
      'delete:users': 'Delete user accounts',
      'update:own_profile': 'Update own profile',
      'read:own_profile': 'Read own profile',
      
      // Event Management
      'read:events': 'View events',
      'create:events': 'Create new events',
      'update:events': 'Update any event',
      'delete:events': 'Delete any event',
      'manage:own_events': 'Manage own events only',
      'approve:events': 'Approve/reject events',
      
      // Booking Management
      'create:bookings': 'Create event bookings',
      'read:bookings': 'View any booking',
      'read:own_bookings': 'View own bookings',
      'update:bookings': 'Update any booking',
      'cancel:bookings': 'Cancel any booking',
      'cancel:own_bookings': 'Cancel own bookings',
      
      // Payment Management
      'read:payments': 'View payment data',
      'process:payments': 'Process payment transactions',
      'refund:payments': 'Issue payment refunds',
      'read:own_payments': 'View own payment history',
      
      // Guestlist Management
      'manage:guestlist': 'Manage event guestlists',
      'approve:guestlist': 'Approve/deny guestlist requests',
      'read:guestlist': 'View guestlist data',
      
      // Access Control
      'create:access': 'Create access tickets',
      'revoke:access': 'Revoke access tickets',
      'transfer:access': 'Transfer access tickets',
      'read:access': 'View access tickets',
      'read:own_access': 'View own access tickets',
      
      // Analytics & Reports
      'read:analytics': 'View analytics dashboards',
      'read:reports': 'Generate and view reports',
      'export:data': 'Export system data',
      
      // Administration
      'manage:platform': 'Platform configuration',
      'manage:roles': 'Assign user roles',
      'read:audit_logs': 'View audit logs',
      'manage:system': 'System administration',
      
      // Content Management
      'create:content': 'Create news, challenges, rewards',
      'update:content': 'Update any content',
      'delete:content': 'Delete any content',
      'moderate:content': 'Moderate user content',
      
      // Special Permissions
      '*': 'Full system access (superadmin)'
    };

    // ✅ CENTRALIZED: Role definitions
    this.roles = {
      USER: {
        name: 'Regular User',
        permissions: [
          'read:own_profile', 'update:own_profile',
          'read:events', 'create:bookings', 'read:own_bookings', 'cancel:own_bookings',
          'read:own_payments', 'read:own_access', 'transfer:access'
        ],
        description: 'Standard user with basic access'
      },
      
      ORGANIZER: {
        name: 'Event Organizer',
        permissions: [
          // User permissions
          'read:own_profile', 'update:own_profile',
          'read:events', 'create:bookings', 'read:own_bookings', 'cancel:own_bookings',
          'read:own_payments', 'read:own_access', 'transfer:access',
          // Organizer permissions
          'create:events', 'manage:own_events', 'manage:guestlist', 'approve:guestlist',
          'read:analytics', 'read:reports'
        ],
        description: 'Event organizer with event management capabilities'
      },
      
      MODERATOR: {
        name: 'Content Moderator',
        permissions: [
          // User permissions
          'read:own_profile', 'update:own_profile',
          'read:events', 'create:bookings', 'read:own_bookings',
          'read:own_payments', 'read:own_access',
          // Moderator permissions
          'moderate:content', 'read:users', 'read:bookings',
          'read:guestlist', 'read:access'
        ],
        description: 'Content moderator with limited admin access'
      },
      
      ADMIN: {
        name: 'Administrator',
        permissions: ['*'],
        description: 'Full system administrator'
      }
    };

    // ✅ Performance: Permission cache
    this.permissionCache = new Map();
    this.cacheTimeout = 10 * 60 * 1000; // 10 minutes

    console.log('🛡️ PermissionService initialized with roles:', Object.keys(this.roles));
  }

  /**
   * 🔍 CHECK PERMISSION
   * 
   * Main permission checking method
   */
  async checkPermission(userContext, permission, resource = null) {
    try {
      // ✅ Admin bypass
      if (this.hasRole(userContext, 'ADMIN')) {
        console.log(`🛡️ Admin access granted for ${permission}`);
        return { allowed: true, reason: 'Administrator access' };
      }

      // ✅ Check cache first
      const cacheKey = this.getCacheKey(userContext.id, permission, resource);
      if (this.permissionCache.has(cacheKey)) {
        const cached = this.permissionCache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          return cached.result;
        }
        this.permissionCache.delete(cacheKey);
      }

      // ✅ Check basic role permissions
      const rolePermissions = this.getRolePermissions(userContext.role);
      const hasBasicPermission = this.hasPermissionInList(permission, rolePermissions);
      
      if (!hasBasicPermission) {
        const result = { allowed: false, reason: `Role ${userContext.role} does not have permission: ${permission}` };
        this.cachePermissionResult(cacheKey, result);
        return result;
      }

      // ✅ Resource-specific authorization
      if (resource) {
        const resourceCheck = await this.checkResourcePermission(userContext, permission, resource);
        this.cachePermissionResult(cacheKey, resourceCheck);
        return resourceCheck;
      }

      // ✅ Permission granted
      const result = { allowed: true, reason: `Role ${userContext.role} has permission: ${permission}` };
      this.cachePermissionResult(cacheKey, result);
      return result;

    } catch (error) {
      console.error('❌ Permission check error:', error);
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * 🎯 RESOURCE-SPECIFIC PERMISSION CHECKS
   */
  
  async checkResourcePermission(userContext, permission, resource) {
    const { type, id, ownerId } = resource;

    switch (type) {
      case 'event':
        return await this.checkEventPermission(userContext, permission, id, ownerId);
      
      case 'booking':
        return await this.checkBookingPermission(userContext, permission, id, ownerId);
      
      case 'access':
        return await this.checkAccessPermission(userContext, permission, id, ownerId);
      
      case 'guestlist':
        return await this.checkGuestlistPermission(userContext, permission, id, ownerId);
      
      case 'user':
        return await this.checkUserPermission(userContext, permission, id);
      
      default:
        return { allowed: false, reason: `Unknown resource type: ${type}` };
    }
  }

  async checkEventPermission(userContext, permission, eventId, ownerId) {
    // ✅ Owner can manage own events
    if (ownerId === userContext.id && permission.includes('own_events')) {
      return { allowed: true, reason: 'Event owner access' };
    }

    // ✅ Specific event permission checks
    if (permission === 'update:events' || permission === 'delete:events') {
      if (ownerId !== userContext.id && !this.hasRole(userContext, 'ADMIN')) {
        return { allowed: false, reason: 'Can only modify own events' };
      }
    }

    return { allowed: true, reason: 'Event permission granted' };
  }

  async checkBookingPermission(userContext, permission, bookingId, ownerId) {
    // ✅ Users can only access their own bookings (unless admin/organizer)
    if (permission.includes('own_bookings')) {
      if (ownerId !== userContext.id) {
        return { allowed: false, reason: 'Can only access own bookings' };
      }
    }

    // ✅ Organizers can view bookings for their events
    if (this.hasRole(userContext, 'ORGANIZER') && permission === 'read:bookings') {
      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: { event: { select: { organizerId: true } } }
      });
      
      if (booking?.event?.organizerId === userContext.id) {
        return { allowed: true, reason: 'Event organizer can view bookings' };
      }
    }

    return { allowed: true, reason: 'Booking permission granted' };
  }

  async checkAccessPermission(userContext, permission, accessId, ownerId) {
    // ✅ Users can only manage their own access tickets
    if (permission.includes('own_access')) {
      if (ownerId !== userContext.id) {
        return { allowed: false, reason: 'Can only manage own access tickets' };
      }
    }

    return { allowed: true, reason: 'Access permission granted' };
  }

  async checkGuestlistPermission(userContext, permission, guestlistId, ownerId) {
    // ✅ Organizers can manage guestlists for their events
    if (this.hasRole(userContext, 'ORGANIZER')) {
      const guestlist = await this.prisma.guestList.findUnique({
        where: { id: guestlistId },
        include: { event: { select: { organizerId: true } } }
      });
      
      if (guestlist?.event?.organizerId === userContext.id) {
        return { allowed: true, reason: 'Event organizer can manage guestlist' };
      }
    }

    return { allowed: false, reason: 'Insufficient permissions for guestlist' };
  }

  async checkUserPermission(userContext, permission, targetUserId) {
    // ✅ Users can only update their own profile
    if (permission === 'update:own_profile') {
      if (targetUserId !== userContext.id) {
        return { allowed: false, reason: 'Can only update own profile' };
      }
    }

    return { allowed: true, reason: 'User permission granted' };
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  hasRole(userContext, roleName) {
    return userContext.role === roleName;
  }

  getRolePermissions(roleName) {
    const role = this.roles[roleName];
    return role ? role.permissions : [];
  }

  hasPermissionInList(permission, permissionList) {
    return permissionList.includes('*') || permissionList.includes(permission);
  }

  getCacheKey(userId, permission, resource) {
    const resourceKey = resource ? `${resource.type}_${resource.id}` : 'no_resource';
    return `perm_${userId}_${permission}_${resourceKey}`;
  }

  cachePermissionResult(cacheKey, result) {
    this.permissionCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * 🎭 ROLE MANAGEMENT
   */
  
  async assignRole(userId, roleName, assignedBy) {
    try {
      if (!this.roles[roleName]) {
        throw new Error(`Invalid role: ${roleName}`);
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: { role: roleName }
      });

      // ✅ Log role assignment
      console.log(`🎭 Role ${roleName} assigned to user ${userId} by ${assignedBy}`);
      
      // ✅ Clear permission cache for user
      this.clearUserPermissionCache(userId);

      return { success: true, role: roleName };

    } catch (error) {
      console.error('❌ Error assigning role:', error);
      throw error;
    }
  }

  /**
   * 📋 PERMISSION UTILITIES
   */
  
  getAvailablePermissions() {
    return Object.keys(this.permissions).map(key => ({
      permission: key,
      description: this.permissions[key]
    }));
  }

  getAvailableRoles() {
    return Object.keys(this.roles).map(key => ({
      role: key,
      ...this.roles[key]
    }));
  }

  getUserEffectivePermissions(userContext) {
    const rolePermissions = this.getRolePermissions(userContext.role);
    
    if (rolePermissions.includes('*')) {
      return Object.keys(this.permissions);
    }
    
    return rolePermissions;
  }

  /**
   * 🧹 CACHE MANAGEMENT
   */
  
  clearUserPermissionCache(userId) {
    for (const [key] of this.permissionCache) {
      if (key.includes(`perm_${userId}_`)) {
        this.permissionCache.delete(key);
      }
    }
  }

  clearAllPermissionCache() {
    this.permissionCache.clear();
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.prisma.$disconnect();
    this.permissionCache.clear();
    console.log('✅ PermissionService cleanup completed');
  }
}

module.exports = PermissionService;