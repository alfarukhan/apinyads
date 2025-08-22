// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

// Environment-based fraud detection configuration
const FRAUD_CONFIG = {
  // Thresholds
  LOW_RISK_THRESHOLD: parseInt(process.env.FRAUD_LOW_RISK_THRESHOLD) || 40,
  MEDIUM_RISK_THRESHOLD: parseInt(process.env.FRAUD_MEDIUM_RISK_THRESHOLD) || 70,
  HIGH_RISK_THRESHOLD: parseInt(process.env.FRAUD_HIGH_RISK_THRESHOLD) || 100,
  BLOCK_THRESHOLD: parseInt(process.env.FRAUD_BLOCK_THRESHOLD) || 130,
  
  // User behavior
  NEW_USER_GRACE_DAYS: parseInt(process.env.FRAUD_NEW_USER_GRACE_DAYS) || 7,
  NEW_USER_MAX_SCORE: parseInt(process.env.FRAUD_NEW_USER_MAX_SCORE) || 25,
  NO_BOOKINGS_PENALTY: parseInt(process.env.FRAUD_NO_BOOKINGS_PENALTY) || 10,
  
  // Geolocation
  VPN_PENALTY_SCORE: parseInt(process.env.FRAUD_VPN_PENALTY_SCORE) || 15,
  MALICIOUS_IP_SCORE: parseInt(process.env.FRAUD_MALICIOUS_IP_SCORE) || 40,
  
  // Amount limits
  MAX_DAILY_AMOUNT: parseInt(process.env.FRAUD_MAX_DAILY_AMOUNT) || 10000000, // 10M IDR
  MAX_SINGLE_TRANSACTION: parseInt(process.env.FRAUD_MAX_SINGLE_TRANSACTION) || 5000000, // 5M IDR
  
  // Velocity limits
  MAX_TRANSACTIONS_PER_HOUR: parseInt(process.env.FRAUD_MAX_TRANSACTIONS_PER_HOUR) || 5,
  MAX_TRANSACTIONS_PER_DAY: parseInt(process.env.FRAUD_MAX_TRANSACTIONS_PER_DAY) || 20,
};

/**
 * Centralized Fraud Detection Middleware
 * Provides consistent fraud checking across all payment endpoints
 * 
 * UPDATED RULES (More Production-Friendly):
 * - NEW_USER: 7 days grace period with decreasing risk score
 * - VPN_DETECTED: Light penalty (15 points) instead of blocking
 * - SUSPICIOUS_IP: Only for truly malicious IPs (40 points)
 * - BLOCK_THRESHOLD: Increased to 130 to allow legitimate new users
 * 
 * Typical Scenarios:
 * - New user (day 1) + VPN: 25 + 15 = 40 points (LOW_RISK) ✅
 * - New user (day 3) + no bookings: 16 + 10 = 26 points (MINIMAL) ✅  
 * - New user (day 7) + VPN + no bookings: 5 + 15 + 10 = 30 points (LOW_RISK) ✅
 */
class FraudDetectionService {
  constructor() {
    this.rules = [
      new AmountLimitRule(),
      new VelocityRule(), 
      new UserBehaviorRule(),
      new GeolocationRule()
    ];
    
    // Use configurable thresholds
    this.thresholds = {
      LOW_RISK: FRAUD_CONFIG.LOW_RISK_THRESHOLD,
      MEDIUM_RISK: FRAUD_CONFIG.MEDIUM_RISK_THRESHOLD, 
      HIGH_RISK: FRAUD_CONFIG.HIGH_RISK_THRESHOLD,
      BLOCK_THRESHOLD: FRAUD_CONFIG.BLOCK_THRESHOLD
    };
  }

  async evaluateTransaction(transactionData) {
    let riskScore = 0;
    const flags = [];
    const details = {};

    // Run all fraud detection rules
    for (const rule of this.rules) {
      try {
        const result = await rule.evaluate(transactionData);
        riskScore += result.score;
        
        if (result.flag) {
          flags.push(result.flag);
        }
        
        details[rule.name] = result;
      } catch (error) {
        console.error(`Fraud rule ${rule.name} failed:`, error);
        // Continue with other rules even if one fails
      }
    }

    // Determine action based on risk score
    let action = 'APPROVE';
    let approved = true;

    if (riskScore >= this.thresholds.BLOCK_THRESHOLD) {
      action = 'BLOCK';
      approved = false;
    } else if (riskScore >= this.thresholds.HIGH_RISK) {
      action = 'REVIEW';
      approved = false; // Require manual review
    } else if (riskScore >= this.thresholds.MEDIUM_RISK) {
      action = 'CHALLENGE'; // Additional verification
      approved = true; // But flag for monitoring
    }

    return {
      approved,
      riskScore,
      riskLevel: this.getRiskLevel(riskScore),
      action,
      flags,
      details,
      timestamp: new Date()
    };
  }

