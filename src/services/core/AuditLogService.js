const { prisma } = require('../../lib/prisma');
const crypto = require('crypto');

/**
 * 📋 CENTRALIZED AUDIT LOG SERVICE
 * 
 * Comprehensive tracking system for DanceSignal:
 * - User actions & operations
 * - Payment transactions & changes
 * - Security events & access attempts
 * - System operations & configurations
 * - Data changes & modifications
 * - Performance & error tracking
 * 
 * ✅ Compliance: Complete audit trail
 * ✅ Security: Tamper-resistant logging
 * ✅ Performance: Async logging with batching
 * ✅ Forensics: Detailed event reconstruction
 */
class AuditLogService {
  constructor() {
    this.prisma = prisma;
    
    // ✅ CENTRALIZED: Audit configuration
    this.config = {
      ENABLE_AUDIT_LOGGING: process.env.ENABLE_AUDIT_LOGGING !== 'false',
      BATCH_SIZE: parseInt(process.env.AUDIT_BATCH_SIZE) || 100,
      FLUSH_INTERVAL_MS: parseInt(process.env.AUDIT_FLUSH_INTERVAL) || 5000, // 5 seconds
      RETENTION_DAYS: parseInt(process.env.AUDIT_RETENTION_DAYS) || 365,
      HASH_SENSITIVE_DATA: process.env.AUDIT_HASH_SENSITIVE !== 'false',
      
      // Log levels
      LOG_LEVELS: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        CRITICAL: 4
      },
      
      // Event categories
      CATEGORIES: {
        AUTHENTICATION: 'auth',
        AUTHORIZATION: 'authz',
        PAYMENT: 'payment',
        USER_ACTION: 'user_action',
        SYSTEM: 'system',
        SECURITY: 'security',
        DATA_CHANGE: 'data_change',
        API_ACCESS: 'api_access'
      }
    };

    // ✅ Event definitions
    this.eventTypes = {
      // Authentication Events
      USER_LOGIN: { category: 'auth', level: 'INFO', description: 'User logged in' },
      USER_LOGOUT: { category: 'auth', level: 'INFO', description: 'User logged out' },
      LOGIN_FAILED: { category: 'security', level: 'WARN', description: 'Login attempt failed' },
      TOKEN_EXPIRED: { category: 'auth', level: 'INFO', description: 'Authentication token expired' },
      SESSION_CREATED: { category: 'auth', level: 'INFO', description: 'User session created' },
      SESSION_TERMINATED: { category: 'auth', level: 'INFO', description: 'User session terminated' },
      
      // Authorization Events
      ACCESS_GRANTED: { category: 'authz', level: 'INFO', description: 'Access granted to resource' },
      ACCESS_DENIED: { category: 'security', level: 'WARN', description: 'Access denied to resource' },
      ROLE_ASSIGNED: { category: 'authz', level: 'INFO', description: 'Role assigned to user' },
      PERMISSION_CHECKED: { category: 'authz', level: 'DEBUG', description: 'Permission check performed' },
      
      // Payment Events
      PAYMENT_CREATED: { category: 'payment', level: 'INFO', description: 'Payment transaction created' },
      PAYMENT_SUCCESS: { category: 'payment', level: 'INFO', description: 'Payment completed successfully' },
      PAYMENT_FAILED: { category: 'payment', level: 'WARN', description: 'Payment transaction failed' },
      PAYMENT_REFUNDED: { category: 'payment', level: 'INFO', description: 'Payment refunded' },
      PAYMENT_VERIFIED: { category: 'payment', level: 'INFO', description: 'Payment verification completed' },
      
      // User Actions
      USER_REGISTERED: { category: 'user_action', level: 'INFO', description: 'New user registered' },
      PROFILE_UPDATED: { category: 'user_action', level: 'INFO', description: 'User profile updated' },
      PASSWORD_CHANGED: { category: 'security', level: 'INFO', description: 'User password changed' },
      EMAIL_VERIFIED: { category: 'user_action', level: 'INFO', description: 'User email verified' },
      
      // Event Operations
      EVENT_CREATED: { category: 'user_action', level: 'INFO', description: 'Event created' },
      EVENT_UPDATED: { category: 'user_action', level: 'INFO', description: 'Event updated' },
      EVENT_DELETED: { category: 'user_action', level: 'INFO', description: 'Event deleted' },
      BOOKING_CREATED: { category: 'user_action', level: 'INFO', description: 'Booking created' },
      BOOKING_CANCELLED: { category: 'user_action', level: 'INFO', description: 'Booking cancelled' },
      
      // Guestlist Operations
      GUESTLIST_REQUEST: { category: 'user_action', level: 'INFO', description: 'Guestlist request submitted' },
      GUESTLIST_APPROVED: { category: 'user_action', level: 'INFO', description: 'Guestlist request approved' },
      GUESTLIST_DENIED: { category: 'user_action', level: 'INFO', description: 'Guestlist request denied' },
      
      // System Events
      SERVER_STARTED: { category: 'system', level: 'INFO', description: 'Server started' },
      SERVER_SHUTDOWN: { category: 'system', level: 'INFO', description: 'Server shutdown' },
      DATABASE_MIGRATION: { category: 'system', level: 'INFO', description: 'Database migration executed' },
      CONFIG_CHANGED: { category: 'system', level: 'INFO', description: 'System configuration changed' },
      
      // Security Events
      SUSPICIOUS_ACTIVITY: { category: 'security', level: 'ERROR', description: 'Suspicious activity detected' },
      RATE_LIMIT_EXCEEDED: { category: 'security', level: 'WARN', description: 'Rate limit exceeded' },
      FRAUD_DETECTED: { category: 'security', level: 'CRITICAL', description: 'Fraudulent activity detected' },
      SECURITY_SCAN: { category: 'security', level: 'INFO', description: 'Security scan performed' },
      SECURITY_RELEVANT_REQUEST: { category: 'security', level: 'WARN', description: 'Security relevant request made' }, // ✅ FIX: Add missing event type
      
      // API Access Events
      API_REQUEST: { category: 'api_access', level: 'DEBUG', description: 'API request processed' },
      API_ERROR: { category: 'api_access', level: 'ERROR', description: 'API request failed' },
      WEBHOOK_RECEIVED: { category: 'api_access', level: 'INFO', description: 'Webhook received' },
      ERROR_OCCURRED: { category: 'system', level: 'ERROR', description: 'System error occurred' }, // ✅ FIX: Add missing event type
      
      // Data Change Events
      DATA_CREATED: { category: 'data_change', level: 'INFO', description: 'Data record created' },
      DATA_UPDATED: { category: 'data_change', level: 'INFO', description: 'Data record updated' },
      DATA_DELETED: { category: 'data_change', level: 'INFO', description: 'Data record deleted' },
      DATA_EXPORT: { category: 'data_change', level: 'INFO', description: 'Data exported' },
      DATA_IMPORT: { category: 'data_change', level: 'INFO', description: 'Data imported' }
    };

