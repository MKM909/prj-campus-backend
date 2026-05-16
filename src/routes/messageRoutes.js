const express = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { protectEventStream } = require('../middleware/admin');
const {
  getChats,
  createDirectMessage,
  createGroup,
  createCommunity,
  getCommunityOverview,
  createCommunityGroup,
  linkCommunityGroup,
  unlinkCommunityGroup,
  getChatMessages,
  sendMessage,
  updateReceipts,
  editMessage,
  deleteMessage,
  setReaction,
  removeReaction,
  setStarredMessage,
  pinMessage,
  unpinMessage,
  updateChatSettings,
  updateGroupControls,
  addParticipant,
  updateParticipant,
  reviewJoinRequest,
  resetInviteCode,
  joinByInviteCode,
  registerMedia,
  updateMedia,
  listBlocks,
  blockUser,
  unblockUser,
  subscribeToMessageEvents
} = require('../controllers/messageController');

const router = express.Router();

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: {
    status: 'error',
    message: 'Too many messaging requests, please try again later'
  }
});

router.use(messageLimiter);

const uuidParam = (name) => param(name).isUUID().withMessage(`Valid ${name} is required`);
const optionalIso = (name) => body(name).optional({ nullable: true }).isISO8601();
const optionalUuidBody = (name) => body(name).optional({ nullable: true }).isUUID();

const dmValidation = [
  body('targetUserId').isUUID().withMessage('Valid target user ID is required'),
  body('name').optional({ nullable: true }).isLength({ max: 80 }).trim(),
  body('avatarUrl').optional({ nullable: true }).isURL().withMessage('avatarUrl must be a URL')
];

const groupValidation = [
  body('name').notEmpty().withMessage('Group name is required').isLength({ max: 80 }).trim(),
  body('description').optional({ nullable: true }).isLength({ max: 512 }).trim(),
  body('type').optional().isIn(['group', 'community', 'zone', 'course']).withMessage('Invalid group chat type'),
  body('participantIds').optional().isArray().withMessage('participantIds must be an array'),
  body('participantIds.*').optional().isUUID().withMessage('Invalid participant ID'),
  body('sendPolicy').optional().isIn(['all', 'admins']).withMessage('Invalid send policy'),
  body('editInfoPolicy').optional().isIn(['all', 'admins']).withMessage('Invalid edit info policy'),
  body('pinPolicy').optional().isIn(['all', 'admins']).withMessage('Invalid pin policy'),
  body('joinApprovalRequired').optional().isBoolean(),
  body('inviteEnabled').optional().isBoolean(),
  body('disappearingSeconds').optional({ nullable: true }).isInt({ min: 0 }),
  body('retentionDays').optional({ nullable: true }).isInt({ min: 1, max: 3650 }),
  body('metadata').optional().isObject()
];

const communityValidation = [
  body('name').notEmpty().withMessage('Community name is required').isLength({ max: 80 }).trim(),
  body('description').optional({ nullable: true }).isLength({ max: 512 }).trim(),
  body('participantIds').optional().isArray().withMessage('participantIds must be an array'),
  body('participantIds.*').optional().isUUID().withMessage('Invalid participant ID'),
  body('communityMemberVisibility').optional().isIn(['subgroups', 'community_admins']),
  body('communityJoinPolicy').optional().isIn(['admins', 'open']),
  body('maxSubgroups').optional().isInt({ min: 1, max: 50 }),
  body('maxAnnouncementMembers').optional().isInt({ min: 1, max: 2000 }),
  body('metadata').optional().isObject()
];

const communityParamValidation = [
  uuidParam('communityId')
];

const communityGroupValidation = [
  uuidParam('communityId'),
  body('name').notEmpty().withMessage('Group name is required').isLength({ max: 80 }).trim(),
  body('description').optional({ nullable: true }).isLength({ max: 512 }).trim(),
  body('type').optional().isIn(['group', 'zone', 'course']),
  body('participantIds').optional().isArray().withMessage('participantIds must be an array'),
  body('participantIds.*').optional().isUUID().withMessage('Invalid participant ID'),
  body('sendPolicy').optional().isIn(['all', 'admins']),
  body('joinApprovalRequired').optional().isBoolean(),
  body('metadata').optional().isObject()
];

const communityLinkValidation = [
  uuidParam('communityId'),
  uuidParam('chatId')
];

const listChatsValidation = [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('cursor').optional().isISO8601(),
  query('type').optional().isIn(['direct', 'group', 'community', 'zone', 'course'])
];

