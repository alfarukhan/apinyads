/**
 * 📝 CENTRALIZED API RESPONSE FORMATTER
 * 
 * Unified response structure for all DanceSignal API endpoints:
 * - Consistent response format
 * - Error handling & sanitization
 * - Pagination metadata
 * - Success/failure indicators
 * - Performance metrics
 * - API versioning support
 * 
 * ✅ Consistency: Same response format everywhere
 * ✅ Security: Error message sanitization
 * ✅ Performance: Response timing & metadata
 */
class ResponseFormatter {
  constructor() {
    // ✅ CENTRALIZED: Response configuration
    this.config = {
      API_VERSION: process.env.API_VERSION || '2.0',
      INCLUDE_TIMING: process.env.INCLUDE_RESPONSE_TIMING !== 'false',
      INCLUDE_REQUEST_ID: process.env.INCLUDE_REQUEST_ID !== 'false',
      SANITIZE_ERRORS: process.env.NODE_ENV === 'production',
      MAX_ERROR_DETAIL_LENGTH: 500,
      
      // Pagination defaults
      DEFAULT_PAGE_SIZE: 20,
      MAX_PAGE_SIZE: 100,
      
      // Status codes
      SUCCESS_CODES: [200, 201, 202, 204],
      ERROR_CODES: [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]
    };

    console.log('📝 ResponseFormatter initialized with config:', {
      apiVersion: this.config.API_VERSION,
      includeTiming: this.config.INCLUDE_TIMING,
      sanitizeErrors: this.config.SANITIZE_ERRORS
    });
  }

