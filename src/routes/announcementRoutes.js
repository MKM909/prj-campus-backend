const express = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { protectEventStream, requireAdmin } = require('../middleware/admin');
const {
  listAnnouncements,
  createAnnouncement,
  subscribeToAnnouncementEvents
} = require('../controllers/announcementController');

const router = express.Router();

const priorities = ['normal', 'important', 'urgent', 'critical'];
const audienceRoles = ['all', 'student', 'staff', 'security', 'admin', 'super_admin', 'dept_admin', 'facilities', 'student_affairs', 'it_admin'];

const announcementValidation = [
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 120 }).trim().escape(),
  body('body').notEmpty().withMessage('Announcement body is required').isLength({ max: 2000 }).trim().escape(),
  body('priority').optional().isIn(priorities).withMessage('Invalid priority'),
  body('audienceRole').optional().isIn(audienceRoles).withMessage('Invalid audience role'),
  body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('Expiration date must be ISO8601')
];

router.get('/events', protectEventStream, subscribeToAnnouncementEvents);

router.route('/')
  .get(listAnnouncements)
  .post(protect, requireAdmin, announcementValidation, createAnnouncement);

module.exports = router;
