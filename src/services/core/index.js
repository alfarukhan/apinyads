/**
 * 🚀 CENTRALIZED SERVICES INDEX
 * 
 * Central export point for all core DanceSignal services
 * Provides easy imports and service initialization
 */

const PaymentService = require('./PaymentService');
const PaymentValidator = require('./PaymentValidator');
const PaymentRepository = require('./PaymentRepository');
const ErrorHandler = require('./ErrorHandler');
const AuthenticationService = require('./AuthenticationService');
const PermissionService = require('./PermissionService');
const NotificationService = require('./NotificationService');
const ResponseFormatter = require('./ResponseFormatter');
const ExternalAPIGateway = require('./ExternalAPIGateway');
const AuditLogService = require('./AuditLogService');
const AssetManagerService = require('./AssetManagerService');
const CacheService = require('./CacheService');
const RateLimitService = require('./RateLimitService');
const ConfigService = require('./ConfigService');
const QueueService = require('./QueueService');
const LoggingService = require('./LoggingService');
const CacheInvalidationService = require('./CacheInvalidationService');
const PaymentValidationService = require('./PaymentValidationService');
const BusinessValidationService = require('./BusinessValidationService');
const UnifiedErrorHandler = require('./UnifiedErrorHandler');
const UnifiedInputValidation = require('./UnifiedInputValidation');
const SessionManager = require('./SessionManager');
const NotificationTemplateService = require('./NotificationTemplateService');
const SecureCredentialManager = require('./SecureCredentialManager');
const TransactionManager = require('./TransactionManager');
const MonitoringDashboard = require('./MonitoringDashboard');

/**
 * 🏭 SERVICE FACTORY
 * 
 * Creates and configures service instances with proper dependencies
 */
class ServiceFactory {
  constructor() {
    this.instances = new Map();
  }

  /**
   * 💰 Get Payment Service Instance
   * 
   * Singleton pattern for PaymentService
   */
  getPaymentService() {
    if (!this.instances.has('PaymentService')) {
      this.instances.set('PaymentService', new PaymentService());
    }
    return this.instances.get('PaymentService');
  }

  /**
   * 🛡️ Get Payment Validator Instance
   */
  getPaymentValidator() {
    if (!this.instances.has('PaymentValidator')) {
      this.instances.set('PaymentValidator', new PaymentValidator());
    }
    return this.instances.get('PaymentValidator');
  }

  /**
   * 🗄️ Get Payment Repository Instance
   */
  getPaymentRepository() {
    if (!this.instances.has('PaymentRepository')) {
      this.instances.set('PaymentRepository', new PaymentRepository());
    }
    return this.instances.get('PaymentRepository');
  }

  /**
   * 🚨 Get Error Handler Instance
   */
  getErrorHandler() {
    if (!this.instances.has('ErrorHandler')) {
      this.instances.set('ErrorHandler', new ErrorHandler());
    }
    return this.instances.get('ErrorHandler');
  }

  /**
   * 🔐 Get Authentication Service Instance
   */
  getAuthenticationService() {
    if (!this.instances.has('AuthenticationService')) {
      this.instances.set('AuthenticationService', new AuthenticationService());
    }
    return this.instances.get('AuthenticationService');
  }

  /**
   * 🛡️ Get Permission Service Instance
   */
  getPermissionService() {
    if (!this.instances.has('PermissionService')) {
      this.instances.set('PermissionService', new PermissionService());
    }
    return this.instances.get('PermissionService');
  }

  /**
   * 📬 Get Notification Service Instance
   */
  getNotificationService() {
    if (!this.instances.has('NotificationService')) {
      this.instances.set('NotificationService', new NotificationService());
    }
    return this.instances.get('NotificationService');
  }

  /**
   * 📝 Get Response Formatter Instance
   */
  getResponseFormatter() {
    if (!this.instances.has('ResponseFormatter')) {
      this.instances.set('ResponseFormatter', new ResponseFormatter());
    }
    return this.instances.get('ResponseFormatter');
  }

  /**
   * 🌐 Get External API Gateway Instance
   */
  getExternalAPIGateway() {
    if (!this.instances.has('ExternalAPIGateway')) {
      this.instances.set('ExternalAPIGateway', new ExternalAPIGateway());
    }
    return this.instances.get('ExternalAPIGateway');
  }

