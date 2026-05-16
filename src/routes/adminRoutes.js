const express = require('express');
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { protectEventStream, requireAdmin, requireSuperAdmin } = require('../middleware/admin');
const {
  ADMIN_ROLES,
  addOfficialReportComment,
  adjustUserReliability,
  assignReport,
  captureTensionSnapshot,
  createBroadcast,
  createStaffUser,
  deleteReport,
  escalateReport,
  getAdminReport,
  getAdminZones,
  getAnalytics,
  getAuditLog,
  getBroadcastTemplates,
  getBudgetEvidence,
  getDashboardStats,
  getIncidents,
  getInbox,
  getMentions,
  getPredictions,
  getSentiment,
  getSettings,
  getSosHistory,
  getTensionHistory,
  listAdminNotifications,
  listAdminReports,
  listBroadcasts,
  listEscalations,
  listUsers,
  markNotificationRead,
  markReportDuplicate,
  processScheduledBroadcasts,
  runEscalationSweep,
  subscribeToAdminEvents,
  updateReportLifecycle,
  updateReportStatus,
  updateSettings,
  updateUser,
  updateUserRole,
  updateZoneStatus
} = require('../controllers/adminController');

const router = express.Router();

const reportStatuses = ['pending', 'community', 'verified', 'critical', 'resolved'];
const lifecycleStatuses = ['submitted', 'acknowledged', 'in_progress', 'resolved'];
const zoneStatuses = ['normal', 'watch', 'alert', 'critical', 'maintenance', 'closed'];
const broadcastPriorities = ['normal', 'important', 'urgent', 'critical'];

const uuidParam = (name) => param(name).isUUID().withMessage(`${name} must be a valid UUID`);

const reportListValidation = [
  query('status').optional().isIn(reportStatuses),
  query('lifecycle').optional().isIn(lifecycleStatuses),
  query('zoneId').optional().isUUID(),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('page').optional().isInt({ min: 1 })
];

const lifecycleValidation = [
  uuidParam('id'),
  body('status').optional().isIn(lifecycleStatuses),
  body('lifecycleStatus').optional().isIn(lifecycleStatuses),
  body('lifecycle_status').optional().isIn(lifecycleStatuses),
  body().custom((value) => {
    if (!value.status && !value.lifecycleStatus && !value.lifecycle_status) {
      throw new Error('Lifecycle status is required');
    }
    return true;
  })
];

const assignmentValidation = [
  uuidParam('id'),
  body('department').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('assignedDepartment').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('assigned_department').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('assigneeId').optional({ nullable: true }).isUUID(),
  body('assigned_to').optional({ nullable: true }).isUUID(),
  body().custom((value) => {
    if (!value.department && !value.assignedDepartment && !value.assigned_department) {
      throw new Error('Department is required');
    }
    return true;
  })
];

const commentValidation = [
  uuidParam('id'),
  body('body').notEmpty().isLength({ max: 2000 }).trim(),
  body('isOfficial').optional().isBoolean(),
  body('mentionedDepartments').optional().isArray(),
  body('mentioned_departments').optional().isArray()
];

const duplicateValidation = [
  uuidParam('id'),
  body('duplicateOf').optional().isUUID(),
  body('duplicate_of').optional().isUUID(),
  body().custom((value) => {
    if (!value.duplicateOf && !value.duplicate_of) throw new Error('Duplicate report ID is required');
    return true;
  })
];

const reportStatusValidation = [
  uuidParam('reportId'),
  body('status').isIn(reportStatuses).withMessage('Invalid report status')
];

const zoneStatusValidation = [
  uuidParam('id'),
  body('status').isIn(zoneStatuses),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('maintenanceMode').optional().isBoolean(),
  body('isActive').optional().isBoolean()
];

const broadcastValidation = [
  body('title').notEmpty().isLength({ max: 120 }).trim(),
  body('body').optional().isLength({ max: 2000 }).trim(),
  body('message').optional().isLength({ max: 2000 }).trim(),
  body().custom((value) => {
    if (!value.body && !value.message) throw new Error('Broadcast body/message is required');
    return true;
  }),
  body('priority').optional().isIn(broadcastPriorities),
  body('scheduledFor').optional({ nullable: true }).isISO8601(),
  body('scheduled_for').optional({ nullable: true }).isISO8601(),
  body('targetZoneId').optional({ nullable: true }).isUUID(),
  body('target_zone_id').optional({ nullable: true }).isUUID()
];

