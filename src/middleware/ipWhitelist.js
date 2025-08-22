/**
 * 🌐 IP WHITELISTING MIDDLEWARE
 * Untuk membatasi akses berdasarkan IP address
 */

const net = require('net');
const securityConfig = require('../config/security');

/**
 * 🔍 Get Real Client IP Address
 */
const getRealClientIP = (req) => {
  // Check various headers for real IP (considering proxies/load balancers)
  const forwardedFor = req.header('x-forwarded-for');
  const realIP = req.header('x-real-ip');
  const cloudflareIP = req.header('cf-connecting-ip');
  const awsIP = req.header('x-forwarded-for-aws');
  
  let clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // Priority order for IP detection
  if (cloudflareIP) {
    clientIP = cloudflareIP;
  } else if (realIP) {
    clientIP = realIP;
  } else if (forwardedFor) {
    // Take the first IP from x-forwarded-for (original client)
    clientIP = forwardedFor.split(',')[0].trim();
  } else if (awsIP) {
    clientIP = awsIP.split(',')[0].trim();
  }
  
  // Clean up IPv6 mapped IPv4 addresses
  if (clientIP && clientIP.startsWith('::ffff:')) {
    clientIP = clientIP.substring(7);
  }
  
  return clientIP;
};

/**
 * 🔍 Check if IP is in CIDR range
 */
const isIPInCIDR = (ip, cidr) => {
  try {
    if (!cidr.includes('/')) {
      // Single IP address
      return ip === cidr;
    }
    
    const [network, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength);
    
    // Convert IP addresses to binary
    const ipBuffer = net.isIPv4(ip) ? 
      Buffer.from(ip.split('.').map(Number)) : 
      Buffer.from(ip.split(':').map(x => parseInt(x, 16)));
    
    const networkBuffer = net.isIPv4(network) ? 
      Buffer.from(network.split('.').map(Number)) : 
      Buffer.from(network.split(':').map(x => parseInt(x, 16)));
    
    // For IPv4
    if (net.isIPv4(ip) && net.isIPv4(network)) {
      const mask = ~((1 << (32 - prefix)) - 1);
      const ipInt = ipBuffer.readUInt32BE(0);
      const networkInt = networkBuffer.readUInt32BE(0);
      
      return (ipInt & mask) === (networkInt & mask);
    }
    
    // For IPv6 (simplified check)
    return ip === network;
    
  } catch (error) {
    console.error('❌ Error checking CIDR range:', error);
    return false;
  }
};

/**
 * 🔍 Check if IP is whitelisted
 */
const isIPWhitelisted = (ip, whitelist) => {
  if (!ip || !whitelist || whitelist.length === 0) {
    return false;
  }
  
  // Check against each whitelist entry
  for (const entry of whitelist) {
    if (!entry) continue;
    
    try {
      // Direct IP match
      if (ip === entry) {
        return true;
      }
      
      // CIDR range match
      if (entry.includes('/') && isIPInCIDR(ip, entry)) {
        return true;
      }
      
      // Wildcard match (e.g., 192.168.1.*)
      if (entry.includes('*')) {
        const regex = new RegExp('^' + entry.replace(/\*/g, '.*') + '$');
        if (regex.test(ip)) {
          return true;
        }
      }
      
    } catch (error) {
      console.error('❌ Error checking IP whitelist entry:', entry, error);
      continue;
    }
  }
  
  return false;
};

/**
 * 🛡️ Admin IP Whitelist Middleware
 */