  /**
   * 📋 Get Audit Log Service Instance
   */
  getAuditLogService() {
    if (!this.instances.has('AuditLogService')) {
      this.instances.set('AuditLogService', new AuditLogService());
    }
    return this.instances.get('AuditLogService');
  }

  /**
   * 📁 Get Asset Manager Service Instance
   */
  getAssetManagerService() {
    if (!this.instances.has('AssetManagerService')) {
      this.instances.set('AssetManagerService', new AssetManagerService());
    }
    return this.instances.get('AssetManagerService');
  }

  /**
   * 💾 Get Cache Service Instance
   */
  getCacheService() {
    if (!this.instances.has('CacheService')) {
      this.instances.set('CacheService', new CacheService());
    }
    return this.instances.get('CacheService');
  }

  /**
   * 🚦 Get Rate Limit Service Instance
   */
  getRateLimitService() {
    if (!this.instances.has('RateLimitService')) {
      this.instances.set('RateLimitService', new RateLimitService());
    }
    return this.instances.get('RateLimitService');
  }

  /**
   * ⚙️ Get Config Service Instance
   */
  getConfigService() {
    if (!this.instances.has('ConfigService')) {
      this.instances.set('ConfigService', new ConfigService());
    }
    return this.instances.get('ConfigService');
  }

  /**
   * 🚀 Get Queue Service Instance
   */
  getQueueService() {
    if (!this.instances.has('QueueService')) {
      this.instances.set('QueueService', new QueueService());
    }
    return this.instances.get('QueueService');
  }

  /**
   * 📝 Get Logging Service Instance
   */
  getLoggingService() {
    if (!this.instances.has('LoggingService')) {
      this.instances.set('LoggingService', new LoggingService());
    }
    return this.instances.get('LoggingService');
  }

  /**
   * 🔥 Get Cache Invalidation Service Instance
   */
  getCacheInvalidationService() {
    if (!this.instances.has('CacheInvalidationService')) {
      this.instances.set('CacheInvalidationService', new CacheInvalidationService());
    }
    return this.instances.get('CacheInvalidationService');
  }

  /**
   * 💳 Get Payment Validation Service Instance
   */
  getPaymentValidationService() {
    if (!this.instances.has('PaymentValidationService')) {
      this.instances.set('PaymentValidationService', new PaymentValidationService());
    }
    return this.instances.get('PaymentValidationService');
  }

  /**
   * 🏢 Get Business Validation Service Instance
   */
  getBusinessValidationService() {
    if (!this.instances.has('BusinessValidationService')) {
      this.instances.set('BusinessValidationService', new BusinessValidationService());
    }
    return this.instances.get('BusinessValidationService');
  }

  /**
   * 🛡️ Get Unified Error Handler Instance
   */
  getUnifiedErrorHandler() {
    if (!this.instances.has('UnifiedErrorHandler')) {
      this.instances.set('UnifiedErrorHandler', new UnifiedErrorHandler());
    }
    return this.instances.get('UnifiedErrorHandler');
  }

  /**
   * ✅ Get Unified Input Validation Instance
   */
  getUnifiedInputValidation() {
    if (!this.instances.has('UnifiedInputValidation')) {
      this.instances.set('UnifiedInputValidation', new UnifiedInputValidation());
    }
    return this.instances.get('UnifiedInputValidation');
  }

  /**
   * 🔒 Get Session Manager Instance
   */
  getSessionManager() {
    if (!this.instances.has('SessionManager')) {
      this.instances.set('SessionManager', new SessionManager());
    }
    return this.instances.get('SessionManager');
  }

  /**
   * 📧 Get Notification Template Service Instance
   */
  getNotificationTemplateService() {
    if (!this.instances.has('NotificationTemplateService')) {
      this.instances.set('NotificationTemplateService', new NotificationTemplateService());
    }
    return this.instances.get('NotificationTemplateService');
  }

  /**
   * 🔐 Get Secure Credential Manager Instance
   */
  getSecureCredentialManager() {
    if (!this.instances.has('SecureCredentialManager')) {
      this.instances.set('SecureCredentialManager', new SecureCredentialManager());
    }
    return this.instances.get('SecureCredentialManager');
  }

