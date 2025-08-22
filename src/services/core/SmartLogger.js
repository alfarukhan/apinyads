/**
 * 🎯 SMART LOGGING SERVICE
 * 
 * Clean, configurable logging that reduces noise and provides meaningful information
 * 
 * Features:
 * - Configurable log levels (ERROR, WARN, INFO, DEBUG)
 * - Conditional logging based on environment
 * - Service-specific logging with categories
 * - Performance-aware logging
 * - Clean formatting for development
 */

class SmartLogger {
  constructor(service = 'API', options = {}) {
    this.service = service;
    this.level = process.env.LOG_LEVEL || 'INFO';
    this.enableColors = process.env.NODE_ENV === 'development';
    this.enableTimestamps = options.enableTimestamps !== false;
    this.enableService = options.enableService !== false;
    
    // Log levels hierarchy
    this.levels = {
      ERROR: 0,
      WARN: 1, 
      INFO: 2,
      DEBUG: 3
    };
    
    this.currentLevel = this.levels[this.level] || this.levels.INFO;
  }

  /**
   * 🔴 ERROR - Critical issues that need immediate attention
   */
  error(message, data = null, meta = {}) {
    if (this.currentLevel >= this.levels.ERROR) {
      this._log('ERROR', '❌', message, data, meta);
    }
  }

  /**
   * 🟡 WARN - Important but not critical issues
   */
  warn(message, data = null, meta = {}) {
    if (this.currentLevel >= this.levels.WARN) {
      this._log('WARN', '⚠️', message, data, meta);
    }
  }

  /**
   * 🔵 INFO - Important information for production
   */
  info(message, data = null, meta = {}) {
    if (this.currentLevel >= this.levels.INFO) {
      this._log('INFO', 'ℹ️', message, data, meta);
    }
  }

  /**
   * ⚫ DEBUG - Detailed information for development
   */
  debug(message, data = null, meta = {}) {
    if (this.currentLevel >= this.levels.DEBUG) {
      this._log('DEBUG', '🔍', message, data, meta);
    }
  }

  /**
   * 🚀 STARTUP - Special category for app startup
   */
  startup(message, data = null) {
    if (this.currentLevel >= this.levels.INFO) {
      this._log('STARTUP', '🚀', message, data, { category: 'startup' });
    }
  }

  /**
   * ✅ SUCCESS - Special category for successful operations
   */
  success(message, data = null) {
    if (this.currentLevel >= this.levels.INFO) {
      this._log('SUCCESS', '✅', message, data, { category: 'success' });
    }
  }

  /**
   * 🔧 PERFORMANCE - Performance-related logs
   */
  performance(message, data = null) {
    if (this.currentLevel >= this.levels.DEBUG) {
      this._log('PERF', '⚡', message, data, { category: 'performance' });
    }
  }

  /**
   * Internal logging method
   */
  _log(level, emoji, message, data, meta) {
    const timestamp = this.enableTimestamps ? new Date().toISOString() : '';
    const service = this.enableService ? `[${this.service}]` : '';
    
    let logMessage = '';
    
    if (this.enableColors) {
      // Clean format for development
      logMessage = `${emoji} ${service} ${message}`;
    } else {
      // Structured format for production
      logMessage = `${timestamp} ${level} ${service} ${message}`;
    }

    // Use appropriate console method
    switch (level) {
      case 'ERROR':
        console.error(logMessage, data ? data : '');
        break;
      case 'WARN':
        console.warn(logMessage, data ? data : '');
        break;
      default:
        console.log(logMessage, data ? data : '');
    }

    // Additional meta info in debug mode
    if (meta && Object.keys(meta).length > 0 && this.currentLevel >= this.levels.DEBUG) {
      console.log(`   Meta:`, meta);
    }
  }

  /**
   * 📊 Request logging helper
   */
  request(method, path, statusCode, duration, meta = {}) {
    const emoji = statusCode >= 400 ? '❌' : statusCode >= 300 ? '🔄' : '✅';
    const level = statusCode >= 400 ? 'WARN' : 'INFO';
    
    if (this.currentLevel >= this.levels[level]) {
      this._log(level, emoji, `${method} ${path} ${statusCode} ${duration}ms`, null, meta);
    }
  }

  /**
   * 💾 Database operation logging
   */
  database(operation, table, duration, meta = {}) {
    if (this.currentLevel >= this.levels.DEBUG) {
      this._log('DEBUG', '💾', `${operation} ${table} (${duration}ms)`, null, meta);
    }
  }

  /**
   * 🔒 Security logging
   */
  security(event, details = null, meta = {}) {
    this._log('WARN', '🔒', `Security: ${event}`, details, meta);
  }
}

/**
 * 🏭 Logger Factory
 */
class LoggerFactory {
  static loggers = new Map();

  static getLogger(service = 'API', options = {}) {
    const key = `${service}_${JSON.stringify(options)}`;
    
    if (!this.loggers.has(key)) {
      this.loggers.set(key, new SmartLogger(service, options));
    }
    
    return this.loggers.get(key);
  }

  static setGlobalLevel(level) {
    process.env.LOG_LEVEL = level;
    // Update existing loggers
    for (const logger of this.loggers.values()) {
      logger.level = level;
      logger.currentLevel = logger.levels[level] || logger.levels.INFO;
    }
  }
}

/**
 * 🎯 Quick helpers for common scenarios
 */
const createLogger = (service) => LoggerFactory.getLogger(service);

// Default logger instance
const logger = LoggerFactory.getLogger('DanceSignal');

module.exports = {
  SmartLogger,
  LoggerFactory,
  createLogger,
  logger
};