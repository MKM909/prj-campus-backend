const express = require('express');
const { body, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const {
  createDirectMessage,
  createGroup,
  sendMessage,
  getChats,
  getChatMessages
} = require('../controllers/messageController');

const router = express.Router();

// Specific rate limiter for messaging endpoints
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    status: 'error',
    message: 'Too many messaging requests, please try again later'
  }
});

// Apply rate limiting to all messaging routes
router.use(messageLimiter);

// Validation middlewares
const dmValidation = [
  body('targetUserId').isUUID().withMessage('Valid target user ID is required'),
];

const groupValidation = [
  body('name').notEmpty().withMessage('Group name is required').isLength({ max: 50 }).trim().escape(),
  body('participantIds').isArray().withMessage('Participant IDs must be an array'),
  body('participantIds.*').isUUID().withMessage('Invalid participant ID'),
];

const messageValidation = [
  body('body').notEmpty().withMessage('Message body cannot be empty').isLength({ max: 2000 }).trim().escape(),
];

const chatParamValidation = [
  param('chatId').isUUID().withMessage('Valid chat ID is required'),
];

// Routes
router.route('/chats')
  .get(protect, getChats);

router.route('/direct')
  .post(protect, dmValidation, createDirectMessage);

router.route('/group')
  .post(protect, groupValidation, createGroup);

router.route('/:chatId')
  .get(protect, chatParamValidation, getChatMessages)
  .post(protect, chatParamValidation, messageValidation, sendMessage);

module.exports = router;