  /**
   * ✅ SUCCESS RESPONSE
   * 
   * Standard success response format
   */
  success(res, options = {}) {
    const {
      data = null,
      message = 'Request successful',
      statusCode = 200,
      metadata = {},
      pagination = null,
      requestId = null,
      startTime = null
    } = options;

    const response = {
      success: true,
      status: 'success',
      message: message,
      data: data,
      
      // ✅ API metadata
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    // ✅ Add pagination if provided
    if (pagination) {
      response.pagination = this.formatPagination(pagination);
    }

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * ❌ ERROR RESPONSE
   * 
   * Standard error response format
   */
  error(res, options = {}) {
    const {
      message = 'An error occurred',
      statusCode = 500,
      errorCode = null,
      details = null,
      validationErrors = null,
      requestId = null,
      startTime = null,
      correlationId = null
    } = options;

    const response = {
      success: false,
      status: 'error',
      error: {
        message: this.sanitizeErrorMessage(message),
        code: errorCode || this.getDefaultErrorCode(statusCode),
        statusCode: statusCode
      },
      
      // ✅ API metadata
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add detailed error information (non-production)
    if (!this.config.SANITIZE_ERRORS && details) {
      response.error.details = details;
    }

    // ✅ Add validation errors
    if (validationErrors && Array.isArray(validationErrors)) {
      response.error.validation = validationErrors.map(err => ({
        field: err.field || err.path,
        message: err.message,
        code: err.code || 'VALIDATION_ERROR'
      }));
    }

    // ✅ Add correlation ID for tracking
    if (correlationId) {
      response.error.correlationId = correlationId;
    }

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 📊 PAGINATED RESPONSE
   * 
   * Response with pagination metadata
   */
  paginated(res, options = {}) {
    const {
      data = [],
      page = 1,
      limit = this.config.DEFAULT_PAGE_SIZE,
      total = 0,
      message = 'Data retrieved successfully',
      statusCode = 200,
      metadata = {},
      requestId = null,
      startTime = null
    } = options;

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(total),
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    };

    return this.success(res, {
      data,
      message,
      statusCode,
      metadata: {
        ...metadata,
        recordCount: Array.isArray(data) ? data.length : 0
      },
      pagination,
      requestId,
      startTime
    });
  }

  /**
   * 🔄 ASYNC RESPONSE
   * 
   * For long-running operations
   */
  async(res, options = {}) {
    const {
      jobId,
      message = 'Request accepted for processing',
      statusUrl = null,
      estimatedTime = null,
      statusCode = 202,
      requestId = null,
      startTime = null
    } = options;

    const response = {
      success: true,
      status: 'accepted',
      message: message,
      data: {
        jobId: jobId,
        status: 'processing',
        statusUrl: statusUrl,
        estimatedCompletionTime: estimatedTime
      },
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 📊 BULK OPERATION RESPONSE
   * 
   * For batch operations with mixed results
   */
  bulk(res, options = {}) {
    const {
      results = [],
      successCount = 0,
      failureCount = 0,
      message = 'Bulk operation completed',
      statusCode = 200,
      requestId = null,
      startTime = null
    } = options;

    const response = {
      success: failureCount === 0,
      status: failureCount === 0 ? 'success' : 'partial_success',
      message: message,
      data: {
        results: results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failureCount,
          successRate: results.length > 0 ? (successCount / results.length * 100).toFixed(2) + '%' : '0%'
        }
      },
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 🔍 SEARCH RESPONSE
   * 
   * For search operations with facets and filters
   */
  search(res, options = {}) {
    const {
      data = [],
      query = '',
      filters = {},
      facets = {},
      page = 1,
      limit = this.config.DEFAULT_PAGE_SIZE,
      total = 0,
      searchTime = null,
      message = 'Search completed successfully',
      statusCode = 200,
      requestId = null,
      startTime = null
    } = options;

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(total),
      totalPages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    };

    const response = {
      success: true,
      status: 'success',
      message: message,
      data: data,
      search: {
        query: query,
        filters: filters,
        facets: facets,
        resultCount: Array.isArray(data) ? data.length : 0,
        searchTime: searchTime
      },
      pagination: pagination,
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 📈 ANALYTICS RESPONSE
   * 
   * For analytics and reporting endpoints
   */
  analytics(res, options = {}) {
    const {
      data = {},
      metrics = {},
      charts = [],
      period = {},
      message = 'Analytics data retrieved successfully',
      statusCode = 200,
      requestId = null,
      startTime = null
    } = options;

    const response = {
      success: true,
      status: 'success',
      message: message,
      data: data,
      analytics: {
        metrics: metrics,
        charts: charts,
        period: period,
        generatedAt: new Date().toISOString()
      },
      meta: {
        version: this.config.API_VERSION,
        timestamp: new Date().toISOString()
      }
    };

    // ✅ Add request tracking
    if (this.config.INCLUDE_REQUEST_ID && requestId) {
      response.meta.requestId = requestId;
    }

    // ✅ Add timing information
    if (this.config.INCLUDE_TIMING && startTime) {
      response.meta.responseTime = `${Date.now() - startTime}ms`;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  formatPagination(pagination) {
    return {
      page: parseInt(pagination.page) || 1,
      limit: parseInt(pagination.limit) || this.config.DEFAULT_PAGE_SIZE,
      total: parseInt(pagination.total) || 0,
      totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || this.config.DEFAULT_PAGE_SIZE)),
      hasNext: pagination.hasNext || false,
      hasPrev: pagination.hasPrev || false,
      nextPage: pagination.hasNext ? (parseInt(pagination.page) || 1) + 1 : null,
      prevPage: pagination.hasPrev ? (parseInt(pagination.page) || 1) - 1 : null
    };
  }

  sanitizeErrorMessage(message) {
    if (!this.config.SANITIZE_ERRORS) {
      return message;
    }

    // ✅ Remove sensitive information in production
    const sanitized = String(message)
      .replace(/password/gi, '[REDACTED]')
      .replace(/token/gi, '[REDACTED]')
      .replace(/secret/gi, '[REDACTED]')
      .replace(/key/gi, '[REDACTED]')
      .substring(0, this.config.MAX_ERROR_DETAIL_LENGTH);

    return sanitized || 'An error occurred while processing your request';
  }

  getDefaultErrorCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE'
    };

    return codes[statusCode] || 'UNKNOWN_ERROR';
  }

  /**
   * 📏 VALIDATION HELPERS
   */
  
  validatePaginationParams(query) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(
      this.config.MAX_PAGE_SIZE,
      Math.max(1, parseInt(query.limit) || this.config.DEFAULT_PAGE_SIZE)
    );

    return { page, limit };
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 🎯 MIDDLEWARE INTEGRATION
   */
  
  attachToResponse(req, res, next) {
    // ✅ Attach formatter methods to response object
    res.success = (options = {}) => this.success(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.error = (options = {}) => this.error(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.paginated = (options = {}) => this.paginated(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.async = (options = {}) => this.async(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.bulk = (options = {}) => this.bulk(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.search = (options = {}) => this.search(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    res.analytics = (options = {}) => this.analytics(res, {
      ...options,
      requestId: req.requestId,
      startTime: req.startTime
    });

    // ✅ Add request tracking
    req.requestId = this.generateRequestId();
    req.startTime = Date.now();

    next();
  }
}

module.exports = ResponseFormatter;