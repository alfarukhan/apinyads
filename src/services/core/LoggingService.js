const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * 📝 CENTRALIZED LOGGING SERVICE
 * 
 * Professional structured logging system for DanceSignal:
 * - Multi-level logging (DEBUG, INFO, WARN, ERROR, CRITICAL)
 * - Structured JSON logs with metadata
 * - Request correlation tracking
 * - Performance metrics & timing
 * - Log rotation & archival
 * - Real-time log streaming
 * - Security & audit logging
 * 
 * ✅ Observability: Complete system visibility
 * ✅ Performance: Async logging with batching
 * ✅ Security: Sensitive data redaction
 * ✅ Compliance: Audit trail & retention
 */
class LoggingService {
  // ✅ Store original console methods before they get overridden by middleware
  static originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  // ✅ FIX: Static flag to prevent multiple signal handler registrations
  static _signalHandlersRegistered = false;

  constructor() {
    // ✅ CENTRALIZED: Logging configuration
    this.config = {
      // Log Levels
      LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
      ENABLE_CONSOLE: process.env.LOG_ENABLE_CONSOLE !== 'false',
      ENABLE_FILE: process.env.LOG_ENABLE_FILE !== 'false',
      
      // File Logging
      LOG_DIR: process.env.LOG_DIR || './logs',
      LOG_FILE_PREFIX: process.env.LOG_FILE_PREFIX || 'dancesignal',
      MAX_FILE_SIZE_MB: parseInt(process.env.LOG_MAX_FILE_SIZE_MB) || 50,
      MAX_FILES: parseInt(process.env.LOG_MAX_FILES) || 10,
      
      // Batch Processing
      BATCH_SIZE: parseInt(process.env.LOG_BATCH_SIZE) || 100,
      FLUSH_INTERVAL_MS: parseInt(process.env.LOG_FLUSH_INTERVAL) || 1000, // 1 second
      
      // Security
      REDACT_SENSITIVE: process.env.LOG_REDACT_SENSITIVE !== 'false',
      SENSITIVE_FIELDS: ['password', 'token', 'secret', 'key', 'authorization', 'cookie'],
      
      // Performance
      ENABLE_PERFORMANCE_LOGGING: process.env.LOG_ENABLE_PERFORMANCE !== 'false',
      SLOW_QUERY_THRESHOLD_MS: parseInt(process.env.LOG_SLOW_QUERY_THRESHOLD) || 1000,
      
      // Structured Logging
      INCLUDE_STACK_TRACE: process.env.LOG_INCLUDE_STACK !== 'false',
      INCLUDE_MEMORY_USAGE: process.env.LOG_INCLUDE_MEMORY === 'true',
      CORRELATION_ID_HEADER: 'x-correlation-id'
    };

    // ✅ Log level hierarchy
    this.logLevels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      CRITICAL: 4
    };

    this.currentLogLevel = this.logLevels[this.config.LOG_LEVEL] || this.logLevels.INFO;

    // ✅ Log buffers for batching
    this.logBuffer = [];
    this.isFlushingLogs = false;

    // ✅ File handles & rotation
    this.currentLogFile = null;
    this.currentFileSize = 0;

    // ✅ Performance tracking
    this.performanceMetrics = {
      totalLogs: 0,
      logsByLevel: {},
      averageLogTime: 0,
      lastFlushTime: Date.now()
    };

    // ✅ Request context storage
    this.requestContexts = new Map();

    // ✅ Initialize logging system
    this.initializeLogging();

