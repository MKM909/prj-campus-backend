const express = require('express');
const { body, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createReport, getReports } = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Specific rate limiter for reports
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 reports per window
  message: {
    status: 'error',
    message: 'Too many reports created from this IP, please try again later'
  }
});

// Validation for creating a report
const reportValidation = [
  body('zoneId').isUUID().withMessage('Valid Zone ID is required'),
  body('category').notEmpty().withMessage('Category is required').trim().escape(),
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 100 }).trim().escape(),
  body('description').optional().isLength({ max: 1000 }).trim().escape(),
  body('photoUrl').optional().isURL().withMessage('Photo must be a valid URL'),
  body('isAnonymous').optional().isBoolean(),
  body('confidenceScore').optional().isFloat({ min: 0, max: 10 }),
];

// Validation for GET requests
const queryValidation = [
  query('zoneId').optional().isUUID().withMessage('Invalid Zone ID'),
  query('category').optional().trim().escape(),
  query('status').optional().trim().escape(),
];

// Routes
router.route('/')
  .get(queryValidation, getReports)
  .post(protect, reportLimiter, reportValidation, createReport);

module.exports = router;