const chatParamValidation = [uuidParam('chatId')];

const listMessagesValidation = [
  uuidParam('chatId'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isISO8601(),
  query('after').optional().isISO8601()
];

const messageValidation = [
  uuidParam('chatId'),
  body('body').optional({ nullable: true }).isLength({ max: 10000 }).trim(),
  body('content').optional({ nullable: true }).isLength({ max: 10000 }).trim(),
  body('text').optional({ nullable: true }).isLength({ max: 10000 }).trim(),
  body('id').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('clientMessageId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('localId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('type').optional().isIn(['text', 'image', 'video', 'audio', 'document', 'sticker', 'poll', 'system', 'contact', 'location']),
  body('replyToId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('repliedToMessageId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('replyToClientMessageId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('attachments').optional().isArray(),
  body('attachments.*.url').optional({ nullable: true }).isURL(),
  body('attachments.*.fileHash').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('attachmentUrl').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('attachmentName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('attachmentSize').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('audioDuration').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('mentions').optional().isArray(),
  body('mentions.*').optional().isUUID(),
  body('metadata').optional().isObject(),
  body('isForwarded').optional().isBoolean(),
  body('forwardCount').optional().isInt({ min: 0 }),
  optionalIso('expiresAt')
];

const receiptValidation = [
  uuidParam('chatId'),
  body('status').optional().isIn(['delivered', 'read', 'played']),
  body('messageIds').optional().isArray(),
  body('messageIds.*').optional().isUUID(),
  optionalUuidBody('upToMessageId'),
  optionalIso('readAt'),
  optionalIso('deliveredAt')
];

const messageIdValidation = [uuidParam('messageId')];

const editValidation = [
  uuidParam('messageId'),
  body('body').optional({ nullable: true }).isLength({ max: 10000 }).trim(),
  body('content').optional({ nullable: true }).isLength({ max: 10000 }).trim(),
  body('text').optional({ nullable: true }).isLength({ max: 10000 }).trim()
];

const deleteValidation = [
  uuidParam('messageId'),
  query('scope').optional().isIn(['me', 'everyone']),
  body('scope').optional().isIn(['me', 'everyone'])
];

const reactionValidation = [
  uuidParam('messageId'),
  body('emoji').notEmpty().withMessage('emoji is required').isLength({ min: 1, max: 16 })
];

const pinValidation = [
  uuidParam('chatId'),
  body('messageId').isUUID().withMessage('messageId is required'),
  optionalIso('expiresAt')
];

const unpinValidation = [uuidParam('chatId'), uuidParam('messageId')];

const settingsValidation = [
  uuidParam('chatId'),
  body('mutedUntil').optional({ nullable: true }).isISO8601(),
  body('notificationLevel').optional().isIn(['all', 'mentions', 'urgent', 'none']),
  body('isPinned').optional().isBoolean(),
  body('isArchived').optional().isBoolean()
];

const groupControlsValidation = [
  uuidParam('chatId'),
  body('name').optional().isLength({ max: 80 }).trim(),
  body('description').optional({ nullable: true }).isLength({ max: 512 }).trim(),
  body('sendPolicy').optional().isIn(['all', 'admins']),
  body('editInfoPolicy').optional().isIn(['all', 'admins']),
  body('pinPolicy').optional().isIn(['all', 'admins']),
  body('joinApprovalRequired').optional().isBoolean(),
  body('inviteEnabled').optional().isBoolean(),
  body('disappearingSeconds').optional({ nullable: true }).isInt({ min: 0 }),
  body('retentionDays').optional({ nullable: true }).isInt({ min: 1, max: 3650 }),
  body('metadata').optional().isObject()
];

const participantValidation = [
  uuidParam('chatId'),
  body('userId').isUUID().withMessage('userId is required'),
  body('role').optional().isIn(['owner', 'admin', 'moderator', 'member'])
];

const updateParticipantValidation = [
  uuidParam('chatId'),
  uuidParam('userId'),
  body('role').optional().isIn(['owner', 'admin', 'moderator', 'member']),
  body('status').optional().isIn(['active', 'pending', 'left', 'removed']),
  body('isApproved').optional().isBoolean(),
  body('notificationLevel').optional().isIn(['all', 'mentions', 'urgent', 'none'])
];

const reviewJoinValidation = [
  uuidParam('chatId'),
  uuidParam('userId'),
  body('status').optional().isIn(['approved', 'rejected'])
];

const inviteCodeValidation = [
  param('inviteCode').isString().isLength({ min: 8, max: 80 })
];

const mediaValidation = [
  body('fileHash').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('encryptedHash').optional({ nullable: true }).isString().isLength({ max: 128 }),
  body('cdnUrl').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('thumbnailUrl').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('fileName').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('fileSize').optional({ nullable: true }).isInt({ min: 0 }),
  body('mimeType').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('uploadStatus').optional().isIn(['pending', 'uploading', 'completed', 'failed']),
  body('uploadSessionId').optional({ nullable: true }).isString().isLength({ max: 128 }),
  optionalIso('expiresAt'),
  body('metadata').optional().isObject()
];

const mediaUpdateValidation = [
  uuidParam('mediaId'),
  body('cdnUrl').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('thumbnailUrl').optional({ nullable: true }).isString().isLength({ max: 2048 }),
  body('uploadStatus').optional().isIn(['pending', 'uploading', 'completed', 'failed']),
  body('uploadProgress').optional().isFloat({ min: 0, max: 1 }),
  body('metadata').optional().isObject(),
  optionalIso('expiresAt')
];

const blockValidation = [
  body('blockedUserId').isUUID().withMessage('blockedUserId is required'),
  body('reason').optional({ nullable: true }).isString().isLength({ max: 160 })
];

const unblockValidation = [param('blockedUserId').isUUID().withMessage('blockedUserId is required')];

// Persistent event stream for the Express-token path.
router.get('/events', protectEventStream, subscribeToMessageEvents);

// Collections and direct/group creation.
router.get('/chats', protect, listChatsValidation, getChats);
router.post('/direct', protect, dmValidation, createDirectMessage);
router.post('/group', protect, groupValidation, createGroup);
router.post('/community', protect, communityValidation, createCommunity);
router.get('/community/:communityId', protect, communityParamValidation, getCommunityOverview);
router.post('/community/:communityId/groups', protect, communityGroupValidation, createCommunityGroup);
router.post('/community/:communityId/groups/:chatId', protect, communityLinkValidation, linkCommunityGroup);
router.delete('/community/:communityId/groups/:chatId', protect, communityLinkValidation, unlinkCommunityGroup);

// Blocks and privacy.
router.get('/blocks', protect, listBlocks);
router.post('/blocks', protect, blockValidation, blockUser);
router.delete('/blocks/:blockedUserId', protect, unblockValidation, unblockUser);

// Media hash/dedup registration. Actual bytes still upload via CDN/storage client.
router.post('/media', protect, mediaValidation, registerMedia);
router.patch('/media/:mediaId', protect, mediaUpdateValidation, updateMedia);

// Invite links.
router.post('/invite/:inviteCode/join', protect, inviteCodeValidation, joinByInviteCode);

// Message-specific actions must be before /:chatId.
router.patch('/message/:messageId', protect, editValidation, editMessage);
router.delete('/message/:messageId', protect, deleteValidation, deleteMessage);
router.post('/message/:messageId/reactions', protect, reactionValidation, setReaction);
router.delete('/message/:messageId/reactions', protect, messageIdValidation, removeReaction);
router.post('/message/:messageId/star', protect, messageIdValidation, setStarredMessage);
router.delete('/message/:messageId/star', protect, messageIdValidation, setStarredMessage);

// Chat controls and lifecycle.
router.patch('/:chatId/receipts', protect, receiptValidation, updateReceipts);
router.patch('/:chatId/settings', protect, settingsValidation, updateChatSettings);
router.patch('/:chatId/group', protect, groupControlsValidation, updateGroupControls);
router.post('/:chatId/pins', protect, pinValidation, pinMessage);
router.delete('/:chatId/pins/:messageId', protect, unpinValidation, unpinMessage);
router.post('/:chatId/participants', protect, participantValidation, addParticipant);
router.patch('/:chatId/participants/:userId', protect, updateParticipantValidation, updateParticipant);
router.delete('/:chatId/participants/:userId', protect, updateParticipantValidation, updateParticipant);
router.patch('/:chatId/join-requests/:userId', protect, reviewJoinValidation, reviewJoinRequest);
router.post('/:chatId/invite/reset', protect, chatParamValidation, resetInviteCode);

router.route('/:chatId')
  .get(protect, listMessagesValidation, getChatMessages)
  .post(protect, messageValidation, sendMessage);

module.exports = router;
