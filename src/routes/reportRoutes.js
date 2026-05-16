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
  body('zoneId').notEmpty().withMessage('Zone ID is required').trim(),
  body('category').notEmpty().withMessage('Category is required').trim().escape(),
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 100 }).trim().escape(),
  body('description').optional().isLength({ max: 1000 }).trim().escape(),
  body('photoUrl').optional().isURL().withMessage('Photo must be a valid URL'),
  body('isAnonymous').optional().isBoolean(),
  body('confidenceScore').optional().isFloat({ min: 0, max: 10 }),
  body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  body('exactLat').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid exact latitude'),
  body('exactLng').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid exact longitude'),
  body('exact_lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Invalid exact latitude'),
  body('exact_lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Invalid exact longitude'),
  body('specificLocation').optional().isString().trim().isLength({ max: 180 }).withMessage('Specific location is too long'),
  body('specific_location').optional().isString().trim().isLength({ max: 180 }).withMessage('Specific location is too long'),
  body('buildingId').optional().isUUID().withMessage('Invalid building ID'),
  body('building_id').optional().isUUID().withMessage('Invalid building ID'),
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
