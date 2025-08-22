const errorHandler = (err, req, res, next) => {
  console.error('Error details:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Default error
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = null;

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 400;
    message = 'Duplicate entry. This resource already exists.';
    details = err.meta?.target;
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Resource not found.';
  } else if (err.code?.startsWith('P')) {
    statusCode = 400;
    message = 'Database operation failed.';
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed.';
    details = err.details || err.message;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired.';
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'File too large.';
  } else if (err.code === 'LIMIT_FILE_COUNT') {
    statusCode = 400;
    message = 'Too many files.';
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Unexpected file field.';
  }

  // Custom application errors
  if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Response object
  const errorResponse = {
    success: false,
    message,
    ...(details && { details }),
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      error: err.message,
    }),
  };

  res.status(statusCode).json(errorResponse);
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  AppError,
  asyncHandler,
}; 