    // ✅ Batch processing
    this.eventQueue = [];
    this.isProcessing = false;

    // ✅ Start background processing
    this.startBatchProcessor();

    console.log('📋 AuditLogService initialized:', {
      enabled: this.config.ENABLE_AUDIT_LOGGING,
      batchSize: this.config.BATCH_SIZE,
      flushInterval: this.config.FLUSH_INTERVAL_MS
    });
  }

  /**
   * 📝 LOG AUDIT EVENT
   * 
   * Main method for logging audit events
   */
  async logEvent(eventType, eventData = {}) {
    if (!this.config.ENABLE_AUDIT_LOGGING) {
      return;
    }

    try {
      const eventDefinition = this.eventTypes[eventType];
      if (!eventDefinition) {
        console.warn(`⚠️ Unknown audit event type: ${eventType}`);
        return;
      }

      // ✅ Build audit event
      const auditEvent = {
        eventType,
        category: eventDefinition.category,
        level: eventDefinition.level,
        description: eventDefinition.description,
        timestamp: new Date(),
        eventId: this.generateEventId(),
        sessionId: eventData.sessionId || null,
        userId: eventData.userId || null,
        ipAddress: eventData.ipAddress || null,
        userAgent: eventData.userAgent || null,
        correlationId: eventData.correlationId || null,
        
        // Event-specific data
        resourceType: eventData.resourceType || null,
        resourceId: eventData.resourceId || null,
        action: eventData.action || null,
        
        // Change tracking
        oldValues: eventData.oldValues ? this.sanitizeData(eventData.oldValues) : null,
        newValues: eventData.newValues ? this.sanitizeData(eventData.newValues) : null,
        
        // Context & metadata
        metadata: eventData.metadata || {},
        tags: eventData.tags || [],
        
        // Request context
        requestId: eventData.requestId || null,
        endpoint: eventData.endpoint || null,
        method: eventData.method || null,
        statusCode: eventData.statusCode || null,
        responseTime: eventData.responseTime || null,
        
        // Security context
        riskLevel: eventData.riskLevel || 'LOW',
        fraudScore: eventData.fraudScore || null,
        
        // Hash for integrity verification
        integrity: null // Will be calculated before storage
      };

      // ✅ Calculate integrity hash
      auditEvent.integrity = this.calculateIntegrityHash(auditEvent);

      // ✅ Add to batch queue
      this.eventQueue.push(auditEvent);

      // ✅ Immediate flush for critical events
      if (eventDefinition.level === 'CRITICAL' || eventDefinition.level === 'ERROR') {
        await this.flushEventQueue();
      }

      return auditEvent.eventId;

    } catch (error) {
      console.error('❌ Audit logging failed:', error);
      // Don't throw - audit failures shouldn't break main functionality
    }
  }

  /**
   * 🔒 AUTHENTICATION EVENT HELPERS
   */
  
  async logUserLogin(userId, sessionData = {}) {
    return await this.logEvent('USER_LOGIN', {
      userId,
      sessionId: sessionData.sessionId,
      ipAddress: sessionData.ipAddress,
      userAgent: sessionData.userAgent,
      metadata: {
        deviceId: sessionData.deviceId,
        platform: sessionData.platform
      }
    });
  }

  async logUserLogout(userId, sessionData = {}) {
    return await this.logEvent('USER_LOGOUT', {
      userId,
      sessionId: sessionData.sessionId,
      ipAddress: sessionData.ipAddress,
      metadata: {
        reason: sessionData.reason || 'user_initiated'
      }
    });
  }

  async logLoginFailed(attemptData) {
    return await this.logEvent('LOGIN_FAILED', {
      ipAddress: attemptData.ipAddress,
      userAgent: attemptData.userAgent,
      metadata: {
        identifier: this.hashSensitiveData(attemptData.identifier),
        reason: attemptData.reason,
        attemptCount: attemptData.attemptCount
      },
      riskLevel: attemptData.attemptCount > 3 ? 'HIGH' : 'MEDIUM'
    });
  }

  /**
   * 💰 PAYMENT EVENT HELPERS
   */
  
  async logPaymentCreated(paymentData) {
    return await this.logEvent('PAYMENT_CREATED', {
      userId: paymentData.userId,
      resourceType: 'payment',
      resourceId: paymentData.paymentId,
      correlationId: paymentData.correlationId,
      metadata: {
        amount: paymentData.amount,
        currency: paymentData.currency,
        paymentMethod: paymentData.paymentMethod,
        eventId: paymentData.eventId,
        type: paymentData.type
      }
    });
  }

  async logPaymentSuccess(paymentData) {
    return await this.logEvent('PAYMENT_SUCCESS', {
      userId: paymentData.userId,
      resourceType: 'payment',
      resourceId: paymentData.paymentId,
      correlationId: paymentData.correlationId,
      metadata: {
        amount: paymentData.amount,
        transactionId: paymentData.transactionId,
        processingTime: paymentData.processingTime
      }
    });
  }

  async logPaymentFailed(paymentData) {
    return await this.logEvent('PAYMENT_FAILED', {
      userId: paymentData.userId,
      resourceType: 'payment',
      resourceId: paymentData.paymentId,
      correlationId: paymentData.correlationId,
      metadata: {
        amount: paymentData.amount,
        failureReason: paymentData.failureReason,
        errorCode: paymentData.errorCode
      },
      riskLevel: 'MEDIUM'
    });
  }

  /**
   * 🛡️ SECURITY EVENT HELPERS
   */
  
  async logAccessDenied(accessData) {
    return await this.logEvent('ACCESS_DENIED', {
      userId: accessData.userId,
      resourceType: accessData.resourceType,
      resourceId: accessData.resourceId,
      ipAddress: accessData.ipAddress,
      endpoint: accessData.endpoint,
      method: accessData.method,
      metadata: {
        requiredPermission: accessData.permission,
        userRole: accessData.userRole,
        reason: accessData.reason
      },
      riskLevel: 'MEDIUM'
    });
  }

  async logSuspiciousActivity(activityData) {
    return await this.logEvent('SUSPICIOUS_ACTIVITY', {
      userId: activityData.userId,
      ipAddress: activityData.ipAddress,
      userAgent: activityData.userAgent,
      metadata: {
        activityType: activityData.activityType,
        description: activityData.description,
        indicators: activityData.indicators
      },
      riskLevel: 'HIGH',
      fraudScore: activityData.fraudScore
    });
  }

  /**
   * 📊 DATA CHANGE HELPERS
   */
  
  async logDataChange(changeData) {
    const eventType = changeData.operation === 'CREATE' ? 'DATA_CREATED' :
                     changeData.operation === 'UPDATE' ? 'DATA_UPDATED' :
                     changeData.operation === 'DELETE' ? 'DATA_DELETED' : 'DATA_UPDATED';

    return await this.logEvent(eventType, {
      userId: changeData.userId,
      resourceType: changeData.resourceType,
      resourceId: changeData.resourceId,
      action: changeData.operation,
      oldValues: changeData.oldValues,
      newValues: changeData.newValues,
      metadata: {
        table: changeData.table,
        changedFields: changeData.changedFields
      }
    });
  }

  /**
   * 🌐 API ACCESS HELPERS
   */
  
  async logApiRequest(requestData) {
    if (requestData.statusCode >= 400) {
      return await this.logEvent('API_ERROR', {
        userId: requestData.userId,
        requestId: requestData.requestId,
        endpoint: requestData.endpoint,
        method: requestData.method,
        statusCode: requestData.statusCode,
        responseTime: requestData.responseTime,
        ipAddress: requestData.ipAddress,
        userAgent: requestData.userAgent,
        metadata: {
          errorMessage: requestData.errorMessage,
          errorCode: requestData.errorCode
        }
      });
    } else {
      return await this.logEvent('API_REQUEST', {
        userId: requestData.userId,
        requestId: requestData.requestId,
        endpoint: requestData.endpoint,
        method: requestData.method,
        statusCode: requestData.statusCode,
        responseTime: requestData.responseTime,
        ipAddress: requestData.ipAddress
      });
    }
  }

  /**
   * 🔄 BATCH PROCESSING
   */
  
  startBatchProcessor() {
    setInterval(async () => {
      if (this.eventQueue.length > 0 && !this.isProcessing) {
        await this.flushEventQueue();
      }
    }, this.config.FLUSH_INTERVAL_MS);
  }

  async flushEventQueue() {
    if (this.eventQueue.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const batch = this.eventQueue.splice(0, this.config.BATCH_SIZE);

    try {
      await this.prisma.auditLog.createMany({
        data: batch
      });

      console.log(`📋 Audit log batch processed: ${batch.length} events`);

    } catch (error) {
      console.error('❌ Audit log batch processing failed:', {
        errorMessage: error.message,
        errorType: error.constructor.name,
        batchSize: batch.length,
        queueSize: this.eventQueue.length,
        enableAuditLogging: this.config.ENABLE_AUDIT_LOGGING,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      // Re-queue events for retry
      this.eventQueue.unshift(...batch);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 🔍 AUDIT QUERIES
   */
  
  async searchAuditLogs(filters = {}) {
    const {
      userId,
      category,
      eventType,
      startDate,
      endDate,
      resourceType,
      resourceId,
      level,
      page = 1,
      limit = 50
    } = filters;

    const where = {};
    
    if (userId) where.userId = userId;
    if (category) where.category = category;
    if (eventType) where.eventType = eventType;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    if (level) where.level = level;
    
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      this.prisma.auditLog.count({ where })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async getUserActivity(userId, days = 30) {
    const startDate = new Date();
    
    return await this.prisma.auditLog.findMany({
      where: {
        userId,
        timestamp: { gte: startDate }
      },
      orderBy: { timestamp: 'desc' },
      take: 100
    });
  }

  async getSecurityEvents(hours = 24) {
    const startDate = new Date();
    
    return await this.prisma.auditLog.findMany({
      where: {
        category: 'security',
        timestamp: { gte: startDate }
      },
      orderBy: { timestamp: 'desc' }
    });
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  generateEventId() {
    return `audit_${Math.random().toString(36).substr(2, 9)}_${crypto.randomBytes(8).toString('hex')}`;
  }

  calculateIntegrityHash(event) {
    const dataToHash = `${event.eventType}|${event.timestamp.toISOString()}|${event.userId}|${JSON.stringify(event.metadata)}`;
    return crypto.createHash('sha256').update(dataToHash).digest('hex');
  }

  sanitizeData(data) {
    if (!this.config.HASH_SENSITIVE_DATA) {
      return data;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'key', 'ssn', 'creditCard'];
    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = this.hashSensitiveData(sanitized[field]);
      }
    }

    return sanitized;
  }

  hashSensitiveData(data) {
    return crypto.createHash('sha256').update(String(data)).digest('hex').substring(0, 16) + '...';
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    // ✅ Flush remaining events
    await this.flushEventQueue();
    
    // ✅ Clean old audit logs
    const cutoffDate = new Date(Date.now() - this.config.RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const deletedCount = await this.prisma.auditLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate }
      }
    });

    console.log(`🧹 Audit log cleanup: deleted ${deletedCount.count} old records`);
    
    await this.prisma.$disconnect();
    console.log('✅ AuditLogService cleanup completed');
  }
}

module.exports = AuditLogService;