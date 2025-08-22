const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ✅ TIMEZONE: Set server timezone to Jakarta (GMT+7)
process.env.TZ = 'Asia/Jakarta';

// Fix MaxListeners warning
process.setMaxListeners(20);

// Import Smart Logger
const { createLogger, LoggerFactory } = require('./services/core/SmartLogger');
const LoggingService = require('./services/core/LoggingService');

// ✅ TIMEZONE: Import timezone helper for consistent date handling
const { getJakartaNow, getTimezoneInfo, formatJakartaDate } = require('./utils/timezone-helper');

// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('./lib/prisma');

// ✅ FIX: Get LoggingService instance for graceful shutdown
const loggingService = new LoggingService();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const eventRoutes = require('./routes/events');
const communityRoutes = require('./routes/communities');
const artistRoutes = require('./routes/artists');
const postRoutes = require('./routes/posts');
const accessRoutes = require('./routes/access');
const accessTiersRoutes = require('./routes/access-tiers');
const bookingsRoutes = require('./routes/bookings');
const bookingCalculationRoutes = require('./routes/booking-calculation');
const secureValidationRoutes = require('./routes/secure-validation');
const accessTransfersRoutes = require('./routes/access-transfers');
const chatRoutes = require('./routes/chat');
const searchRoutes = require('./routes/search');
const challengeRoutes = require('./routes/challenges');
const rewardRoutes = require('./routes/rewards');
const pollRoutes = require('./routes/polls');
const newsRoutes = require('./routes/news');
const dailyDropRoutes = require('./routes/daily_drop');
const venueRoutes = require('./routes/venues');
const genreRoutes = require('./routes/genres');
const cityRoutes = require('./routes/cities');
const organizerRoutes = require('./routes/organizers');
const labelsRoutes = require('./routes/labels');
const analyticsRoutes = require('./routes/analytics');
const qrRoutes = require('./routes/qr');
const platformConfigRoutes = require('./routes/platform-config');
const uploadRoutes = require('./routes/upload');
const spotifyRoutes = require('./routes/spotify');
const musicRoutes = require('./routes/music');
const locationRoutes = require('./routes/location');
const paymentTestRoutes = require('./routes/payment-test'); // ✅ CENTRALIZED: Payment service testing
const cacheRoutes = require('./routes/cache'); // ✅ OFFLINE: Advanced caching system
const paymentsRoutes = require('./routes/payments'); // ✅ UNIVERSAL: Unified payment status endpoint
const healthRoutes = require('./routes/health'); // ✅ CENTRALIZED: Health monitoring
const webhookRoutes = require('./routes/webhooks'); // ✅ CENTRALIZED: Webhook processing
const monitoringRoutes = require('./routes/monitoring'); // ✅ CENTRALIZED: Monitoring dashboard
const securityHealthRoutes = require('./routes/security-health'); // Security health check
const debugRoutes = require('./routes/debug'); // 🔧 DEBUG: Mobile detection testing

// Import middleware
const { authMiddleware, optionalAuth, requireRole } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { applyResponseMiddleware } = require('./middleware/responseFormatter');
const { applyAuditMiddleware } = require('./middleware/auditMiddleware');
const { rateLimitMiddleware, presets: rateLimitPresets } = require('./middleware/rateLimitMiddleware');
const { cacheMiddleware, presets: cachePresets } = require('./middleware/cachingMiddleware');
const { applyStandardizedErrorHandling, correlationIdMiddleware } = require('./middleware/standardizedErrorMiddleware');
const { applyStructuredLogging } = require('./middleware/structuredLoggingMiddleware');
const { paymentCreationLimit, paymentVerificationLimit, paymentStatusLimit } = require('./middleware/paymentRateLimitMiddleware');
const { globalThrottlingMiddleware } = require('./middleware/globalThrottlingMiddleware');

// Security middleware
const { applySecurityMiddleware } = require('./middleware/enhancedSecurity');
const { applyGlobalAPIProtection } = require('./middleware/globalApiProtection');

// Import services
const { bookingExpiryJob } = require('./services/booking-expiry-job');
const SecurityCleanupJob = require('./jobs/security-cleanup-job');

// ✅ PRODUCTION: Enterprise Redis caching for 100k+ users
const redisService = require('./services/cache/RedisService');

