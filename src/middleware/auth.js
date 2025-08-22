const jwt = require('jsonwebtoken');
// ✅ ENTERPRISE: Use centralized singleton instead of new instance
const { prisma } = require('../lib/prisma');

const authMiddleware = async (req, res, next) => {
  try {
    // ✅ DEBUG: Log all request details
    console.log('🔒 AUTH MIDDLEWARE STARTED');
    console.log('  Method:', req.method);
    console.log('  URL:', req.url);
    console.log('  Headers Authorization:', req.headers.authorization);
    console.log('  All Headers:', Object.keys(req.headers));
    
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ AUTH: No valid Authorization header');
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.substring(7);

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error.',
      });
    }

    // Verify token
    let decoded;
    try {
      console.log('🔍 AUTH: Verifying JWT token...');
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ AUTH: JWT verified, userId:', decoded.userId);
    } catch (jwtError) {
      console.log('❌ AUTH: JWT verification failed:', jwtError.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
      });
    }
    
    // Get user from database
    console.log('🔍 AUTH: Looking up user in database...');
    const user = await prisma.user.findUnique({
      where: { 
        id: decoded.userId,
        isActive: true 
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        city: true,
        isVerified: true,
      }
    });

    if (!user) {
      console.log('❌ AUTH: User not found in database for userId:', decoded.userId);
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive.',
      });
    }

    console.log('✅ AUTH: User found:', {
      id: user.id,
      email: user.email,
      username: user.username
    });
    
    req.user = user;
    console.log('✅ AUTH: req.user set successfully, calling next()');
    next();
    
  } catch (error) {
    console.error('❌ AUTH: Unexpected error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
    });
  }
};

// Optional auth middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await prisma.user.findUnique({
      where: { 
        id: decoded.userId,
        isActive: true 
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        city: true,
        isVerified: true,
      }
    });

    req.user = user;
    next();
    
  } catch (error) {
    req.user = null;
    next();
  }
};

// Role-based access control
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
    }

    next();
  };
};

module.exports = {
  authMiddleware,
  optionalAuth,
  requireRole,
}; 