  getRiskLevel(score) {
    if (score >= this.thresholds.HIGH_RISK) return 'HIGH';
    if (score >= this.thresholds.MEDIUM_RISK) return 'MEDIUM';
    if (score >= this.thresholds.LOW_RISK) return 'LOW';
    return 'MINIMAL';
  }
}

/**
 * Amount Limit Rule - Check transaction amount limits
 */
class AmountLimitRule {
  constructor() {
    this.name = 'AmountLimit';
    this.maxDailyAmount = FRAUD_CONFIG.MAX_DAILY_AMOUNT;
    this.maxSingleTransaction = FRAUD_CONFIG.MAX_SINGLE_TRANSACTION;
  }

  async evaluate(data) {
    let score = 0;
    let flag = null;

    // Check single transaction limit
    if (data.amount > this.maxSingleTransaction) {
      score += 40;
      flag = 'LARGE_TRANSACTION';
    }

    // Check daily amount for user
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dailyTotal = await prisma.booking.aggregate({
      where: {
        userId: data.userId,
        createdAt: { gte: today },
        status: { in: ['CONFIRMED', 'PENDING'] }
      },
      _sum: { totalAmount: true }
    });

    const dailyAmount = (dailyTotal._sum.totalAmount || 0) + data.amount;
    
    if (dailyAmount > this.maxDailyAmount) {
      score += 50;
      flag = 'DAILY_LIMIT_EXCEEDED';
    }

    return { score, flag, dailyAmount, singleAmount: data.amount };
  }
}

/**
 * Velocity Rule - Check transaction frequency
 */
class VelocityRule {
  constructor() {
    this.name = 'Velocity';
    this.maxTransactionsPerHour = FRAUD_CONFIG.MAX_TRANSACTIONS_PER_HOUR;
    this.maxTransactionsPerDay = FRAUD_CONFIG.MAX_TRANSACTIONS_PER_DAY;
  }

  async evaluate(data) {
    let score = 0;
    let flag = null;

    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Check hourly velocity
    const hourlyCount = await prisma.booking.count({
      where: {
        userId: data.userId,
        createdAt: { gte: hourAgo },
        status: { in: ['CONFIRMED', 'PENDING'] }
      }
    });

    if (hourlyCount >= this.maxTransactionsPerHour) {
      score += 60;
      flag = 'HIGH_VELOCITY_HOUR';
    }

    // Check daily velocity
    const dailyCount = await prisma.booking.count({
      where: {
        userId: data.userId,
        createdAt: { gte: dayAgo },
        status: { in: ['CONFIRMED', 'PENDING'] }
      }
    });

    if (dailyCount >= this.maxTransactionsPerDay) {
      score += 70;
      flag = 'HIGH_VELOCITY_DAY';
    }

    return { score, flag, hourlyCount, dailyCount };
  }
}

/**
 * User Behavior Rule - Check user patterns
 */
class UserBehaviorRule {
  constructor() {
    this.name = 'UserBehavior';
  }

  async evaluate(data) {
    let score = 0;
    let flag = null;

    // Check if new user (higher risk)
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: {
        _count: {
          select: { bookings: true }
        }
      }
    });

    if (!user) {
      score += 100; // Block unknown users
      flag = 'UNKNOWN_USER';
      return { score, flag };
    }

    // New user risk - configurable timeframe
    const accountAge = (new Date() - new Date(user.createdAt)) / (1000 * 60 * 60 * 24);
    if (accountAge < FRAUD_CONFIG.NEW_USER_GRACE_DAYS) {
      const ageScore = Math.max(5, FRAUD_CONFIG.NEW_USER_MAX_SCORE - (accountAge * 3));
      score += ageScore;
      flag = 'NEW_USER';
    }

    // No previous transactions - configurable penalty
    if (user._count.bookings === 0) {
      score += FRAUD_CONFIG.NO_BOOKINGS_PENALTY;
    }

    return { score, flag, accountAge, previousBookings: user._count.bookings };
  }
}

/**
 * Geolocation Rule - Check location patterns
 */
class GeolocationRule {
  constructor() {
    this.name = 'Geolocation';
  }