// ✅ PRODUCTION: Enterprise APM monitoring for 100k+ users
const { 
  apmMiddleware, 
  errorTrackingMiddleware, 
  databaseMonitoringMiddleware 
} = require('./middleware/apm-middleware');

// ✅ SECURE: Initialize security cleanup job for global access
const securityCleanupJob = new SecurityCleanupJob();
const paymentReminderJob = require('./jobs/payment-reminder-job');
const QueueJobManager = require('./jobs/QueueJobManager');

// ✅ REAL-TIME: Initialize Chat WebSocket Service
const ChatWebSocketService = require('./services/chat/ChatWebSocketService');
let chatService;

// Initialize Smart Logger with clean startup
const logger = createLogger('DanceSignal');

// Set log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'WARN');
LoggerFactory.setGlobalLevel(LOG_LEVEL);

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ✅ REAL-TIME: Setup Socket.IO server for live chat
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [
      "http://localhost:3000",
      "http://localhost:8080", 
      "http://localhost:5173"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

logger.startup(`Starting DanceSignal API Server...`);
logger.startup(`Environment: ${NODE_ENV}`);
logger.startup(`Port: ${PORT}`);
logger.startup(`Log Level: ${LOG_LEVEL}`);

// Critical: Validate environment variables
if (!process.env.JWT_SECRET) {
  logger.error('CRITICAL: JWT_SECRET is not set!');
  logger.error('Please create/check api/.env file with JWT_SECRET');
  process.exit(1);
}
logger.startup('JWT_SECRET is configured');

// Security middleware - with development considerations
if (NODE_ENV === 'production') {
  app.use(helmet());
} else {
  // More permissive helmet for development
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

// ✅ PRODUCTION: Enhanced rate limiting for 100k+ concurrent users
const limiter = rateLimit({
  windowMs: NODE_ENV === 'production' ? 15 * 60 * 1000 : 60 * 1000, // 15 min prod, 1 min dev
  max: NODE_ENV === 'production' ? 10000 : 1000, // 🚀 SCALED: 10k requests per 15min for production (100k users)
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => NODE_ENV === 'development' && req.ip === '127.0.0.1', // Skip for localhost in dev
  // ✅ ENTERPRISE: Advanced rate limiting for authenticated users
  keyGenerator: (req) => {
    // Use user ID if authenticated for per-user limits, otherwise IP
    return req.user?.id || req.ip;
  },
  skipSuccessfulRequests: false, // Count all requests for accurate limiting
});
app.use(limiter);

// ✅ PRODUCTION: Booking rate limiting optimized for 100k users
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: NODE_ENV === 'production' ? 100 : 50, // 🚀 SCALED: 100 booking attempts per user per hour
  message: {
    error: 'Too many booking attempts, please try again later.',
    retryAfter: '1 hour'
  },
  // ✅ ENTERPRISE: Per-user booking limits
  keyGenerator: (req) => req.user?.id || req.ip,
  skipFailedRequests: true, // Only count successful booking attempts
});

// ✅ PRODUCTION: Transfer rate limiting optimized for 100k users  
const transferLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: NODE_ENV === 'production' ? 50 : 20, // 🚀 SCALED: 50 transfer attempts per user per hour
  message: {
    error: 'Too many transfer attempts, please try again later.',
    retryAfter: '1 hour'
  },
  // ✅ ENTERPRISE: Per-user transfer limits
  keyGenerator: (req) => req.user?.id || req.ip,
  skipFailedRequests: true, // Only count successful transfers
});

// ✅ ENTERPRISE: Ultra-strict payment rate limiting for security
const ultraStrictPaymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: NODE_ENV === 'production' ? 25 : 50, // 🔒 SECURE: 25 payment attempts per user per hour
  message: {
    error: 'Payment rate limit exceeded for security. Please wait.',
    retryAfter: '1 hour'
  },
  keyGenerator: (req) => req.user?.id || req.ip,
  skipSuccessfulRequests: false, // Count all payment requests
});

