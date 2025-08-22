const { prisma } = require('../lib/prisma');
const CacheService = require('../services/core/CacheService');
const AuditLogService = require('../services/core/AuditLogService'); // ✅ FIX: Direct import to avoid circular dependency
const { createLogger } = require('../services/core/SmartLogger');

/**
 * 🏗️ BASE REPOSITORY CLASS
 * 
 * Foundation for all data access operations in DanceSignal:
 * - Standardized CRUD operations with caching
 * - Transaction safety & rollback mechanisms
 * - Automatic audit logging for data changes
 * - Query optimization & performance monitoring
 * - Data validation & type safety
 * - Soft delete & recovery capabilities
 * 
 * ✅ Consistency: Same interface for all models
 * ✅ Performance: Intelligent caching & optimization
 * ✅ Security: Audit trails & access control
 * ✅ Reliability: Transaction safety & error handling
 */
class BaseRepository {
  constructor(modelName, options = {}) {
    this.prisma = prisma;
    this.modelName = modelName;
    this.model = this.prisma[modelName];
    
    // ✅ Repository configuration
    this.config = {
      // Caching settings
      enableCaching: options.enableCaching !== false,
      cacheCategory: options.cacheCategory || `${modelName}_cache`,
      cacheTTL: options.cacheTTL || 300, // 5 minutes
      
      // Audit settings
      enableAudit: options.enableAudit !== false,
      auditableFields: options.auditableFields || null, // null = all fields
      
      // Soft delete
      supportsSoftDelete: options.supportsSoftDelete === true,
      softDeleteField: options.softDeleteField || 'deletedAt',
      
      // Pagination
      defaultPageSize: options.defaultPageSize || 20,
      maxPageSize: options.maxPageSize || 100,
      
      // Performance
      enableQueryLogging: options.enableQueryLogging === true,
      queryTimeoutMs: options.queryTimeoutMs || 30000
    };

    this.cacheService = new CacheService();
    // ✅ FIX: Direct instantiation to avoid circular dependency with service factory
    this.auditService = new AuditLogService();
    this.logger = createLogger(`${modelName}Repository`);

    // Only log in debug mode to reduce noise
    this.logger.debug(`Repository initialized`, {
      caching: this.config.enableCaching,
      audit: this.config.enableAudit
    });
  }

  /**
   * 🔍 FIND OPERATIONS
   */
  
