const express = require('express');
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const { protectEventStream, requireAdmin } = require('../middleware/admin');
const {
  listUsers,
  updateUserRole,
  updateReportStatus,
  subscribeToAdminEvents
} = require('../controllers/adminController');

const router = express.Router();

const allowedRoles = ['student', 'staff', 'security', 'admin'];
const reportStatuses = ['pending', 'community', 'verified', 'critical', 'resolved'];

const roleValidation = [
  param('userId').isUUID().withMessage('Valid user ID is required'),
  body('role').isIn(allowedRoles).withMessage('Role must be student, staff, security, or admin')
];

const reportStatusValidation = [
  param('reportId').isUUID().withMessage('Valid report ID is required'),
  body('status').isIn(reportStatuses).withMessage('Invalid report status')
];

router.get('/events', protectEventStream, requireAdmin, subscribeToAdminEvents);
router.get('/users', protect, requireAdmin, listUsers);
router.patch('/users/:userId/role', protect, requireAdmin, roleValidation, updateUserRole);
router.patch('/reports/:reportId/status', protect, requireAdmin, reportStatusValidation, updateReportStatus);

module.exports = router;