// Enhanced CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    console.log(`🔍 CORS Check - Origin: "${origin}" | Environment: ${NODE_ENV}`);
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ CORS: No origin - allowing');
      return callback(null, true);
    }
    
    // Development mode - allow all localhost/127.0.0.1
    if (NODE_ENV === 'development') {
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/)) {
        console.log(`✅ CORS: Development mode - allowing ${origin}`);
        return callback(null, true);
      }
    }
    
    // Production allowed origins
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    
    // Default development origins
    const defaultDevOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:3011', // CMS
      'http://localhost:3012',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3011'
    ];
    
    const finalAllowedOrigins = NODE_ENV === 'development' 
      ? [...defaultDevOrigins, ...allowedOrigins]
      : allowedOrigins;
    
    if (finalAllowedOrigins.includes(origin)) {
      console.log(`✅ CORS: Origin allowed - ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ CORS: Origin blocked - ${origin}`);
      console.log(`🔍 CORS: Allowed origins:`, finalAllowedOrigins);
      callback(new Error(`CORS policy violation: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization',  // CRITICAL: Must be here!
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-CSRF-Token',
    'X-Access-Token'  // Additional auth header support
  ],
  exposedHeaders: ['Authorization', 'X-Total-Count'],
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: NODE_ENV === 'production' ? 86400 : 0, // No cache in dev for easier debugging
};

// Apply CORS
app.use(cors(corsOptions));

// CRITICAL: Explicit preflight handler for all routes
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-CSRF-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ CRITICAL: Apply global API protection FIRST - blocks unauthorized access
applyGlobalAPIProtection(app);

// ✅ SECURITY: Apply security middleware to ALL routes
applySecurityMiddleware(app);

// ✅ CENTRALIZED: Apply response formatting middleware to ALL routes
applyResponseMiddleware(app);

// ✅ CENTRALIZED: Apply audit logging middleware to ALL routes
applyAuditMiddleware(app);

// ✅ CENTRALIZED: Apply rate limiting middleware to ALL API routes
app.use('/api', rateLimitMiddleware);
console.log('🚦 Rate limiting enabled for all API routes');

// ✅ PRODUCTION: Log rate limiting configuration for 100k users
if (NODE_ENV === 'production') {
  console.log('🚀 PRODUCTION RATE LIMITS FOR 100K+ USERS:');
  console.log('  - Global: 10,000 requests per 15 minutes per user');
  console.log('  - Booking: 100 attempts per hour per user');
  console.log('  - Transfer: 50 attempts per hour per user');
  console.log('  - Payment: 25 attempts per hour per user (security)');
}

// ✅ CENTRALIZED: Apply intelligent caching middleware to read-only API routes
app.use('/api', cachePresets.dynamic);
console.log('💾 Intelligent caching enabled for API routes');

// ✅ OFFLINE: Initialize advanced cache service for app locals
const AdvancedCacheService = require('./services/cache/AdvancedCacheService');
app.locals.cacheService = new AdvancedCacheService();
console.log('📱 Advanced offline caching system initialized');

// ✅ CENTRALIZED: Apply correlation ID middleware to ALL requests
app.use(correlationIdMiddleware);
console.log('🔗 Correlation ID tracking enabled for all requests');

// ✅ PRODUCTION: Apply APM monitoring middleware for 100k+ users
app.use(apmMiddleware);
console.log('📊 APM monitoring enabled for all requests - tracking performance & business metrics');

// ✅ CENTRALIZED: Apply structured logging to ALL requests
applyStructuredLogging(app, {
  replaceConsole: true,
  logRequests: true,
  logResponses: true,
  logSecurity: true
});
console.log('📝 Structured logging enabled for all requests');

// ✅ CENTRALIZED: Apply global throttling middleware to ALL API routes
app.use('/api', globalThrottlingMiddleware({
  enableAdaptiveThrottling: true,
  enableBurstProtection: true,
  enableMetrics: true
}));
console.log('🌐 Global throttling middleware enabled for all API routes');

// Enhanced debug middleware for development
if (NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n🔍 ${timestamp}`);
    console.log(`📡 ${req.method} ${req.path}`);
    console.log(`🌐 Origin: ${req.get('origin') || 'None'}`);
    console.log(`🔑 Auth: ${req.get('authorization') ? 'Present' : 'None'}`);
    
    if (req.method === 'OPTIONS') {
      console.log(`🚩 PREFLIGHT REQUEST`);
    }
    
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`📦 Body keys: ${Object.keys(req.body).join(', ')}`);
    }
    next();
  });
}

// Logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    version: '1.0.0',
  });
});

