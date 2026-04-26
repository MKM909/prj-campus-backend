const rateLimit = require('express-rate-limit');

// Rate limiting: 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes'
  }
});

// Auth specific rate limiter (stricter)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    status: 'error',
    message: 'Too many login attempts, please try again after an hour'
  }
});

const securityMiddlewares = (app) => {
  // Apply general rate limiting
  app.use(limiter);
};

module.exports = {
  securityMiddlewares,
  authLimiter,
  limiter
};