  async findById(id, options = {}) {
    const {
      include = null,
      select = null,
      useCache = this.config.enableCaching,
      userId = null
    } = options;

    try {
      // ✅ Generate cache key
      const cacheKey = this.generateCacheKey('findById', { id, include, select });
      
      // ✅ Check cache first
      if (useCache) {
        const cached = await this.cacheService.get(cacheKey, this.config.cacheCategory);
        if (cached) {
          this.logger.debug(`Cache hit: findById(${id})`);
          return cached;
        }
      }

      // ✅ Database query
      const startTime = Date.now();
      const result = await this.model.findUnique({
        where: this.buildWhereClause({ id }),
        include,
        select
      });

      this.logQuery('findById', Date.now() - startTime, { id });

      // ✅ Cache the result
      if (useCache && result) {
        await this.cacheService.set(cacheKey, result, this.config.cacheTTL, this.config.cacheCategory);
      }

      // ✅ Audit log read operation
      if (this.config.enableAudit && result && userId) {
        await this.auditService.logEvent('DATA_READ', {
          userId,
          resourceType: this.modelName,
          resourceId: id,
          action: 'READ',
          metadata: { include, select }
        });
      }

      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.findById error:`, error);
      throw this.handleDatabaseError(error, 'findById', { id });
    }
  }

  async findMany(options = {}) {
    const {
      where = {},
      include = null,
      select = null,
      orderBy = null,
      page = 1,
      limit = this.config.defaultPageSize,
      useCache = this.config.enableCaching,
      userId = null
    } = options;

    try {
      // ✅ Validate pagination
      const validatedLimit = Math.min(limit, this.config.maxPageSize);
      const offset = (page - 1) * validatedLimit;

      // ✅ Generate cache key
      const cacheKey = this.generateCacheKey('findMany', { 
        where, include, select, orderBy, page, limit: validatedLimit 
      });

      // ✅ Check cache first
      if (useCache) {
        const cached = await this.cacheService.get(cacheKey, this.config.cacheCategory);
        if (cached) {
          this.logger.debug(`Cache hit: findMany`);
          return cached;
        }
      }

      // ✅ Database queries
      const startTime = Date.now();
      const whereClause = this.buildWhereClause(where);

      const [items, total] = await Promise.all([
        this.model.findMany({
          where: whereClause,
          include,
          select,
          orderBy: orderBy || { createdAt: 'desc' },
          skip: offset,
          take: validatedLimit
        }),
        this.model.count({ where: whereClause })
      ]);

      this.logQuery('findMany', Date.now() - startTime, { where, page, limit: validatedLimit });

      // ✅ Build result with pagination
      const result = {
        items,
        pagination: {
          page,
          limit: validatedLimit,
          total,
          totalPages: Math.ceil(total / validatedLimit),
          hasNext: page < Math.ceil(total / validatedLimit),
          hasPrev: page > 1
        }
      };

      // ✅ Cache the result
      if (useCache) {
        await this.cacheService.set(cacheKey, result, this.config.cacheTTL, this.config.cacheCategory);
      }

      // ✅ Audit log read operation
      if (this.config.enableAudit && userId) {
        await this.auditService.logEvent('DATA_READ', {
          userId,
          resourceType: this.modelName,
          action: 'LIST',
          metadata: { where, page, limit: validatedLimit, total }
        });
      }

      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.findMany error:`, error);
      throw this.handleDatabaseError(error, 'findMany', { where, page, limit });
    }
  }

  async findFirst(where = {}, options = {}) {
    const {
      include = null,
      select = null,
      orderBy = null,
      useCache = this.config.enableCaching
    } = options;

    try {
      // ✅ Generate cache key
      const cacheKey = this.generateCacheKey('findFirst', { where, include, select, orderBy });

      // ✅ Check cache first
      if (useCache) {
        const cached = await this.cacheService.get(cacheKey, this.config.cacheCategory);
        if (cached) {
          this.logger.debug(`Cache hit: findFirst`);
          return cached;
        }
      }

      // ✅ Database query
      const startTime = Date.now();
      const result = await this.model.findFirst({
        where: this.buildWhereClause(where),
        include,
        select,
        orderBy
      });

      this.logQuery('findFirst', Date.now() - startTime, { where });

      // ✅ Cache the result
      if (useCache && result) {
        await this.cacheService.set(cacheKey, result, this.config.cacheTTL, this.config.cacheCategory);
      }

      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.findFirst error:`, error);
      throw this.handleDatabaseError(error, 'findFirst', { where });
    }
  }

  /**
   * ✨ CREATE OPERATIONS
   */
  
  async create(data, options = {}) {
    const {
      include = null,
      select = null,
      userId = null,
      skipAudit = false
    } = options;

    try {
      // ✅ Data validation
      const validatedData = await this.validateCreateData(data);

      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx[this.modelName].create({
          data: validatedData,
          include,
          select
        });

        // ✅ Audit log creation
        if (this.config.enableAudit && !skipAudit) {
          await this.auditService.logDataChange({
            userId,
            resourceType: this.modelName,
            resourceId: created.id,
            operation: 'CREATE',
            newValues: this.filterAuditableFields(validatedData),
            table: this.modelName
          });
        }

        return created;
      });

      this.logQuery('create', 0, { id: result.id });

      // ✅ Invalidate cache
      await this.invalidateCache('create', result);

      this.logger.debug(`Created: ${result.id}`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.create error:`, error);
      throw this.handleDatabaseError(error, 'create', { data });
    }
  }

  async createMany(dataArray, options = {}) {
    const {
      skipDuplicates = false,
      userId = null,
      skipAudit = false
    } = options;

    try {
      // ✅ Validate all data
      const validatedDataArray = await Promise.all(
        dataArray.map(data => this.validateCreateData(data))
      );

      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx[this.modelName].createMany({
          data: validatedDataArray,
          skipDuplicates
        });

        // ✅ Audit log bulk creation
        if (this.config.enableAudit && !skipAudit) {
          await this.auditService.logEvent('DATA_BULK_CREATE', {
            userId,
            resourceType: this.modelName,
            action: 'BULK_CREATE',
            metadata: { count: created.count, skipDuplicates }
          });
        }

        return created;
      });

      this.logQuery('createMany', 0, { count: result.count });

      // ✅ Invalidate cache
      await this.invalidateCache('createMany');

      this.logger.debug(`Bulk created: ${result.count} items`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.createMany error:`, error);
      throw this.handleDatabaseError(error, 'createMany', { count: dataArray.length });
    }
  }

  /**
   * 🔄 UPDATE OPERATIONS
   */
  
  async update(id, data, options = {}) {
    const {
      include = null,
      select = null,
      userId = null,
      skipAudit = false
    } = options;

    try {
      // ✅ Get current data for audit
      const currentData = this.config.enableAudit && !skipAudit 
        ? await this.findById(id, { useCache: false })
        : null;

      // ✅ Data validation
      const validatedData = await this.validateUpdateData(data, id);

      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx[this.modelName].update({
          where: { id },
          data: validatedData,
          include,
          select
        });

        // ✅ Audit log update
        if (this.config.enableAudit && !skipAudit && currentData) {
          await this.auditService.logDataChange({
            userId,
            resourceType: this.modelName,
            resourceId: id,
            operation: 'UPDATE',
            oldValues: this.filterAuditableFields(currentData),
            newValues: this.filterAuditableFields(validatedData),
            table: this.modelName,
            changedFields: this.getChangedFields(currentData, validatedData)
          });
        }

        return updated;
      });

      this.logQuery('update', 0, { id });

      // ✅ Invalidate cache
      await this.invalidateCache('update', result);

      this.logger.debug(`Updated: ${id}`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.update error:`, error);
      throw this.handleDatabaseError(error, 'update', { id, data });
    }
  }

  async updateMany(where, data, options = {}) {
    const {
      userId = null,
      skipAudit = false
    } = options;

    try {
      // ✅ Data validation
      const validatedData = await this.validateUpdateData(data);

      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx[this.modelName].updateMany({
          where: this.buildWhereClause(where),
          data: validatedData
        });

        // ✅ Audit log bulk update
        if (this.config.enableAudit && !skipAudit) {
          await this.auditService.logEvent('DATA_BULK_UPDATE', {
            userId,
            resourceType: this.modelName,
            action: 'BULK_UPDATE',
            metadata: { where, data: this.filterAuditableFields(validatedData), count: updated.count }
          });
        }

        return updated;
      });

      this.logQuery('updateMany', 0, { count: result.count });

      // ✅ Invalidate cache
      await this.invalidateCache('updateMany');

      this.logger.debug(`Bulk updated: ${result.count} items`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.updateMany error:`, error);
      throw this.handleDatabaseError(error, 'updateMany', { where, data });
    }
  }

  /**
   * 🗑️ DELETE OPERATIONS
   */
  
  async delete(id, options = {}) {
    const {
      userId = null,
      skipAudit = false,
      force = false // For hard delete when soft delete is enabled
    } = options;

    try {
      // ✅ Get current data for audit
      const currentData = this.config.enableAudit && !skipAudit 
        ? await this.findById(id, { useCache: false })
        : null;

      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        let deleted;

        if (this.config.supportsSoftDelete && !force) {
          // ✅ Soft delete
          deleted = await tx[this.modelName].update({
            where: { id },
            data: { [this.config.softDeleteField]: new Date() }
          });
        } else {
          // ✅ Hard delete
          deleted = await tx[this.modelName].delete({
            where: { id }
          });
        }

        // ✅ Audit log deletion
        if (this.config.enableAudit && !skipAudit && currentData) {
          await this.auditService.logDataChange({
            userId,
            resourceType: this.modelName,
            resourceId: id,
            operation: force ? 'HARD_DELETE' : 'DELETE',
            oldValues: this.filterAuditableFields(currentData),
            table: this.modelName
          });
        }

        return deleted;
      });

      this.logQuery('delete', 0, { id, soft: this.config.supportsSoftDelete && !force });

      // ✅ Invalidate cache
      await this.invalidateCache('delete', { id });

      this.logger.debug(`Deleted: ${id} (${force ? 'hard' : 'soft'})`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.delete error:`, error);
      throw this.handleDatabaseError(error, 'delete', { id });
    }
  }

  async deleteMany(where, options = {}) {
    const {
      userId = null,
      skipAudit = false,
      force = false
    } = options;

    try {
      // ✅ Database transaction
      const result = await this.prisma.$transaction(async (tx) => {
        let deleted;

        if (this.config.supportsSoftDelete && !force) {
          // ✅ Soft delete many
          deleted = await tx[this.modelName].updateMany({
            where: this.buildWhereClause(where),
            data: { [this.config.softDeleteField]: new Date() }
          });
        } else {
          // ✅ Hard delete many
          deleted = await tx[this.modelName].deleteMany({
            where: this.buildWhereClause(where)
          });
        }

        // ✅ Audit log bulk deletion
        if (this.config.enableAudit && !skipAudit) {
          await this.auditService.logEvent('DATA_BULK_DELETE', {
            userId,
            resourceType: this.modelName,
            action: force ? 'BULK_HARD_DELETE' : 'BULK_DELETE',
            metadata: { where, count: deleted.count }
          });
        }

        return deleted;
      });

      this.logQuery('deleteMany', 0, { count: result.count, soft: this.config.supportsSoftDelete && !force });

      // ✅ Invalidate cache
      await this.invalidateCache('deleteMany');

      this.logger.debug(`Bulk deleted: ${result.count} items`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.deleteMany error:`, error);
      throw this.handleDatabaseError(error, 'deleteMany', { where });
    }
  }

  /**
   * 🔄 SOFT DELETE RECOVERY
   */
  
  async restore(id, options = {}) {
    if (!this.config.supportsSoftDelete) {
      throw new Error(`${this.modelName} does not support soft delete/restore`);
    }

    const { userId = null } = options;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const restored = await tx[this.modelName].update({
          where: { id },
          data: { [this.config.softDeleteField]: null }
        });

        // ✅ Audit log restoration
        if (this.config.enableAudit) {
          await this.auditService.logEvent('DATA_RESTORED', {
            userId,
            resourceType: this.modelName,
            resourceId: id,
            action: 'RESTORE'
          });
        }

        return restored;
      });

      // ✅ Invalidate cache
      await this.invalidateCache('restore', result);

      this.logger.debug(`Restored: ${id}`);
      return result;

    } catch (error) {
      console.error(`❌ ${this.modelName}.restore error:`, error);
      throw this.handleDatabaseError(error, 'restore', { id });
    }
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  buildWhereClause(where) {
    if (this.config.supportsSoftDelete) {
      // ✅ Automatically exclude soft-deleted records
      return {
        ...where,
        [this.config.softDeleteField]: null
      };
    }
    return where;
  }

  generateCacheKey(operation, params) {
    const keyParts = [this.modelName, operation];
    
    if (params) {
      const paramString = JSON.stringify(params, Object.keys(params).sort());
      const hash = require('crypto').createHash('md5').update(paramString).digest('hex');
      keyParts.push(hash.substring(0, 8));
    }

    return keyParts.join(':');
  }

  async invalidateCache(operation, data = null) {
    if (!this.config.enableCaching) return;

    try {
      // ✅ Invalidate all cache for this model
      await this.cacheService.invalidatePattern(`${this.modelName}:*`, this.config.cacheCategory);
      
      // ✅ Specific invalidations based on operation
      if (data && data.id) {
        await this.cacheService.delete(`${this.modelName}:findById:*`, this.config.cacheCategory);
      }

      this.logger.debug(`Cache invalidated (${operation})`);
    } catch (error) {
      console.error('❌ Cache invalidation error:', error);
    }
  }

  filterAuditableFields(data) {
    if (!this.config.auditableFields) {
      return data; // Audit all fields
    }

    const filtered = {};
    for (const field of this.config.auditableFields) {
      if (field in data) {
        filtered[field] = data[field];
      }
    }
    return filtered;
  }

  getChangedFields(oldData, newData) {
    const changed = [];
    for (const [key, value] of Object.entries(newData)) {
      if (oldData[key] !== value) {
        changed.push(key);
      }
    }
    return changed;
  }

  async validateCreateData(data) {
    // ✅ Override in child classes for model-specific validation
    return data;
  }

  async validateUpdateData(data, id = null) {
    // ✅ Override in child classes for model-specific validation
    return data;
  }

  handleDatabaseError(error, operation, context) {
    // ✅ Enhance error with context
    const enhancedError = new Error(`${this.modelName}.${operation} failed: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.operation = operation;
    enhancedError.context = context;
    enhancedError.modelName = this.modelName;
    
    return enhancedError;
  }

  logQuery(operation, duration, context) {
    if (this.config.enableQueryLogging) {
      console.log(`📊 ${this.modelName}.${operation}: ${duration}ms`, context);
    }
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.prisma.$disconnect();
    this.logger.debug(`Repository cleanup completed`);
  }
}

module.exports = BaseRepository;