const adminIPWhitelist = (req, res, next) => {
  try {
    const config = securityConfig.getIPWhitelistConfig();
    const clientIP = getRealClientIP(req);
    
    console.log('🌐 Admin IP whitelist check started');
    console.log('  Client IP:', clientIP);
    console.log('  Whitelist:', config.adminEndpoints);
    
    // Skip validation in development untuk localhost
    if (securityConfig.isDevelopment && (
      clientIP === '127.0.0.1' || 
      clientIP === '::1' || 
      clientIP === 'localhost' ||
      clientIP?.startsWith('192.168.') ||
      clientIP?.startsWith('10.')
    )) {
      console.log('✅ Admin IP whitelist skipped for development localhost');
      return next();
    }
    
    if (!isIPWhitelisted(clientIP, config.adminEndpoints)) {
      console.log('❌ Admin IP not whitelisted:', clientIP);
      
      // Log security event
      logIPViolation('admin', clientIP, req);
      
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP address',
        code: 'IP_NOT_WHITELISTED_ADMIN',
        ip: clientIP
      });
    }
    
    console.log('✅ Admin IP whitelisted successfully');
    req.isWhitelistedIP = true;
    next();
    
  } catch (error) {
    console.error('❌ Admin IP whitelist error:', error);
    res.status(500).json({
      success: false,
      message: 'IP whitelist validation failed',
      code: 'IP_WHITELIST_ERROR'
    });
  }
};

/**
 * 🔧 Internal Service IP Whitelist Middleware
 */
const internalServiceIPWhitelist = (req, res, next) => {
  try {
    const config = securityConfig.getIPWhitelistConfig();
    const clientIP = getRealClientIP(req);
    
    console.log('🌐 Internal service IP whitelist check started');
    console.log('  Client IP:', clientIP);
    
    // Skip validation in development
    if (securityConfig.isDevelopment) {
      console.log('✅ Internal service IP whitelist skipped for development');
      return next();
    }
    
    if (!isIPWhitelisted(clientIP, config.internalServices)) {
      console.log('❌ Internal service IP not whitelisted:', clientIP);
      
      logIPViolation('internal', clientIP, req);
      
      return res.status(403).json({
        success: false,
        message: 'Internal service access denied from this IP',
        code: 'IP_NOT_WHITELISTED_INTERNAL',
        ip: clientIP
      });
    }
    
    console.log('✅ Internal service IP whitelisted successfully');
    next();
    
  } catch (error) {
    console.error('❌ Internal service IP whitelist error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal service IP validation failed',
      code: 'INTERNAL_IP_WHITELIST_ERROR'
    });
  }
};

/**
 * 🔗 Webhook IP Whitelist Middleware
 */
const webhookIPWhitelist = (req, res, next) => {
  try {
    const config = securityConfig.getIPWhitelistConfig();
    const clientIP = getRealClientIP(req);
    
    console.log('🌐 Webhook IP whitelist check started');
    console.log('  Client IP:', clientIP);
    console.log('  Webhook whitelist:', config.webhook);
    
    // Skip validation in development
    if (securityConfig.isDevelopment) {
      console.log('✅ Webhook IP whitelist skipped for development');
      return next();
    }
    
    if (!isIPWhitelisted(clientIP, config.webhook)) {
      console.log('❌ Webhook IP not whitelisted:', clientIP);
      
      logIPViolation('webhook', clientIP, req);
      
      return res.status(403).json({
        success: false,
        message: 'Webhook access denied from this IP',
        code: 'IP_NOT_WHITELISTED_WEBHOOK',
        ip: clientIP
      });
    }
    
    console.log('✅ Webhook IP whitelisted successfully');
    next();
    
  } catch (error) {
    console.error('❌ Webhook IP whitelist error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook IP validation failed',
      code: 'WEBHOOK_IP_WHITELIST_ERROR'
    });
  }
};

/**
 * 📊 Log IP Violation Events
 */
const logIPViolation = (type, ip, req) => {
  const violationData = {
    timestamp: new Date().toISOString(),
    type: type, // admin, internal, webhook
    ip: ip,
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent')?.substring(0, 100),
    referer: req.get('referer'),
    headers: {
      'x-forwarded-for': req.get('x-forwarded-for'),
      'x-real-ip': req.get('x-real-ip'),
      'cf-connecting-ip': req.get('cf-connecting-ip')
    }
  };
  
  console.log(`🚨 IP Violation: ${JSON.stringify(violationData)}`);
  
  // In production, send to security monitoring system
  if (securityConfig.isProduction) {
    // TODO: Send alert to security monitoring system
    // TODO: Consider automatic IP blocking for repeated violations
  }
};

/**
 * 🎯 Custom IP Whitelist Middleware
 */
const customIPWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    try {
      const clientIP = getRealClientIP(req);
      
      console.log('🌐 Custom IP whitelist check started');
      console.log('  Client IP:', clientIP);
      console.log('  Allowed IPs:', allowedIPs);
      
      if (!isIPWhitelisted(clientIP, allowedIPs)) {
        console.log('❌ IP not in custom whitelist:', clientIP);
        
        logIPViolation('custom', clientIP, req);
        
        return res.status(403).json({
          success: false,
          message: 'Access denied from this IP address',
          code: 'IP_NOT_WHITELISTED_CUSTOM',
          ip: clientIP
        });
      }
      
      console.log('✅ IP allowed by custom whitelist');
      next();
      
    } catch (error) {
      console.error('❌ Custom IP whitelist error:', error);
      res.status(500).json({
        success: false,
        message: 'Custom IP whitelist validation failed',
        code: 'CUSTOM_IP_WHITELIST_ERROR'
      });
    }
  };
};

/**
 * 🔍 IP Information Middleware (for debugging)
 */
const ipInfoMiddleware = (req, res, next) => {
  const clientIP = getRealClientIP(req);
  const ipInfo = {
    clientIP,
    headers: {
      'x-forwarded-for': req.get('x-forwarded-for'),
      'x-real-ip': req.get('x-real-ip'),
      'cf-connecting-ip': req.get('cf-connecting-ip'),
      'x-forwarded-for-aws': req.get('x-forwarded-for-aws')
    },
    originalIP: req.ip,
    connectionIP: req.connection?.remoteAddress,
    socketIP: req.socket?.remoteAddress
  };
  
  req.ipInfo = ipInfo;
  
  if (securityConfig.isDevelopment) {
    console.log('🔍 IP Info:', JSON.stringify(ipInfo, null, 2));
  }
  
  next();
};

/**
 * 🛡️ Enhanced IP Whitelist dengan Rate Limiting per IP
 */
const enhancedIPWhitelist = (options = {}) => {
  const {
    type = 'admin',
    customWhitelist = null,
    enableRateLimit = true,
    rateLimitWindow = 60000, // 1 minute
    rateLimitMax = 10
  } = options;
  
  // Simple in-memory rate limiting per IP
  const ipRateLimit = new Map();
  
  return (req, res, next) => {
    try {
      const clientIP = getRealClientIP(req);
      
      // Rate limiting per IP
      if (enableRateLimit) {
        const now = Date.now();
        const ipData = ipRateLimit.get(clientIP) || { count: 0, resetTime: now + rateLimitWindow };
        
        if (now > ipData.resetTime) {
          ipData.count = 1;
          ipData.resetTime = now + rateLimitWindow;
        } else {
          ipData.count++;
        }
        
        ipRateLimit.set(clientIP, ipData);
        
        if (ipData.count > rateLimitMax) {
          console.log('❌ IP rate limit exceeded:', clientIP);
          return res.status(429).json({
            success: false,
            message: 'Rate limit exceeded for this IP',
            code: 'IP_RATE_LIMIT_EXCEEDED',
            ip: clientIP
          });
        }
      }
      
      // Choose appropriate whitelist middleware
      let middleware;
      if (customWhitelist) {
        middleware = customIPWhitelist(customWhitelist);
      } else {
        switch (type) {
          case 'admin':
            middleware = adminIPWhitelist;
            break;
          case 'internal':
            middleware = internalServiceIPWhitelist;
            break;
          case 'webhook':
            middleware = webhookIPWhitelist;
            break;
          default:
            middleware = adminIPWhitelist;
        }
      }
      
      middleware(req, res, next);
      
    } catch (error) {
      console.error('❌ Enhanced IP whitelist error:', error);
      res.status(500).json({
        success: false,
        message: 'Enhanced IP whitelist validation failed',
        code: 'ENHANCED_IP_WHITELIST_ERROR'
      });
    }
  };
};

module.exports = {
  adminIPWhitelist,
  internalServiceIPWhitelist,
  webhookIPWhitelist,
  customIPWhitelist,
  enhancedIPWhitelist,
  ipInfoMiddleware,
  getRealClientIP,
  isIPWhitelisted,
  isIPInCIDR,
  logIPViolation
};