  /**
   * 🔄 Get Transaction Manager Instance
   */
  getTransactionManager() {
    if (!this.instances.has('TransactionManager')) {
      this.instances.set('TransactionManager', new TransactionManager());
    }
    return this.instances.get('TransactionManager');
  }

  /**
   * 📊 Get Monitoring Dashboard Instance
   */
  getMonitoringDashboard() {
    if (!this.instances.has('MonitoringDashboard')) {
      this.instances.set('MonitoringDashboard', new MonitoringDashboard());
    }
    return this.instances.get('MonitoringDashboard');
  }

  /**
   * 🧹 Cleanup All Services
   */
  async cleanup() {
    for (const [name, instance] of this.instances) {
      if (instance.cleanup && typeof instance.cleanup === 'function') {
        try {
          await instance.cleanup();
          console.log(`✅ Cleaned up ${name}`);
        } catch (error) {
          console.error(`❌ Error cleaning up ${name}:`, error);
        }
      }
    }
    this.instances.clear();
  }
}

// ✅ Global service factory instance
const serviceFactory = new ServiceFactory();

/**
 * 🎯 CONVENIENCE EXPORTS
 * 
 * Easy access to services and classes
 */
module.exports = {
  // Service Classes
  PaymentService,
  PaymentValidator,
  PaymentRepository,
  ErrorHandler,
  AuthenticationService,
  PermissionService,
  NotificationService,
  ResponseFormatter,
  ExternalAPIGateway,
  AuditLogService,
  AssetManagerService,
  CacheService,
  RateLimitService,
  ConfigService,
  QueueService,
  LoggingService,
  CacheInvalidationService,
  PaymentValidationService,
  BusinessValidationService,
  UnifiedErrorHandler,
  UnifiedInputValidation,
  SessionManager,
  NotificationTemplateService,
  SecureCredentialManager,
  TransactionManager,
  MonitoringDashboard,
  
  // Service Factory
  ServiceFactory,
  serviceFactory,
  
  // Convenience getters
  getPaymentService: () => serviceFactory.getPaymentService(),
  getPaymentValidator: () => serviceFactory.getPaymentValidator(),
  getPaymentRepository: () => serviceFactory.getPaymentRepository(),
  getErrorHandler: () => serviceFactory.getErrorHandler(),
  getAuthenticationService: () => serviceFactory.getAuthenticationService(),
  getPermissionService: () => serviceFactory.getPermissionService(),
  getNotificationService: () => serviceFactory.getNotificationService(),
  getResponseFormatter: () => serviceFactory.getResponseFormatter(),
  getExternalAPIGateway: () => serviceFactory.getExternalAPIGateway(),
  getAuditLogService: () => serviceFactory.getAuditLogService(),
  getAssetManagerService: () => serviceFactory.getAssetManagerService(),
  getCacheService: () => serviceFactory.getCacheService(),
  getRateLimitService: () => serviceFactory.getRateLimitService(),
  getConfigService: () => serviceFactory.getConfigService(),
  getQueueService: () => serviceFactory.getQueueService(),
  getLoggingService: () => serviceFactory.getLoggingService(),
  getCacheInvalidationService: () => serviceFactory.getCacheInvalidationService(),
  getPaymentValidationService: () => serviceFactory.getPaymentValidationService(),
  getBusinessValidationService: () => serviceFactory.getBusinessValidationService(),
  getUnifiedErrorHandler: () => serviceFactory.getUnifiedErrorHandler(),
  getUnifiedInputValidation: () => serviceFactory.getUnifiedInputValidation(),
  getSessionManager: () => serviceFactory.getSessionManager(),
  getNotificationTemplateService: () => serviceFactory.getNotificationTemplateService(),
  getSecureCredentialManager: () => serviceFactory.getSecureCredentialManager(),
  getTransactionManager: () => serviceFactory.getTransactionManager(),
  getMonitoringDashboard: () => serviceFactory.getMonitoringDashboard(),
  
  // Cleanup
  cleanup: () => serviceFactory.cleanup()
};

/**
 * 🔄 Graceful Shutdown Handler
 */
process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received, cleaning up services...');
  await serviceFactory.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 SIGINT received, cleaning up services...');
  await serviceFactory.cleanup();
  process.exit(0);
});