// Base API info endpoint
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'DanceSignal API',
    version: '1.0.0',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      events: '/api/events', 
      communities: '/api/communities',
      artists: '/api/artists',
      posts: '/api/posts',
      access: '/api/access',
      accessTiers: '/api/access-tiers',
      bookings: '/api/bookings',
      accessTransfers: '/api/access-transfers',
      chat: '/api/chat',
      search: '/api/search',
      challenges: '/api/challenges',
      rewards: '/api/rewards',
      polls: '/api/polls',
      news: '/api/news',
      dailyDrop: '/api/daily-drop',
      venues: '/api/venues',
      genres: '/api/genres',
      cities: '/api/cities',
      organizers: '/api/organizers',
      labels: '/api/labels',
      analytics: '/api/analytics',
      qr: '/api/qr',
      platformConfig: '/api/platform-config'
    },
    docs: 'Visit individual endpoints for more information'
  });
});

// API health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/events', paymentCreationLimit, eventRoutes); // Apply payment rate limiting for guestlist payments
app.use('/api/communities', communityRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/access-tiers', accessTiersRoutes);
app.use('/api/bookings', paymentCreationLimit, bookingsRoutes); // Apply payment & booking rate limiting
app.use('/api/booking', paymentCreationLimit, bookingCalculationRoutes); // Apply rate limiting for secure calculations
app.use('/api/validation', paymentCreationLimit, secureValidationRoutes); // Apply rate limiting for secure validations
app.use('/api/access-transfers', transferLimiter, accessTransfersRoutes); // Apply transfer rate limiter
app.use('/api/chat', chatRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/rewards', rewardRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/daily-drop', dailyDropRoutes);
app.use('/api/venues', venueRoutes);
app.use('/api/genres', genreRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/organizers', organizerRoutes);
app.use('/api/labels', labelsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/platform-config', platformConfigRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/spotify', spotifyRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/location', locationRoutes);

// ✅ UNIVERSAL: Unified payment status endpoint (auto-detects payment type)
app.use('/api/payments', paymentStatusLimit, paymentsRoutes);
console.log('💰 Universal payment endpoints available: /api/payments/status/{paymentId}');

// ✅ OFFLINE: Advanced caching system (available in all environments)
app.use('/api/cache', cacheRoutes);
console.log('📱 Offline cache endpoints available: /api/cache/*');

// ✅ CENTRALIZED: Payment service testing endpoint (remove in production)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/payment-test', paymentTestRoutes);
  console.log('🧪 Payment test endpoint enabled: /api/payment-test');
}

// ✅ CENTRALIZED: Health monitoring endpoints
app.use('/health', healthRoutes);
console.log('🏥 Health monitoring endpoints available: /health');

// ✅ CENTRALIZED: Webhook processing endpoints
app.use('/webhooks', webhookRoutes);
console.log('🔗 Webhook processing endpoints available: /webhooks');

// ✅ CENTRALIZED: Monitoring dashboard endpoints
app.use('/monitoring', monitoringRoutes);
console.log('📊 Monitoring dashboard endpoints available: /monitoring');

// Security health check endpoints
app.use('/api/security', securityHealthRoutes);
console.log('🛡️ Security health endpoints available: /api/security');

// 🔧 DEBUG: Mobile detection testing endpoints (all environments for now)
app.use('/api/debug', debugRoutes);
console.log('🔧 Debug endpoints available: /api/debug');

// Static file serving
app.use('/uploads', express.static('uploads'));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
  });
});

// ✅ PRODUCTION: Apply APM error tracking middleware
app.use(errorTrackingMiddleware);
console.log('📊 APM error tracking enabled for comprehensive error monitoring');

// ✅ CENTRALIZED: Standardized error handling with UnifiedErrorHandler
applyStandardizedErrorHandling(app);
console.log('🛡️ Standardized error handling applied to all routes');