const userUpdateValidation = [
  param('id').optional().isUUID(),
  param('userId').optional().isUUID(),
  body('role').optional().isIn([...ADMIN_ROLES, 'student', 'staff']),
  body('reliability_score').optional().isFloat({ min: 0, max: 10 }),
  body('reliabilityScore').optional().isFloat({ min: 0, max: 10 }),
  body('display_name').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('department').optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body('status').optional().isIn(['active', 'suspended', 'deleted'])
];

const staffCreateValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('displayName').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('display_name').optional().isString().trim().isLength({ min: 2, max: 80 }),
  body('department').optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body('role').optional().isIn([...ADMIN_ROLES, 'staff'])
];

const reliabilityAdjustmentValidation = [
  uuidParam('id'),
  body('reliabilityScore').optional().isFloat({ min: 0, max: 10 }),
  body('reliability_score').optional().isFloat({ min: 0, max: 10 }),
  body('reason').notEmpty().isString().trim().isLength({ min: 3, max: 500 }),
  body().custom((value) => {
    if (value.reliabilityScore === undefined && value.reliability_score === undefined) {
      throw new Error('Reliability score is required');
    }
    return true;
  })
];

router.get('/events', protectEventStream, requireAdmin, subscribeToAdminEvents);
router.get('/realtime', protectEventStream, requireAdmin, subscribeToAdminEvents);

router.use(protect, requireAdmin);

router.get('/dashboard/stats', getDashboardStats);

router.get('/reports', reportListValidation, listAdminReports);
router.get('/reports/:id', uuidParam('id'), getAdminReport);
router.patch('/reports/:id/lifecycle', lifecycleValidation, updateReportLifecycle);
router.patch('/reports/:id/assign', assignmentValidation, assignReport);
router.post('/reports/:id/comments', commentValidation, addOfficialReportComment);
router.patch('/reports/:id/escalate', uuidParam('id'), escalateReport);
router.patch('/reports/:id/duplicate', duplicateValidation, markReportDuplicate);
router.delete('/reports/:id', uuidParam('id'), requireSuperAdmin, deleteReport);

// Backward compatible route already used by the existing dashboard prototype.
router.patch('/reports/:reportId/status', reportStatusValidation, updateReportStatus);

router.get('/zones', getAdminZones);
router.patch('/zones/:id/status', zoneStatusValidation, updateZoneStatus);

router.get('/analytics', query('range').optional().isString().trim(), getAnalytics);
router.get('/sentiment', getSentiment);
router.get('/sentiment/history', query('limit').optional().isInt({ min: 1, max: 200 }), getTensionHistory);
router.post('/sentiment/snapshot', captureTensionSnapshot);
router.get('/predictions', getPredictions);
router.get('/budget-evidence', getBudgetEvidence);
router.get('/incidents', getIncidents);
router.get('/sos', query('limit').optional().isInt({ min: 1, max: 200 }), getSosHistory);

router.get('/broadcasts/templates', getBroadcastTemplates);
router.post('/broadcasts/process-scheduled', requireSuperAdmin, processScheduledBroadcasts);
router.get('/broadcasts', listBroadcasts);
router.post('/broadcasts', broadcastValidation, createBroadcast);

router.get('/inbox', getInbox);
router.get('/mentions', getMentions);
router.get('/escalations', listEscalations);
router.post('/escalations/run', runEscalationSweep);
router.get('/notifications', query('limit').optional().isInt({ min: 1, max: 200 }), listAdminNotifications);
router.patch('/notifications/:id/read', uuidParam('id'), markNotificationRead);

router.get('/users', requireSuperAdmin, listUsers);
router.post('/users', requireSuperAdmin, staffCreateValidation, createStaffUser);
router.post('/users/:id/reliability-adjustments', requireSuperAdmin, reliabilityAdjustmentValidation, adjustUserReliability);
router.patch('/users/:id', requireSuperAdmin, userUpdateValidation, updateUser);
router.patch('/users/:userId/role', requireSuperAdmin, userUpdateValidation, updateUserRole);

router.get('/settings', requireSuperAdmin, getSettings);
router.patch('/settings', requireSuperAdmin, updateSettings);
router.get('/audit', requireSuperAdmin, getAuditLog);

module.exports = router;