  async evaluate(data) {
    let score = 0;
    let flag = null;

    // For now, simple IP-based detection
    // In production, integrate with MaxMind or similar service
    
    if (data.ipAddress) {
      // Check for known malicious IP ranges only
      if (this.isMaliciousIP(data.ipAddress)) {
        score += FRAUD_CONFIG.MALICIOUS_IP_SCORE;
        flag = 'SUSPICIOUS_IP';
      }
      
      // VPN/Proxy detection (lighter penalty)
      if (this.isVpnOrProxy(data.ipAddress)) {
        score += FRAUD_CONFIG.VPN_PENALTY_SCORE;
        flag = 'VPN_DETECTED';
      }
    }

    return { score, flag, ipAddress: data.ipAddress };
  }

  isMaliciousIP(ip) {
    // Only block truly malicious IPs
    const maliciousRanges = [
      // Add known malicious IP ranges here
      // Example: TOR exit nodes, known botnets, etc.
    ];
    return maliciousRanges.some(range => ip.startsWith(range));
  }

  isVpnOrProxy(ip) {
    // Common VPN/Proxy detection - lighter penalty
    const vpnIndicators = [
      '127.0.0.1',  // Localhost (development)
      '192.168.',   // Private networks
      '10.',        // Private networks
      '172.16.',    // Private networks
    ];
    
    // In production, integrate with VPN detection service
    // For now, only flag localhost as VPN for development
    return ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.');
  }
}

/**
 * Middleware function to be used in routes
 */
const fraudDetectionMiddleware = async (req, res, next) => {
  try {
    // Extract transaction data from request
    const transactionData = extractTransactionData(req);
    
    // Skip fraud detection for admin users in development
    if (process.env.NODE_ENV === 'development' && req.user?.role === 'ADMIN') {
      req.fraudCheck = { 
        approved: true, 
        riskScore: 0, 
        riskLevel: 'MINIMAL',
        action: 'APPROVE',
        flags: [],
        bypassedForAdmin: true
      };
      return next();
    }

    // Run fraud detection
    const fraudService = new FraudDetectionService();
    const fraudCheck = await fraudService.evaluateTransaction(transactionData);
    
    // Attach result to request
    req.fraudCheck = fraudCheck;
    
    // Log fraud check result
    console.log(`🛡️ Fraud check for user ${transactionData.userId}:`, {
      riskScore: fraudCheck.riskScore,
      riskLevel: fraudCheck.riskLevel,
      action: fraudCheck.action,
      flags: fraudCheck.flags
    });

    // Block high-risk transactions
    if (!fraudCheck.approved && fraudCheck.action === 'BLOCK') {
      return res.status(400).json({
        success: false,
        message: 'Transaction blocked by fraud detection system',
        code: 'FRAUD_DETECTED',
        error_code: 'FRAUD_DETECTED', // For compatibility with different frontend parsers
        details: `Risk score: ${fraudCheck.riskScore}, Flags: ${fraudCheck.flags.join(', ')}`,
        riskLevel: fraudCheck.riskLevel,
        flags: fraudCheck.flags,
        timestamp: new Date().toISOString(),
        security_version: 'DanceSignal Security v1.0'
      });
    }

    // Continue to next middleware
    next();
    
  } catch (error) {
    console.error('❌ Fraud detection middleware error:', error);
    
    // In case of error, allow transaction but log the issue
    req.fraudCheck = { 
      approved: true, 
      riskScore: 0, 
      riskLevel: 'UNKNOWN',
      action: 'APPROVE',
      flags: ['FRAUD_SERVICE_ERROR'],
      error: error.message
    };
    
    next();
  }
};

/**
 * Extract transaction data from request
 */
function extractTransactionData(req) {
  // Handle different request types (booking, webhook, etc.)
  if (req.body.order_id) {
    // Midtrans webhook
    return {
      orderId: req.body.order_id,
      amount: parseInt(req.body.gross_amount) || 0,
      userId: req.user?.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      paymentType: req.body.payment_type,
      transactionStatus: req.body.transaction_status
    };
  } else {
    // Regular booking request
    const totalAmount = (req.body.totalAmount || 0);
    return {
      userId: req.user?.id,
      amount: totalAmount,
      eventId: req.body.eventId,
      accessTierId: req.body.accessTierId,
      quantity: req.body.quantity || 1,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };
  }
}

module.exports = {
  FraudDetectionService,
  fraudDetectionMiddleware,
  AmountLimitRule,
  VelocityRule,
  UserBehaviorRule,
  GeolocationRule
};