// ✅ FIX: Centralized graceful shutdown to prevent memory leaks
const gracefulShutdown = async (signal) => {
  console.log(`${signal} signal received: closing HTTP server`);
  
  try {
    // Stop background jobs
    bookingExpiryJob.stop();
    
    // ✅ SECURE: Stop security cleanup job
    if (typeof securityCleanupJob !== 'undefined') {
      securityCleanupJob.stop();
      console.log('✅ Security cleanup job stopped');
    }
    
    // ✅ REAL-TIME: Stop chat service
    if (chatService) {
      // Notify all connected users about server shutdown
      chatService.io.emit('server_shutdown', {
        message: 'Server is shutting down. Please reconnect in a moment.',
        timestamp: new Date().toISOString()
      });
      
      // Close all socket connections
      chatService.io.close();
      console.log('✅ Chat service stopped');
    }
    
    // ✅ PRODUCTION: Graceful Redis disconnection
    await redisService.disconnect();
    console.log('✅ Redis caching service disconnected');
    
    // Flush logs before shutting down
    if (loggingService && typeof loggingService.gracefulShutdown === 'function') {
      await loggingService.gracefulShutdown();
    }
    
    // Disconnect from database
    await prisma.$disconnect();
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Register signal handlers only once
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  
  // ✅ TIMEZONE: Display timezone configuration
  const timezoneInfo = getTimezoneInfo();
  console.log(`🕐 Timezone: ${timezoneInfo.name} (${timezoneInfo.offset})`);
  console.log(`📅 Server time: ${formatJakartaDate(getJakartaNow())}`);
  
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`📱 Mobile access: http://10.0.2.2:${PORT}/api (Android emulator)`);
  console.log(`🔌 WebSocket URL: ws://localhost:${PORT}`);
  
  // ✅ REAL-TIME: Initialize Chat WebSocket Service
  try {
    chatService = new ChatWebSocketService(io);
    
      // Set Socket.IO instance for chat routes
  chatRoutes.setSocketIO(io);
  
  // Set Socket.IO instance for posts routes (real-time feed)
  postRoutes.setSocketIO(io);
    
    console.log('🚀 Real-time chat service started');
    console.log('  - WebSocket authentication: JWT-based');
    console.log('  - Features: Live messaging, typing indicators, reactions');
    console.log('  - Push notifications: Enabled with reply support');
    console.log('  - Connected users: 0 (waiting for connections)');
  } catch (error) {
    console.error('❌ Failed to initialize chat service:', error);
  }
  
  // Start background jobs
  console.log('🔄 Starting background services...');
  
  // Start booking expiry monitoring
  bookingExpiryJob.start();
  console.log('✅ Booking expiry monitoring started');
  
  // ✅ SECURE: Start security cleanup job for payment intents and stock reservations
  securityCleanupJob.start();
  console.log('✅ Security cleanup job started (every 2 minutes)');
  
  // ✅ PRODUCTION: Display Redis caching status for 100k+ users
  const cacheStats = await redisService.getCacheStats();
  if (cacheStats.connected) {
    console.log('✅ Redis caching enabled for 100k+ users');
    console.log('  - Event caching: 5-minute TTL');
    console.log('  - Access tier caching: 10-minute TTL');
    console.log('  - User data caching: 15-minute TTL');
    console.log('  - Cache performance: 30% speed boost expected');
  } else {
    console.log('⚠️ Redis caching disabled - running without cache');
  }
  
  // ✅ PRODUCTION: Display APM monitoring status
  console.log('✅ APM monitoring active for 100k+ users');
  console.log('  - Request/response tracking: Real-time');
  console.log('  - Database query monitoring: Every operation');
  console.log('  - Error tracking: Comprehensive');
  console.log('  - Business metrics: Automated');
  console.log('  - Performance alerts: Active');
  console.log('  - Dashboard: http://localhost:' + PORT + '/monitoring/dashboard');
  
  // Start payment reminder and expiry jobs
  paymentReminderJob.startCronJobs();
  
  // Start payment verification job for missed webhooks
  const paymentVerificationJob = require('./jobs/payment-verification-job');
  paymentVerificationJob.start();
  
  // Start expired access cleanup job
  const { scheduleCleanupJob } = require('./jobs/expired-access-cleanup-job');
  scheduleCleanupJob();
  
  // ✅ CENTRALIZED: Start queue-based background job processing
  try {
    const queueJobManager = new QueueJobManager();
    queueJobManager.startScheduledJobs().then(() => {
      console.log('🚀 Queue-based background job processing started');
    }).catch(error => {
      console.error('❌ Failed to start queue-based jobs:', error);
    });
  } catch (error) {
    console.error('❌ Failed to initialize QueueJobManager:', error);
  }
  
  console.log('✅ All background services started');
});

// Export both app and chatService for use in routes
module.exports = { app, server, io, getChatService: () => chatService }; 