    console.log('📝 LoggingService initialized:', {
      level: this.config.LOG_LEVEL,
      console: this.config.ENABLE_CONSOLE,
      file: this.config.ENABLE_FILE,
      logDir: this.config.LOG_DIR
    });
  }

  /**
   * 🏗️ INITIALIZATION
   */
  async initializeLogging() {
    try {
      // ✅ Create log directory
      if (this.config.ENABLE_FILE) {
        await fs.mkdir(this.config.LOG_DIR, { recursive: true });
        await this.rotateLogFileIfNeeded();
      }

      // ✅ Start log flushing
      this.startLogFlushing();

      // ✅ Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      console.error('❌ LoggingService initialization failed:', error);
    }
  }

  /**
   * 📊 MAIN LOGGING METHODS
   */
  
  debug(message, metadata = {}, context = {}) {
    return this.log('DEBUG', message, metadata, context);
  }

  info(message, metadata = {}, context = {}) {
    return this.log('INFO', message, metadata, context);
  }

  warn(message, metadata = {}, context = {}) {
    return this.log('WARN', message, metadata, context);
  }

  error(message, metadata = {}, context = {}) {
    return this.log('ERROR', message, metadata, context);
  }

  critical(message, metadata = {}, context = {}) {
    return this.log('CRITICAL', message, metadata, context);
  }

  /**
   * 🎯 SPECIALIZED LOGGING METHODS
   */
  
  logRequest(req, res, startTime = Date.now()) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    const logData = {
      type: 'HTTP_REQUEST',
      method: req.method,
      url: req.url,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id,
      correlationId: req.requestId || this.generateCorrelationId(),
      
      // Request metadata
      requestSize: req.get('Content-Length') || 0,
      responseSize: res.get('Content-Length') || 0,
      
      // Performance classification
      performance: this.classifyRequestPerformance(duration),
      
      // Security metadata
      authenticated: !!req.user,
      userRole: req.user?.role
    };

    // ✅ Log based on status code and duration
    if (res.statusCode >= 500) {
      this.error('HTTP Request - Server Error', logData);
    } else if (res.statusCode >= 400) {
      this.warn('HTTP Request - Client Error', logData);
    } else if (duration > this.config.SLOW_QUERY_THRESHOLD_MS) {
      this.warn('HTTP Request - Slow Response', logData);
    } else {
      this.info('HTTP Request', logData);
    }

    return logData;
  }

  logDatabaseQuery(operation, table, duration, metadata = {}) {
    const logData = {
      type: 'DATABASE_QUERY',
      operation,
      table,
      duration: `${duration}ms`,
      performance: this.classifyQueryPerformance(duration),
      ...metadata
    };

    if (duration > this.config.SLOW_QUERY_THRESHOLD_MS) {
      this.warn('Database Query - Slow', logData);
    } else {
      this.debug('Database Query', logData);
    }

    return logData;
  }

  logAuthentication(event, userId, metadata = {}) {
    const logData = {
      type: 'AUTHENTICATION',
      event,
      userId,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    switch (event) {
      case 'LOGIN_SUCCESS':
        this.info('User Login Successful', logData);
        break;
      case 'LOGIN_FAILURE':
        this.warn('User Login Failed', logData);
        break;
      case 'LOGOUT':
        this.info('User Logout', logData);
        break;
      case 'TOKEN_EXPIRED':
        this.debug('Token Expired', logData);
        break;
      default:
        this.info('Authentication Event', logData);
    }

    return logData;
  }

  logPayment(event, paymentData, metadata = {}) {
    const logData = {
      type: 'PAYMENT',
      event,
      paymentId: paymentData.paymentId,
      amount: paymentData.amount,
      currency: paymentData.currency || 'IDR',
      userId: paymentData.userId,
      status: paymentData.status,
      ...metadata
    };

    // ✅ Redact sensitive payment info
    if (this.config.REDACT_SENSITIVE) {
      logData.paymentMethod = paymentData.paymentMethod ? 'REDACTED' : undefined;
      logData.cardDetails = 'REDACTED';
    }

    switch (event) {
      case 'PAYMENT_CREATED':
        this.info('Payment Created', logData);
        break;
      case 'PAYMENT_SUCCESS':
        this.info('Payment Successful', logData);
        break;
      case 'PAYMENT_FAILED':
        this.error('Payment Failed', logData);
        break;
      case 'PAYMENT_REFUNDED':
        this.info('Payment Refunded', logData);
        break;
      default:
        this.info('Payment Event', logData);
    }

    return logData;
  }

  logSecurity(event, metadata = {}) {
    const logData = {
      type: 'SECURITY',
      event,
      timestamp: new Date().toISOString(),
      severity: this.getSecuritySeverity(event),
      ...metadata
    };

    switch (logData.severity) {
      case 'CRITICAL':
        this.critical('Security Event - Critical', logData);
        break;
      case 'HIGH':
        this.error('Security Event - High', logData);
        break;
      case 'MEDIUM':
        this.warn('Security Event - Medium', logData);
        break;
      default:
        this.info('Security Event', logData);
    }

    return logData;
  }

  logPerformance(operation, duration, metadata = {}) {
    const logData = {
      type: 'PERFORMANCE',
      operation,
      duration: `${duration}ms`,
      performance: this.classifyPerformance(duration),
      ...metadata
    };

    if (this.config.ENABLE_PERFORMANCE_LOGGING) {
      if (duration > 5000) { // > 5 seconds
        this.error('Performance - Very Slow', logData);
      } else if (duration > 1000) { // > 1 second
        this.warn('Performance - Slow', logData);
      } else {
        this.debug('Performance', logData);
      }
    }

    return logData;
  }

  /**
   * 🎯 CORE LOGGING METHOD
   */
  log(level, message, metadata = {}, context = {}) {
    // ✅ Check if level should be logged
    if (this.logLevels[level] < this.currentLogLevel) {
      return;
    }

    const timestamp = new Date();
    const correlationId = context.correlationId || this.generateCorrelationId();

    // ✅ Build structured log entry
    const logEntry = {
      timestamp: timestamp.toISOString(),
      level,
      message,
      correlationId,
      
      // Process information
      pid: process.pid,
      hostname: require('os').hostname(),
      service: 'dancesignal-api',
      version: process.env.API_VERSION || '2.0',
      
      // Request context
      ...context,
      
      // Metadata (sanitized)
      metadata: this.sanitizeMetadata(metadata),
      
      // Performance data
      ...(this.config.INCLUDE_MEMORY_USAGE && { 
        memoryUsage: process.memoryUsage() 
      }),
      
      // Stack trace for errors
      ...(level === 'ERROR' || level === 'CRITICAL') && this.config.INCLUDE_STACK_TRACE && {
        stack: new Error().stack
      }
    };

    // ✅ Add to buffer for batch processing
    this.logBuffer.push(logEntry);

    // ✅ Console output for immediate feedback
    if (this.config.ENABLE_CONSOLE) {
      this.outputToConsole(logEntry);
    }

    // ✅ Update metrics
    this.updateMetrics(level);

    // ✅ Force flush for critical logs
    if (level === 'CRITICAL' || level === 'ERROR') {
      setImmediate(() => this.flushLogs());
    }

    return correlationId;
  }

  /**
   * 📁 FILE LOGGING & ROTATION
   */
  async flushLogs() {
    if (this.isFlushingLogs || this.logBuffer.length === 0) {
      return;
    }

    this.isFlushingLogs = true;

    try {
      const logsToFlush = this.logBuffer.splice(0, this.config.BATCH_SIZE);
      
      if (this.config.ENABLE_FILE) {
        await this.writeLogsToFile(logsToFlush);
      }

      this.performanceMetrics.lastFlushTime = Date.now();

    } catch (error) {
      console.error('❌ Log flushing failed:', error);
      // Re-add logs back to buffer for retry
      this.logBuffer.unshift(...logsToFlush);
    } finally {
      this.isFlushingLogs = false;
    }
  }

  async writeLogsToFile(logs) {
    try {
      await this.rotateLogFileIfNeeded();

      const logLines = logs.map(log => JSON.stringify(log)).join('\n') + '\n';
      const logData = Buffer.from(logLines, 'utf8');

      await fs.appendFile(this.currentLogFile, logData);
      this.currentFileSize += logData.length;

    } catch (error) {
      console.error('❌ Failed to write logs to file:', error);
      throw error;
    }
  }

  async rotateLogFileIfNeeded() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const expectedFileName = path.join(
      this.config.LOG_DIR,
      `${this.config.LOG_FILE_PREFIX}-${dateStr}.log`
    );

    // ✅ Check if we need to rotate (new day or file size)
    const needsRotation = !this.currentLogFile || 
                         this.currentLogFile !== expectedFileName ||
                         this.currentFileSize > this.config.MAX_FILE_SIZE_MB * 1024 * 1024;

    if (needsRotation) {
      this.currentLogFile = expectedFileName;
      this.currentFileSize = 0;

      // ✅ Get current file size if it exists
      try {
        const stats = await fs.stat(this.currentLogFile);
        this.currentFileSize = stats.size;
      } catch (error) {
        // File doesn't exist, will be created
      }

      // ✅ Clean up old log files
      await this.cleanupOldLogFiles();
    }
  }

  async cleanupOldLogFiles() {
    try {
      const files = await fs.readdir(this.config.LOG_DIR);
      const logFiles = files
        .filter(file => file.startsWith(this.config.LOG_FILE_PREFIX))
        .map(file => ({
          name: file,
          path: path.join(this.config.LOG_DIR, file),
          stat: null
        }));

      // ✅ Get file stats
      for (const file of logFiles) {
        try {
          file.stat = await fs.stat(file.path);
        } catch (error) {
          // Skip files we can't stat
        }
      }

      // ✅ Sort by creation time and remove old files
      const validFiles = logFiles.filter(f => f.stat).sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      if (validFiles.length > this.config.MAX_FILES) {
        const filesToDelete = validFiles.slice(this.config.MAX_FILES);
        
        for (const file of filesToDelete) {
          try {
            await fs.unlink(file.path);
            console.log(`🗑️ Deleted old log file: ${file.name}`);
          } catch (error) {
            console.error(`❌ Failed to delete log file ${file.name}:`, error);
          }
        }
      }

    } catch (error) {
      console.error('❌ Log cleanup failed:', error);
    }
  }

  /**
   * 🎨 OUTPUT FORMATTING
   */
  outputToConsole(logEntry) {
    const { timestamp, level, message, correlationId, metadata } = logEntry;
    
    // ✅ Color coding for console
    const colors = {
      DEBUG: '\x1b[36m',   // Cyan
      INFO: '\x1b[32m',    // Green
      WARN: '\x1b[33m',    // Yellow
      ERROR: '\x1b[31m',   // Red
      CRITICAL: '\x1b[35m' // Magenta
    };

    const resetColor = '\x1b[0m';
    const color = colors[level] || '';
    
    const timeStr = new Date(timestamp).toLocaleTimeString();
    const correlationStr = correlationId ? ` [${correlationId.substring(0, 8)}]` : '';
    
    let output = `${color}${timeStr} ${level.padEnd(8)}${resetColor} ${message}${correlationStr}`;
    
    // ✅ Add metadata for errors and warnings
    if ((level === 'ERROR' || level === 'WARN' || level === 'CRITICAL') && Object.keys(metadata).length > 0) {
      output += `\n  ${JSON.stringify(metadata, null, 2)}`;
    }

    LoggingService.originalConsole.log(output);
  }

  /**
   * 🛠️ UTILITY METHODS
   */
  
  sanitizeMetadata(metadata) {
    if (!this.config.REDACT_SENSITIVE) {
      return metadata;
    }

    const sanitized = { ...metadata };
    
    for (const field of this.config.SENSITIVE_FIELDS) {
      if (sanitized[field]) {
        sanitized[field] = 'REDACTED';
      }
    }

    return sanitized;
  }

  generateCorrelationId() {
    return `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  classifyRequestPerformance(duration) {
    if (duration > 5000) return 'VERY_SLOW';
    if (duration > 1000) return 'SLOW';
    if (duration > 500) return 'MODERATE';
    return 'FAST';
  }

  classifyQueryPerformance(duration) {
    if (duration > 2000) return 'VERY_SLOW';
    if (duration > 500) return 'SLOW';
    if (duration > 100) return 'MODERATE';
    return 'FAST';
  }

  classifyPerformance(duration) {
    if (duration > 10000) return 'VERY_SLOW';
    if (duration > 5000) return 'SLOW';
    if (duration > 1000) return 'MODERATE';
    return 'FAST';
  }

  getSecuritySeverity(event) {
    const severityMap = {
      'BREACH_ATTEMPT': 'CRITICAL',
      'BRUTE_FORCE': 'HIGH',
      'SUSPICIOUS_ACTIVITY': 'HIGH',
      'RATE_LIMIT_EXCEEDED': 'MEDIUM',
      'INVALID_TOKEN': 'MEDIUM',
      'ACCESS_DENIED': 'LOW'
    };

    return severityMap[event] || 'LOW';
  }

  updateMetrics(level) {
    this.performanceMetrics.totalLogs++;
    this.performanceMetrics.logsByLevel[level] = (this.performanceMetrics.logsByLevel[level] || 0) + 1;
  }

  /**
   * 🔄 BACKGROUND PROCESSING
   */
  startLogFlushing() {
    setInterval(() => {
      if (this.logBuffer.length > 0) {
        this.flushLogs();
      }
    }, this.config.FLUSH_INTERVAL_MS);
  }

  setupGracefulShutdown() {
    // ✅ FIX: Don't register signal handlers - let server.js handle them
    // This prevents EventEmitter memory leaks from multiple instances
    console.log('📝 LoggingService: Signal handlers managed by main server');
  }

  // ✅ Expose flush method for external shutdown handlers
  async gracefulShutdown() {
    console.log('📝 LoggingService: Flushing remaining logs...');
    await this.flushLogs();
  }

  /**
   * 📊 METRICS & MONITORING
   */
  getMetrics() {
    return {
      ...this.performanceMetrics,
      bufferSize: this.logBuffer.length,
      currentLogFile: this.currentLogFile,
      currentFileSize: `${Math.round(this.currentFileSize / 1024)}KB`,
      isFlushingLogs: this.isFlushingLogs
    };
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup() {
    await this.flushLogs();
    console.log('✅ LoggingService cleanup completed');
  }
}

module.exports = LoggingService;