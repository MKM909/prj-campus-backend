const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');
const { hub, emitRealtimeEvent } = require('../utils/realtimeHub');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

const MESSAGE_TYPES = new Set([
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'poll',
  'system',
  'contact',
  'location'
]);

const CHAT_TYPES = new Set(['direct', 'group', 'community', 'zone', 'course']);
const GROUP_ROLES = new Set(['owner', 'admin', 'moderator', 'member']);
const ACTIVE_PARTICIPANT_STATES = new Set(['active']);

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && uuidRegex.test(value);

const getValidationResponse = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ status: 'error', errors: errors.array() });
    return true;
  }
  return false;
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const handleControllerError = (res, label, error, fallbackMessage) => {
  console.error(`${label}:`, error.message);
  res.status(error.statusCode || 500).json({
    status: 'error',
    message: error.statusCode ? error.message : fallbackMessage
  });
};

const clampLimit = (rawLimit) => {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, parsed));
};

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );

const asArray = (value) => (Array.isArray(value) ? value : []);

const getChat = async (chatId) => {
  const { data: chat, error } = await supabase
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .maybeSingle();

  if (error) throw error;
  return chat;
};

const getParticipant = async (chatId, userId) => {
  const { data: participant, error } = await supabase
    .from('chat_participants')
    .select('*')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return participant;
};

const requireActiveParticipant = async (chatId, userId) => {
  const [chat, participant] = await Promise.all([
    getChat(chatId),
    getParticipant(chatId, userId)
  ]);

  if (!chat) throw createHttpError(404, 'Chat not found');
  if (!participant || !ACTIVE_PARTICIPANT_STATES.has(participant.status || 'active')) {
    throw createHttpError(403, 'Not authorized to access this chat');
  }

  if (participant.is_approved === false) {
    throw createHttpError(403, 'Join request is still pending approval');
  }

  return { chat, participant };
};

const isPrivilegedRole = (role) => ['owner', 'admin', 'moderator'].includes(role);

const requirePrivilegedParticipant = async (chatId, userId) => {
  const context = await requireActiveParticipant(chatId, userId);
  if (!isPrivilegedRole(context.participant.role)) {
    throw createHttpError(403, 'Group admin access required');
  }
  return context;
};

const requireCommunityAdmin = async (communityId, userId) => {
  const context = await requirePrivilegedParticipant(communityId, userId);
  if (context.chat.type !== 'community') {
    throw createHttpError(400, 'Target chat is not a community');
  }
  return context;
};

const getParticipants = async (chatId, columns = '*') => {
  const { data: participants, error } = await supabase
    .from('chat_participants')
    .select(columns)
    .eq('chat_id', chatId)
    .eq('status', 'active');

  if (error) throw error;
  return participants || [];
};

const getDirectRecipientId = async (chatId, senderId) => {
  const participants = await getParticipants(chatId, 'user_id');
  const recipient = participants.find((participant) => participant.user_id !== senderId);
  return recipient?.user_id || null;
};

const getBlocksBetween = async (userA, userB) => {
  if (!userA || !userB) return [];

  const { data: blocks, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .in('blocker_id', [userA, userB])
    .in('blocked_id', [userA, userB]);

  if (error) throw error;
  return blocks || [];
};

const normalizeAttachmentPayloads = (body) => {
  const attachments = [...asArray(body.attachments)];

  if (body.attachmentUrl || body.attachment_url) {
    attachments.push({
      url: body.attachmentUrl || body.attachment_url,
      thumbnailUrl: body.thumbnailUrl || body.thumbnail_url,
      fileName: body.attachmentName || body.attachment_name,
      fileSizeLabel: body.attachmentSize || body.attachment_size,
      fileSize: body.fileSize || body.file_size,
      fileHash: body.fileHash || body.file_hash,
      mimeType: body.mimeType || body.mime_type,
      type: body.type,
      audioDuration: body.audioDuration || body.audio_duration,
      width: body.width,
      height: body.height,
      uploadStatus: body.uploadStatus || body.upload_status
    });
  }

  return attachments.filter((attachment) => attachment && (attachment.url || attachment.mediaId || attachment.fileHash));
};

const normalizeMessageBody = (payload) => {
  const text = payload.body ?? payload.content ?? payload.text ?? '';
  return typeof text === 'string' ? text.trim() : String(text);
};

const normalizeMessageType = (payload, attachments) => {
  const requestedType = payload.type || payload.messageType || payload.message_type;
  if (requestedType && MESSAGE_TYPES.has(requestedType)) return requestedType;
  const firstAttachment = attachments[0];
  if (firstAttachment?.type && MESSAGE_TYPES.has(firstAttachment.type)) return firstAttachment.type;
  if (firstAttachment?.mimeType?.startsWith('image/')) return 'image';
  if (firstAttachment?.mimeType?.startsWith('video/')) return 'video';
  if (firstAttachment?.mimeType?.startsWith('audio/')) return 'audio';
  if (firstAttachment) return 'document';
  return 'text';
};

const buildMessageInsert = ({ chatId, senderId, chat, bodyPayload, suppressedForUserIds }) => {
  const attachments = normalizeAttachmentPayloads(bodyPayload);
  const messageBody = normalizeMessageBody(bodyPayload);
  const type = normalizeMessageType(bodyPayload, attachments);
  const requestedId = isUuid(bodyPayload.id) ? bodyPayload.id : undefined;
  const clientMessageId =
    bodyPayload.clientMessageId ||
    bodyPayload.client_message_id ||
    bodyPayload.localId ||
    bodyPayload.local_id ||
    bodyPayload.id ||
    null;
  const replyReference =
    bodyPayload.replyToId || bodyPayload.reply_to_id || bodyPayload.repliedToMessageId || null;

  if (!messageBody && attachments.length === 0 && !['system', 'poll', 'sticker', 'location', 'contact'].includes(type)) {
    throw createHttpError(400, 'Message body or attachment is required');
  }

  const expiresAt =
    bodyPayload.expiresAt ||
    bodyPayload.expires_at ||
    (chat.disappearing_seconds
      ? new Date(Date.now() + Number(chat.disappearing_seconds) * 1000).toISOString()
      : null);

  return {
    message: compactObject({
      id: requestedId,
      client_message_id: clientMessageId,
      chat_id: chatId,
      sender_id: senderId,
      body: messageBody || null,
      type,
      reply_to_id: isUuid(replyReference) ? replyReference : null,
      reply_to_client_message_id:
        bodyPayload.replyToClientMessageId ||
        bodyPayload.reply_to_client_message_id ||
        (!isUuid(replyReference) ? replyReference : null),
      message_status: 'sent',
      delivery_state: 'sent',
      sent_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      deleted_by: null,
      delete_scope: null,
      is_forwarded: Boolean(bodyPayload.isForwarded || bodyPayload.is_forwarded),
      forwarded_from_message_id:
        bodyPayload.forwardedFromMessageId || bodyPayload.forwarded_from_message_id || null,
      forward_count: Number.isInteger(bodyPayload.forwardCount)
        ? bodyPayload.forwardCount
        : Number.isInteger(bodyPayload.forward_count)
          ? bodyPayload.forward_count
          : 0,
      mentions: asArray(bodyPayload.mentions),
      metadata:
        bodyPayload.metadata && typeof bodyPayload.metadata === 'object'
          ? bodyPayload.metadata
          : {},
      sent_via_mesh: Boolean(bodyPayload.sentViaMesh || bodyPayload.sent_via_mesh),
      suppressed_for_user_ids: suppressedForUserIds,
      expires_at: expiresAt
    }),
    attachments
  };
};

const normalizeAttachmentInsert = (messageId, attachment) =>
  compactObject({
    id: isUuid(attachment.id) ? attachment.id : undefined,
    message_id: messageId,
    media_id: isUuid(attachment.mediaId || attachment.media_id)
      ? attachment.mediaId || attachment.media_id
      : null,
    kind: attachment.type || attachment.kind || 'document',
    cdn_url: attachment.url || attachment.cdnUrl || attachment.cdn_url,
    thumbnail_url: attachment.thumbnailUrl || attachment.thumbnail_url || null,
    file_name: attachment.fileName || attachment.file_name || null,
    file_size: attachment.fileSize || attachment.file_size || null,
    file_size_label: attachment.fileSizeLabel || attachment.file_size_label || null,
    mime_type: attachment.mimeType || attachment.mime_type || null,
    file_hash: attachment.fileHash || attachment.file_hash || null,
    encrypted_hash: attachment.encryptedHash || attachment.encrypted_hash || null,
    upload_session_id: attachment.uploadSessionId || attachment.upload_session_id || null,
    upload_status: attachment.uploadStatus || attachment.upload_status || 'completed',
    duration_ms: attachment.durationMs || attachment.duration_ms || null,
    duration_label: attachment.audioDuration || attachment.audio_duration || attachment.durationLabel || null,
    width: attachment.width || null,
    height: attachment.height || null,
    metadata: attachment.metadata || {}
  });

const includeMessageRelations = `
  *,
  users(display_name, avatar_url, email),
  chat_message_attachments(*),
  chat_message_reactions(*),
  chat_read_receipts(*)
`;

const filterMessagesForViewer = (messages, userId, blocks = []) => {
  const blockedSenderIds = new Set(
    blocks
      .filter((block) => block.blocker_id === userId)
      .map((block) => block.blocked_id)
  );

  return (messages || []).filter((message) => {
    if (asArray(message.suppressed_for_user_ids).includes(userId)) return false;
    if (blockedSenderIds.has(message.sender_id)) return false;
    return true;
  });
};

const fetchViewerBlocks = async (userId) => {
  const { data: blocks, error } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
    .eq('blocker_id', userId);

  if (error) throw error;
  return blocks || [];
};

const emitChatEvent = (type, chatId, payload) => {
  emitRealtimeEvent(`message.${type}`, {
    chat_id: chatId,
    ...payload
  });
};

const touchChatLastMessage = async (chatId, messageId) => {
  const { error } = await supabase
    .from('chats')
    .update({
      last_message_id: messageId,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', chatId);

  if (error) throw error;
};

const upsertSenderReceipt = async (messageId, userId) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('chat_read_receipts')
    .upsert(
      {
        message_id: messageId,
        user_id: userId,
        delivered_at: now,
        read_at: now,
        created_at: now,
        updated_at: now
      },
      { onConflict: 'message_id,user_id' }
    );

  if (error) throw error;
};

// @desc    Get chats for current user with summary fields
// @route   GET /api/messages/chats
// @access  Private
const getChats = async (req, res) => {
  const authUserId = req.user.id;
  const limit = clampLimit(req.query.limit);
  const { type, cursor } = req.query;

  try {
    let query = supabase
      .from('chat_participants')
      .select(`
        chat_id,
        role,
        status,
        is_approved,
        joined_at,
        last_read_at,
        muted_until,
        notification_level,
        is_pinned,
        pinned_at,
        is_archived,
        chats(
          *,
          chat_messages!chats_last_message_id_fkey(*)
        )
      `)
      .eq('user_id', authUserId)
      .eq('status', 'active')
      .order('pinned_at', { ascending: false, nullsFirst: false })
      .order('joined_at', { ascending: false })
      .limit(limit);

    if (type && CHAT_TYPES.has(type)) {
      query = query.eq('chats.type', type);
    }
    if (cursor) {
      query = query.lt('joined_at', cursor);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const chatRows = rows || [];
    const unreadCounts = await Promise.all(
      chatRows.map(async (row) => {
        const lastReadAt = row.last_read_at || row.joined_at || '1970-01-01T00:00:00.000Z';
        const { count, error: countError } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('chat_id', row.chat_id)
          .neq('sender_id', authUserId)
          .is('deleted_at', null)
          .gt('created_at', lastReadAt);

        if (countError) return 0;
        return count || 0;
      })
    );

    const data = chatRows.map((row, index) => ({
      ...row,
      unread_count: unreadCounts[index]
    }));

    res.json({
      status: 'success',
      results: data.length,
      nextCursor: data.length === limit ? data[data.length - 1].joined_at : null,
      data
    });
  } catch (error) {
    handleControllerError(res, 'Get Chats Error', error, 'Failed to get chats');
  }
};

// @desc    Create or find a direct chat
// @route   POST /api/messages/direct
// @access  Private
const createDirectMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { targetUserId } = req.body;
  const authUserId = req.user.id;

  if (targetUserId === authUserId) {
    return res.status(400).json({ status: 'error', message: 'Cannot chat with yourself' });
  }

  try {
    const { data: userChats, error: userChatsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', authUserId)
      .eq('status', 'active');

    if (userChatsError) throw userChatsError;

    if (userChats?.length) {
      const chatIds = userChats.map((chat) => chat.chat_id);
      const { data: existingDirectChats, error: existingChatsError } = await supabase
        .from('chats')
        .select('id')
        .in('id', chatIds)
        .eq('type', 'direct');

      if (existingChatsError) throw existingChatsError;

      if (existingDirectChats?.length) {
        const { data: match, error: matchError } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .in('chat_id', existingDirectChats.map((chat) => chat.id))
          .eq('user_id', targetUserId)
          .eq('status', 'active')
          .maybeSingle();

        if (matchError) throw matchError;
        if (match) {
          return res.status(200).json({
            status: 'success',
            data: { chatId: match.chat_id, existing: true }
          });
        }
      }
    }

    const { data: newChat, error: createError } = await supabase
      .from('chats')
      .insert([
        {
          type: 'direct',
          created_by: authUserId,
          name: req.body.name || null,
          avatar_url: req.body.avatarUrl || req.body.avatar_url || null
        }
      ])
      .select()
      .single();

    if (createError) throw createError;

    const { error: partError } = await supabase
      .from('chat_participants')
      .insert([
        { chat_id: newChat.id, user_id: authUserId, role: 'owner', status: 'active', is_approved: true },
        { chat_id: newChat.id, user_id: targetUserId, role: 'member', status: 'active', is_approved: true }
      ]);

    if (partError) throw partError;

    emitChatEvent('chat.created', newChat.id, { chat: newChat });

    res.status(201).json({
      status: 'success',
      data: { chatId: newChat.id, existing: false, chat: newChat }
    });
  } catch (error) {
    handleControllerError(res, 'Create DM Error', error, 'Failed to create direct message');
  }
};

// @desc    Create a group/community/zone/course chat
// @route   POST /api/messages/group
// @access  Private
const createGroup = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const {
    name,
    description,
    participantIds = [],
    type = 'group',
    avatarUrl,
    zoneId,
    metadata = {},
    sendPolicy = 'all',
    editInfoPolicy = 'admins',
    pinPolicy = 'admins',
    joinApprovalRequired = false,
    inviteEnabled = true,
    disappearingSeconds = null,
    retentionDays = 30
  } = req.body;
  const authUserId = req.user.id;

  if (!CHAT_TYPES.has(type) || type === 'direct') {
    return res.status(400).json({ status: 'error', message: 'Invalid group chat type' });
  }

  try {
    const { data: newChat, error: createError } = await supabase
      .from('chats')
      .insert([
        {
          type,
          name,
          description: description || null,
          avatar_url: avatarUrl || req.body.avatar_url || null,
          zone_id: zoneId || req.body.zone_id || null,
          created_by: authUserId,
          send_policy: sendPolicy,
          edit_info_policy: editInfoPolicy,
          pin_policy: pinPolicy,
          join_approval_required: Boolean(joinApprovalRequired),
          invite_enabled: Boolean(inviteEnabled),
          disappearing_seconds: disappearingSeconds,
          retention_days: retentionDays,
          metadata
        }
      ])
      .select()
      .single();

    if (createError) throw createError;

    const uniqueParticipantIds = [...new Set([authUserId, ...participantIds])];
    const participants = uniqueParticipantIds.map((id) => ({
      chat_id: newChat.id,
      user_id: id,
      role: id === authUserId ? 'owner' : 'member',
      status: 'active',
      is_approved: true,
      notification_level: 'all'
    }));

    const { error: partError } = await supabase
      .from('chat_participants')
      .insert(participants);

    if (partError) throw partError;

    emitChatEvent('chat.created', newChat.id, { chat: newChat });

    res.status(201).json({
      status: 'success',
      data: { ...newChat, participants }
    });
  } catch (error) {
    handleControllerError(res, 'Create Group Error', error, 'Failed to create group');
  }
};

// @desc    Create a WhatsApp-style community with announcement channel
// @route   POST /api/messages/community
// @access  Private
const createCommunity = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const {
    name,
    description,
    participantIds = [],
    avatarUrl,
    metadata = {},
    communityMemberVisibility = 'subgroups',
    communityJoinPolicy = 'admins',
    maxSubgroups = 50,
    maxAnnouncementMembers = 2000
  } = req.body;
  const authUserId = req.user.id;

  try {
    const { data: community, error: communityError } = await supabase
      .from('chats')
      .insert([
        {
          type: 'community',
          name,
          description: description || null,
          avatar_url: avatarUrl || req.body.avatar_url || null,
          created_by: authUserId,
          send_policy: 'admins',
          edit_info_policy: 'admins',
          pin_policy: 'admins',
          join_approval_required: true,
          invite_enabled: true,
          community_member_visibility: communityMemberVisibility,
          community_join_policy: communityJoinPolicy,
          max_subgroups: maxSubgroups,
          max_announcement_members: maxAnnouncementMembers,
          metadata
        }
      ])
      .select()
      .single();

    if (communityError) throw communityError;

    const { data: announcementChat, error: announcementError } = await supabase
      .from('chats')
      .insert([
        {
          type: 'group',
          name: `${name} Announcements`,
          description: 'Community-wide admin announcements',
          avatar_url: avatarUrl || req.body.avatar_url || null,
          community_id: community.id,
          is_announcement_channel: true,
          created_by: authUserId,
          send_policy: 'admins',
          edit_info_policy: 'admins',
          pin_policy: 'admins',
          join_approval_required: true,
          invite_enabled: false,
          retention_days: req.body.retentionDays || req.body.retention_days || 30,
          metadata: { communityAnnouncement: true }
        }
      ])
      .select()
      .single();

    if (announcementError) throw announcementError;

    const uniqueParticipantIds = [...new Set([authUserId, ...participantIds])];
    const communityParticipants = uniqueParticipantIds.map((id) => ({
      chat_id: community.id,
      user_id: id,
      role: id === authUserId ? 'owner' : 'member',
      status: 'active',
      is_approved: true,
      notification_level: id === authUserId ? 'all' : 'urgent'
    }));
    const announcementParticipants = uniqueParticipantIds.map((id) => ({
      chat_id: announcementChat.id,
      user_id: id,
      role: id === authUserId ? 'owner' : 'member',
      status: 'active',
      is_approved: true,
      notification_level: 'urgent'
    }));

    const { error: participantsError } = await supabase
      .from('chat_participants')
      .insert([...communityParticipants, ...announcementParticipants]);

    if (participantsError) throw participantsError;

    const { data: updatedCommunity, error: updateError } = await supabase
      .from('chats')
      .update({
        announcement_chat_id: announcementChat.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', community.id)
      .select()
      .single();

    if (updateError) throw updateError;

    emitChatEvent('community.created', community.id, {
      community: updatedCommunity,
      announcement_chat: announcementChat
    });

    res.status(201).json({
      status: 'success',
      data: {
        community: updatedCommunity,
        announcementChat,
        participants: communityParticipants
      }
    });
  } catch (error) {
    handleControllerError(res, 'Create Community Error', error, 'Failed to create community');
  }
};

// @desc    Get community overview with announcement channel and visible groups
// @route   GET /api/messages/community/:communityId
// @access  Private
const getCommunityOverview = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { communityId } = req.params;
  const authUserId = req.user.id;

  try {
    const { chat: community, participant } = await requireActiveParticipant(communityId, authUserId);
    if (community.type !== 'community') {
      throw createHttpError(400, 'Target chat is not a community');
    }

    const isCommunityAdmin = isPrivilegedRole(participant.role);
    const { data: groups, error: groupsError } = await supabase
      .from('chats')
      .select('*')
      .eq('community_id', communityId)
      .order('is_announcement_channel', { ascending: false })
      .order('created_at', { ascending: true });

    if (groupsError) throw groupsError;

    const groupIds = (groups || []).map((group) => group.id);
    let memberships = [];
    if (groupIds.length > 0) {
      const { data, error } = await supabase
        .from('chat_participants')
        .select('*')
        .in('chat_id', groupIds)
        .eq('user_id', authUserId);

      if (error) throw error;
      memberships = data || [];
    }

    const membershipByChat = new Map(
      memberships.map((membership) => [membership.chat_id, membership])
    );
    const visibleGroups = isCommunityAdmin
      ? groups || []
      : (groups || []).filter((group) => membershipByChat.has(group.id));

    res.json({
      status: 'success',
      data: {
        community,
        currentParticipant: participant,
        announcementChat: visibleGroups.find((group) => group.is_announcement_channel) || null,
        groups: visibleGroups.filter((group) => !group.is_announcement_channel),
        memberships
      }
    });
  } catch (error) {
    handleControllerError(res, 'Get Community Error', error, 'Failed to get community');
  }
};

// @desc    Create a subgroup inside a community
// @route   POST /api/messages/community/:communityId/groups
// @access  Private
const createCommunityGroup = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { communityId } = req.params;
  const authUserId = req.user.id;
  const {
    name,
    description,
    participantIds = [],
    type = 'group',
    avatarUrl,
    sendPolicy = 'all',
    joinApprovalRequired = false,
    metadata = {}
  } = req.body;

  try {
    const { chat: community } = await requireCommunityAdmin(communityId, authUserId);

    const { count, error: countError } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', communityId)
      .eq('is_announcement_channel', false);

    if (countError) throw countError;
    if ((count || 0) >= (community.max_subgroups || 50)) {
      throw createHttpError(409, 'Community subgroup limit reached');
    }

    if (!['group', 'zone', 'course'].includes(type)) {
      throw createHttpError(400, 'Community subgroups must be group, zone, or course chats');
    }

    const { data: subgroup, error: createError } = await supabase
      .from('chats')
      .insert([
        {
          type,
          name,
          description: description || null,
          avatar_url: avatarUrl || req.body.avatar_url || null,
          community_id: communityId,
          is_announcement_channel: false,
          created_by: authUserId,
          send_policy: sendPolicy,
          edit_info_policy: 'admins',
          pin_policy: 'admins',
          join_approval_required: Boolean(joinApprovalRequired),
          invite_enabled: true,
          metadata
        }
      ])
      .select()
      .single();

    if (createError) throw createError;

    const uniqueParticipantIds = [...new Set([authUserId, ...participantIds])];
    const participants = uniqueParticipantIds.map((id) => ({
      chat_id: subgroup.id,
      user_id: id,
      role: id === authUserId ? 'owner' : 'member',
      status: 'active',
      is_approved: true,
      notification_level: 'all'
    }));

    const { error: participantError } = await supabase
      .from('chat_participants')
      .insert(participants);

    if (participantError) throw participantError;

    emitChatEvent('community.group.created', communityId, { group: subgroup });

    res.status(201).json({
      status: 'success',
      data: { group: subgroup, participants }
    });
  } catch (error) {
    handleControllerError(res, 'Create Community Group Error', error, 'Failed to create community group');
  }
};

// @desc    Link an existing group/zone/course chat into a community
// @route   POST /api/messages/community/:communityId/groups/:chatId
// @access  Private
const linkCommunityGroup = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { communityId, chatId } = req.params;
  const authUserId = req.user.id;

  try {
    const { chat: community } = await requireCommunityAdmin(communityId, authUserId);
    const { chat: targetChat } = await requirePrivilegedParticipant(chatId, authUserId);

    if (!['group', 'zone', 'course'].includes(targetChat.type)) {
      throw createHttpError(400, 'Only group, zone, or course chats can be linked to a community');
    }
    if (targetChat.is_announcement_channel) {
      throw createHttpError(400, 'Announcement channels cannot be linked as subgroups');
    }

    const { count, error: countError } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('community_id', communityId)
      .eq('is_announcement_channel', false);

    if (countError) throw countError;
    if ((count || 0) >= (community.max_subgroups || 50)) {
      throw createHttpError(409, 'Community subgroup limit reached');
    }

    const { data, error } = await supabase
      .from('chats')
      .update({
        community_id: communityId,
        is_announcement_channel: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId)
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('community.group.linked', communityId, { group: data });

    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Link Community Group Error', error, 'Failed to link community group');
  }
};

// @desc    Unlink a subgroup from a community
// @route   DELETE /api/messages/community/:communityId/groups/:chatId
// @access  Private
const unlinkCommunityGroup = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { communityId, chatId } = req.params;
  const authUserId = req.user.id;

  try {
    await requireCommunityAdmin(communityId, authUserId);

    const { data, error } = await supabase
      .from('chats')
      .update({
        community_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId)
      .eq('community_id', communityId)
      .eq('is_announcement_channel', false)
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('community.group.unlinked', communityId, { group: data });

    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Unlink Community Group Error', error, 'Failed to unlink community group');
  }
};

// @desc    Get paginated messages for a chat
// @route   GET /api/messages/:chatId
// @access  Private
const getChatMessages = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;
  const limit = clampLimit(req.query.limit);
  const { before, after } = req.query;

  try {
    await requireActiveParticipant(chatId, authUserId);

    let query = supabase
      .from('chat_messages')
      .select(includeMessageRelations)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit + 20);

    if (before) query = query.lt('created_at', before);
    if (after) query = query.gt('created_at', after);

    const { data: messages, error } = await query;
    if (error) throw error;

    const blocks = await fetchViewerBlocks(authUserId);
    const visibleMessages = filterMessagesForViewer(messages, authUserId, blocks).slice(0, limit);
    const data = visibleMessages.reverse();

    res.json({
      status: 'success',
      results: data.length,
      nextCursor: visibleMessages.length === limit ? visibleMessages[visibleMessages.length - 1].created_at : null,
      data
    });
  } catch (error) {
    handleControllerError(res, 'Get Messages Error', error, 'Failed to get messages');
  }
};

// @desc    Send a message with optimistic client id and attachments
// @route   POST /api/messages/:chatId
// @access  Private
const sendMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;

  try {
    const { chat, participant } = await requireActiveParticipant(chatId, authUserId);

    if (chat.send_policy === 'admins' && !isPrivilegedRole(participant.role)) {
      throw createHttpError(403, 'Only admins can send messages in this chat');
    }

    let suppressedForUserIds = [];
    if (chat.type === 'direct') {
      const recipientId = await getDirectRecipientId(chatId, authUserId);
      const blocks = await getBlocksBetween(authUserId, recipientId);
      const senderBlockedRecipient = blocks.some(
        (block) => block.blocker_id === authUserId && block.blocked_id === recipientId
      );
      const recipientBlockedSender = blocks.some(
        (block) => block.blocker_id === recipientId && block.blocked_id === authUserId
      );

      if (senderBlockedRecipient) {
        throw createHttpError(409, 'Unblock this user before sending a message');
      }
      if (recipientBlockedSender && recipientId) {
        suppressedForUserIds = [recipientId];
      }
    }

    const { message: messageInsert, attachments } = buildMessageInsert({
      chatId,
      senderId: authUserId,
      chat,
      bodyPayload: req.body,
      suppressedForUserIds
    });

    const { data: message, error } = await supabase
      .from('chat_messages')
      .insert([messageInsert])
      .select(includeMessageRelations)
      .single();

    if (error) throw error;

    if (attachments.length > 0) {
      const { error: attachmentError } = await supabase
        .from('chat_message_attachments')
        .insert(attachments.map((attachment) => normalizeAttachmentInsert(message.id, attachment)));

      if (attachmentError) throw attachmentError;
    }

    await Promise.all([
      upsertSenderReceipt(message.id, authUserId),
      touchChatLastMessage(chatId, message.id)
    ]);

    const { data: hydratedMessage, error: hydrateError } = await supabase
      .from('chat_messages')
      .select(includeMessageRelations)
      .eq('id', message.id)
      .single();

    if (hydrateError) throw hydrateError;

    emitChatEvent('created', chatId, { message: hydratedMessage });

    res.status(201).json({
      status: 'success',
      data: hydratedMessage
    });
  } catch (error) {
    handleControllerError(res, 'Send Message Error', error, 'Failed to send message');
  }
};

// @desc    Mark messages delivered/read for a chat
// @route   PATCH /api/messages/:chatId/receipts
// @access  Private
const updateReceipts = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;
  const { messageIds = [], status = 'read', upToMessageId, readAt, deliveredAt } = req.body;

  try {
    const { chat } = await requireActiveParticipant(chatId, authUserId);

    let ids = asArray(messageIds).filter(isUuid);
    if (upToMessageId && isUuid(upToMessageId)) {
      const { data: marker, error: markerError } = await supabase
        .from('chat_messages')
        .select('created_at')
        .eq('id', upToMessageId)
        .eq('chat_id', chatId)
        .maybeSingle();

      if (markerError) throw markerError;
      if (marker) {
        const { data: messages, error: idsError } = await supabase
          .from('chat_messages')
          .select('id')
          .eq('chat_id', chatId)
          .lte('created_at', marker.created_at)
          .neq('sender_id', authUserId);

        if (idsError) throw idsError;
        ids = messages.map((message) => message.id);
      }
    } else if (ids.length > 0) {
      const { data: messages, error: idsError } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('chat_id', chatId)
        .neq('sender_id', authUserId)
        .in('id', ids);

      if (idsError) throw idsError;
      ids = messages.map((message) => message.id);
    }

    const now = new Date().toISOString();
    const deliveredTimestamp = deliveredAt || now;
    const readTimestamp = readAt || now;
    const receiptRows = ids.map((messageId) => compactObject({
      message_id: messageId,
      user_id: authUserId,
      delivered_at: ['delivered', 'read', 'played'].includes(status) ? deliveredTimestamp : undefined,
      read_at: ['read', 'played'].includes(status) ? readTimestamp : undefined,
      played_at: status === 'played' ? readTimestamp : undefined,
      updated_at: now
    }));

    if (receiptRows.length > 0) {
      const { error } = await supabase
        .from('chat_read_receipts')
        .upsert(receiptRows, { onConflict: 'message_id,user_id' });

      if (error) throw error;

      if (chat.type === 'direct') {
        const aggregateStatus = status === 'played' ? 'read' : status;
        const { error: messageStatusError } = await supabase
          .from('chat_messages')
          .update({
            message_status: aggregateStatus,
            delivery_state: aggregateStatus,
            updated_at: now
          })
          .in('id', ids);

        if (messageStatusError) throw messageStatusError;
      }
    }

    if (status === 'read') {
      const { error: participantError } = await supabase
        .from('chat_participants')
        .update({
          last_read_message_id: upToMessageId || ids[ids.length - 1] || null,
          last_read_at: readTimestamp,
          updated_at: now
        })
        .eq('chat_id', chatId)
        .eq('user_id', authUserId);

      if (participantError) throw participantError;
    }

    emitChatEvent('receipts.updated', chatId, {
      user_id: authUserId,
      message_ids: ids,
      receipt_status: status
    });

    res.json({
      status: 'success',
      data: { messageIds: ids, receiptStatus: status }
    });
  } catch (error) {
    handleControllerError(res, 'Update Receipts Error', error, 'Failed to update receipts');
  }
};

// @desc    Edit a message
// @route   PATCH /api/messages/message/:messageId
// @access  Private
const editMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { messageId } = req.params;
  const authUserId = req.user.id;
  const body = normalizeMessageBody(req.body);

  try {
    const { data: existing, error: existingError } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('id', messageId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) throw createHttpError(404, 'Message not found');
    if (existing.sender_id !== authUserId) throw createHttpError(403, 'Only the sender can edit this message');
    if (existing.deleted_at) throw createHttpError(409, 'Deleted messages cannot be edited');

    await requireActiveParticipant(existing.chat_id, authUserId);

    const { error: historyError } = await supabase
      .from('chat_message_edits')
      .insert([
        {
          message_id: messageId,
          editor_id: authUserId,
          previous_body: existing.body,
          new_body: body,
          edited_at: new Date().toISOString()
        }
      ]);

    if (historyError) throw historyError;

    const { data: message, error } = await supabase
      .from('chat_messages')
      .update({
        body,
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select(includeMessageRelations)
      .single();

    if (error) throw error;

    emitChatEvent('edited', existing.chat_id, { message });

    res.json({ status: 'success', data: message });
  } catch (error) {
    handleControllerError(res, 'Edit Message Error', error, 'Failed to edit message');
  }
};

// @desc    Delete a message for current user or everyone
// @route   DELETE /api/messages/message/:messageId
// @access  Private
const deleteMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { messageId } = req.params;
  const authUserId = req.user.id;
  const scope = req.query.scope || req.body.scope || 'me';

  try {
    const { data: existing, error: existingError } = await supabase
      .from('chat_messages')
      .select('*, chats(type)')
      .eq('id', messageId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) throw createHttpError(404, 'Message not found');

    const { participant } = await requireActiveParticipant(existing.chat_id, authUserId);

    if (scope === 'everyone') {
      const canDeleteForEveryone =
        existing.sender_id === authUserId || isPrivilegedRole(participant.role);
      if (!canDeleteForEveryone) {
        throw createHttpError(403, 'Only the sender or a group admin can delete this message for everyone');
      }

      const { data: message, error } = await supabase
        .from('chat_messages')
        .update({
          body: null,
          deleted_at: new Date().toISOString(),
          deleted_by: authUserId,
          delete_scope: 'everyone',
          updated_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .select(includeMessageRelations)
        .single();

      if (error) throw error;

      emitChatEvent('deleted', existing.chat_id, { message, scope: 'everyone' });
      return res.json({ status: 'success', data: message });
    }

    const { error } = await supabase
      .from('chat_message_deletions')
      .upsert(
        {
          message_id: messageId,
          user_id: authUserId,
          deleted_at: new Date().toISOString()
        },
        { onConflict: 'message_id,user_id' }
      );

    if (error) throw error;

    res.json({
      status: 'success',
      data: { messageId, scope: 'me', deletedAt: new Date().toISOString() }
    });
  } catch (error) {
    handleControllerError(res, 'Delete Message Error', error, 'Failed to delete message');
  }
};

// @desc    Add/update reaction to a message
// @route   POST /api/messages/message/:messageId/reactions
// @access  Private
const setReaction = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { messageId } = req.params;
  const authUserId = req.user.id;
  const { emoji } = req.body;

  try {
    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .select('id, chat_id')
      .eq('id', messageId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (!message) throw createHttpError(404, 'Message not found');

    await requireActiveParticipant(message.chat_id, authUserId);

    const { data: reaction, error } = await supabase
      .from('chat_message_reactions')
      .upsert(
        {
          message_id: messageId,
          user_id: authUserId,
          emoji,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'message_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('reaction.updated', message.chat_id, { reaction });

    res.status(201).json({ status: 'success', data: reaction });
  } catch (error) {
    handleControllerError(res, 'Set Reaction Error', error, 'Failed to update reaction');
  }
};

// @desc    Remove current user's reaction
// @route   DELETE /api/messages/message/:messageId/reactions
// @access  Private
const removeReaction = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { messageId } = req.params;
  const authUserId = req.user.id;

  try {
    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .select('id, chat_id')
      .eq('id', messageId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (!message) throw createHttpError(404, 'Message not found');

    await requireActiveParticipant(message.chat_id, authUserId);

    const { error } = await supabase
      .from('chat_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', authUserId);

    if (error) throw error;

    emitChatEvent('reaction.removed', message.chat_id, {
      message_id: messageId,
      user_id: authUserId
    });

    res.json({ status: 'success', data: { messageId } });
  } catch (error) {
    handleControllerError(res, 'Remove Reaction Error', error, 'Failed to remove reaction');
  }
};

// @desc    Star or unstar a message for current user
// @route   POST/DELETE /api/messages/message/:messageId/star
// @access  Private
const setStarredMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { messageId } = req.params;
  const authUserId = req.user.id;
  const shouldStar = req.method !== 'DELETE';

  try {
    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .select('id, chat_id')
      .eq('id', messageId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (!message) throw createHttpError(404, 'Message not found');

    await requireActiveParticipant(message.chat_id, authUserId);

    if (shouldStar) {
      const { data, error } = await supabase
        .from('chat_message_stars')
        .upsert(
          {
            message_id: messageId,
            user_id: authUserId,
            created_at: new Date().toISOString()
          },
          { onConflict: 'message_id,user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return res.status(201).json({ status: 'success', data });
    }

    const { error } = await supabase
      .from('chat_message_stars')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', authUserId);

    if (error) throw error;
    res.json({ status: 'success', data: { messageId } });
  } catch (error) {
    handleControllerError(res, 'Star Message Error', error, 'Failed to update starred message');
  }
};

// @desc    Pin a message in a chat
// @route   POST /api/messages/:chatId/pins
// @access  Private
const pinMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;
  const { messageId, expiresAt } = req.body;

  try {
    const { chat, participant } = await requireActiveParticipant(chatId, authUserId);
    if (chat.pin_policy === 'admins' && !isPrivilegedRole(participant.role)) {
      throw createHttpError(403, 'Only admins can pin messages in this chat');
    }

    const { data: message, error: messageError } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('id', messageId)
      .eq('chat_id', chatId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (!message) throw createHttpError(404, 'Message not found in this chat');

    const { count, error: countError } = await supabase
      .from('chat_message_pins')
      .select('message_id', { count: 'exact', head: true })
      .eq('chat_id', chatId)
      .is('unpinned_at', null);

    if (countError) throw countError;
    if ((count || 0) >= 3) {
      throw createHttpError(409, 'A chat can have at most 3 pinned messages');
    }

    const { data, error } = await supabase
      .from('chat_message_pins')
      .upsert(
        {
          chat_id: chatId,
          message_id: messageId,
          pinned_by: authUserId,
          expires_at: expiresAt || null,
          unpinned_at: null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'chat_id,message_id' }
      )
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('pinned', chatId, { pin: data });
    res.status(201).json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Pin Message Error', error, 'Failed to pin message');
  }
};

// @desc    Unpin a message
// @route   DELETE /api/messages/:chatId/pins/:messageId
// @access  Private
const unpinMessage = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId, messageId } = req.params;
  const authUserId = req.user.id;

  try {
    const { chat, participant } = await requireActiveParticipant(chatId, authUserId);
    if (chat.pin_policy === 'admins' && !isPrivilegedRole(participant.role)) {
      throw createHttpError(403, 'Only admins can unpin messages in this chat');
    }

    const { data, error } = await supabase
      .from('chat_message_pins')
      .update({
        unpinned_at: new Date().toISOString(),
        unpinned_by: authUserId,
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .eq('message_id', messageId)
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('unpinned', chatId, { pin: data });
    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Unpin Message Error', error, 'Failed to unpin message');
  }
};

// @desc    Update current user's chat settings
// @route   PATCH /api/messages/:chatId/settings
// @access  Private
const updateChatSettings = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;
  const {
    mutedUntil,
    muted_until,
    notificationLevel,
    notification_level,
    isPinned,
    is_pinned,
    isArchived,
    is_archived
  } = req.body;

  try {
    await requireActiveParticipant(chatId, authUserId);

    const now = new Date().toISOString();
    const hasPinnedUpdate = isPinned !== undefined || is_pinned !== undefined;
    const pinnedValue = isPinned ?? is_pinned;
    const mutedValue =
      mutedUntil !== undefined ? mutedUntil : muted_until !== undefined ? muted_until : undefined;

    const updates = compactObject({
      muted_until: mutedValue,
      notification_level: notificationLevel || notification_level,
      is_pinned: hasPinnedUpdate ? pinnedValue : undefined,
      pinned_at: hasPinnedUpdate ? (pinnedValue ? now : null) : undefined,
      is_archived: isArchived ?? is_archived,
      updated_at: now
    });

    const { data, error } = await supabase
      .from('chat_participants')
      .update(updates)
      .eq('chat_id', chatId)
      .eq('user_id', authUserId)
      .select()
      .single();

    if (error) throw error;

    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Update Chat Settings Error', error, 'Failed to update chat settings');
  }
};

// @desc    Update group controls
// @route   PATCH /api/messages/:chatId/group
// @access  Private
const updateGroupControls = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;

  try {
    await requirePrivilegedParticipant(chatId, authUserId);

    const updates = compactObject({
      name: req.body.name,
      description: req.body.description,
      avatar_url: req.body.avatarUrl || req.body.avatar_url,
      send_policy: req.body.sendPolicy || req.body.send_policy,
      edit_info_policy: req.body.editInfoPolicy || req.body.edit_info_policy,
      pin_policy: req.body.pinPolicy || req.body.pin_policy,
      join_approval_required: req.body.joinApprovalRequired ?? req.body.join_approval_required,
      invite_enabled: req.body.inviteEnabled ?? req.body.invite_enabled,
      disappearing_seconds: req.body.disappearingSeconds ?? req.body.disappearing_seconds,
      retention_days: req.body.retentionDays ?? req.body.retention_days,
      metadata: req.body.metadata,
      updated_at: new Date().toISOString()
    });

    const { data, error } = await supabase
      .from('chats')
      .update(updates)
      .eq('id', chatId)
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('group.updated', chatId, { chat: data });
    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Update Group Error', error, 'Failed to update group controls');
  }
};

// @desc    Add participant or create join request depending on group settings
// @route   POST /api/messages/:chatId/participants
// @access  Private
const addParticipant = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;
  const { userId, role = 'member' } = req.body;

  try {
    const { chat, participant } = await requireActiveParticipant(chatId, authUserId);
    const canAddDirectly = isPrivilegedRole(participant.role) || !chat.join_approval_required;

    if (!canAddDirectly) {
      const { data, error } = await supabase
        .from('chat_join_requests')
        .upsert(
          {
            chat_id: chatId,
            user_id: userId,
            requested_by: authUserId,
            status: 'pending',
            updated_at: new Date().toISOString()
          },
          { onConflict: 'chat_id,user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return res.status(202).json({ status: 'success', data });
    }

    if (!GROUP_ROLES.has(role)) {
      throw createHttpError(400, 'Invalid participant role');
    }

    const { data, error } = await supabase
      .from('chat_participants')
      .upsert(
        {
          chat_id: chatId,
          user_id: userId,
          role,
          status: 'active',
          is_approved: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'chat_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;

    emitChatEvent('participant.added', chatId, { participant: data });
    res.status(201).json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Add Participant Error', error, 'Failed to add participant');
  }
};

// @desc    Update/remove participant
// @route   PATCH/DELETE /api/messages/:chatId/participants/:userId
// @access  Private
const updateParticipant = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId, userId } = req.params;
  const authUserId = req.user.id;
  const isDelete = req.method === 'DELETE';

  try {
    const { participant } = await requirePrivilegedParticipant(chatId, authUserId);
    if (userId === authUserId && participant.role === 'owner') {
      throw createHttpError(409, 'Transfer ownership before leaving as owner');
    }

    const updates = isDelete
      ? {
          status: 'removed',
          removed_by: authUserId,
          left_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      : compactObject({
          role: req.body.role,
          status: req.body.status,
          is_approved: req.body.isApproved ?? req.body.is_approved,
          notification_level: req.body.notificationLevel || req.body.notification_level,
          updated_at: new Date().toISOString()
        });

    const { data, error } = await supabase
      .from('chat_participants')
      .update(updates)
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    emitChatEvent(isDelete ? 'participant.removed' : 'participant.updated', chatId, {
      participant: data
    });
    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Update Participant Error', error, 'Failed to update participant');
  }
};

// @desc    Approve or reject a join request
// @route   PATCH /api/messages/:chatId/join-requests/:userId
// @access  Private
const reviewJoinRequest = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId, userId } = req.params;
  const authUserId = req.user.id;
  const decision = req.body.status || 'approved';

  try {
    await requirePrivilegedParticipant(chatId, authUserId);

    const { data: request, error: requestError } = await supabase
      .from('chat_join_requests')
      .update({
        status: decision,
        reviewed_by: authUserId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .select()
      .single();

    if (requestError) throw requestError;

    if (decision === 'approved') {
      const { error: participantError } = await supabase
        .from('chat_participants')
        .upsert(
          {
            chat_id: chatId,
            user_id: userId,
            role: 'member',
            status: 'active',
            is_approved: true,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'chat_id,user_id' }
        );

      if (participantError) throw participantError;
    }

    emitChatEvent('join_request.reviewed', chatId, { request });
    res.json({ status: 'success', data: request });
  } catch (error) {
    handleControllerError(res, 'Review Join Request Error', error, 'Failed to review join request');
  }
};

// @desc    Rotate group invite code
// @route   POST /api/messages/:chatId/invite/reset
// @access  Private
const resetInviteCode = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { chatId } = req.params;
  const authUserId = req.user.id;

  try {
    await requirePrivilegedParticipant(chatId, authUserId);

    const inviteCode = `cnx_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    const { data, error } = await supabase
      .from('chats')
      .update({
        invite_code: inviteCode,
        invite_code_revoked_at: null,
        invite_enabled: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', chatId)
      .select('id, invite_code, invite_enabled')
      .single();

    if (error) throw error;
    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Reset Invite Error', error, 'Failed to reset invite code');
  }
};

// @desc    Join via invite code
// @route   POST /api/messages/invite/:inviteCode/join
// @access  Private
const joinByInviteCode = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { inviteCode } = req.params;
  const authUserId = req.user.id;

  try {
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('*')
      .eq('invite_code', inviteCode)
      .eq('invite_enabled', true)
      .is('invite_code_revoked_at', null)
      .maybeSingle();

    if (chatError) throw chatError;
    if (!chat) throw createHttpError(404, 'Invite link is invalid or expired');

    if (chat.join_approval_required) {
      const { data, error } = await supabase
        .from('chat_join_requests')
        .upsert(
          {
            chat_id: chat.id,
            user_id: authUserId,
            requested_by: authUserId,
            status: 'pending',
            updated_at: new Date().toISOString()
          },
          { onConflict: 'chat_id,user_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return res.status(202).json({ status: 'success', data });
    }

    const { data, error } = await supabase
      .from('chat_participants')
      .upsert(
        {
          chat_id: chat.id,
          user_id: authUserId,
          role: 'member',
          status: 'active',
          is_approved: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'chat_id,user_id' }
      )
      .select()
      .single();

    if (error) throw error;
    emitChatEvent('participant.joined', chat.id, { participant: data });
    res.status(201).json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Join Invite Error', error, 'Failed to join chat');
  }
};

// @desc    Register or look up media by hash
// @route   POST /api/messages/media
// @access  Private
const registerMedia = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const authUserId = req.user.id;
  const fileHash = req.body.fileHash || req.body.file_hash;

  try {
    if (fileHash) {
      const { data: existing, error: existingError } = await supabase
        .from('chat_media_files')
        .select('*')
        .eq('file_hash', fileHash)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        return res.json({
          status: 'success',
          data: { ...existing, wasDeduped: true }
        });
      }
    }

    const { data, error } = await supabase
      .from('chat_media_files')
      .insert([
        {
          file_hash: fileHash,
          encrypted_hash: req.body.encryptedHash || req.body.encrypted_hash || null,
          cdn_url: req.body.cdnUrl || req.body.cdn_url || req.body.url || null,
          thumbnail_url: req.body.thumbnailUrl || req.body.thumbnail_url || null,
          file_name: req.body.fileName || req.body.file_name || null,
          file_size: req.body.fileSize || req.body.file_size || null,
          mime_type: req.body.mimeType || req.body.mime_type || null,
          uploaded_by: authUserId,
          upload_status: req.body.uploadStatus || req.body.upload_status || 'pending',
          upload_session_id: req.body.uploadSessionId || req.body.upload_session_id || null,
          expires_at: req.body.expiresAt || req.body.expires_at || null,
          metadata: req.body.metadata || {}
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      status: 'success',
      data: { ...data, wasDeduped: false }
    });
  } catch (error) {
    handleControllerError(res, 'Register Media Error', error, 'Failed to register media');
  }
};

// @desc    Update media upload status/progress
// @route   PATCH /api/messages/media/:mediaId
// @access  Private
const updateMedia = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const { mediaId } = req.params;
  const authUserId = req.user.id;

  try {
    const updates = compactObject({
      cdn_url: req.body.cdnUrl || req.body.cdn_url || req.body.url,
      thumbnail_url: req.body.thumbnailUrl || req.body.thumbnail_url,
      upload_status: req.body.uploadStatus || req.body.upload_status,
      upload_progress: req.body.uploadProgress ?? req.body.upload_progress,
      encrypted_hash: req.body.encryptedHash || req.body.encrypted_hash,
      expires_at: req.body.expiresAt || req.body.expires_at,
      metadata: req.body.metadata,
      updated_at: new Date().toISOString()
    });

    const { data, error } = await supabase
      .from('chat_media_files')
      .update(updates)
      .eq('id', mediaId)
      .eq('uploaded_by', authUserId)
      .select()
      .single();

    if (error) throw error;
    res.json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Update Media Error', error, 'Failed to update media');
  }
};

// @desc    List blocked users
// @route   GET /api/messages/blocks
// @access  Private
const listBlocks = async (req, res) => {
  const authUserId = req.user.id;

  try {
    const { data, error } = await supabase
      .from('user_blocks')
      .select('*, users!user_blocks_blocked_id_fkey(id, display_name, avatar_url, email)')
      .eq('blocker_id', authUserId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ status: 'success', results: data?.length || 0, data: data || [] });
  } catch (error) {
    handleControllerError(res, 'List Blocks Error', error, 'Failed to list blocked users');
  }
};

// @desc    Block a user silently
// @route   POST /api/messages/blocks
// @access  Private
const blockUser = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const authUserId = req.user.id;
  const { blockedUserId } = req.body;

  if (blockedUserId === authUserId) {
    return res.status(400).json({ status: 'error', message: 'Cannot block yourself' });
  }

  try {
    const { data, error } = await supabase
      .from('user_blocks')
      .upsert(
        {
          blocker_id: authUserId,
          blocked_id: blockedUserId,
          reason: req.body.reason || null,
          created_at: new Date().toISOString()
        },
        { onConflict: 'blocker_id,blocked_id' }
      )
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ status: 'success', data });
  } catch (error) {
    handleControllerError(res, 'Block User Error', error, 'Failed to block user');
  }
};

// @desc    Unblock a user
// @route   DELETE /api/messages/blocks/:blockedUserId
// @access  Private
const unblockUser = async (req, res) => {
  if (getValidationResponse(req, res)) return;

  const authUserId = req.user.id;
  const { blockedUserId } = req.params;

  try {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', authUserId)
      .eq('blocked_id', blockedUserId);

    if (error) throw error;
    res.json({ status: 'success', data: { blockedUserId } });
  } catch (error) {
    handleControllerError(res, 'Unblock User Error', error, 'Failed to unblock user');
  }
};

// @desc    Messaging SSE stream for the Express-token client path
// @route   GET /api/messages/events?token=<jwt>
// @access  Private
const subscribeToMessageEvents = async (req, res) => {
  const authUserId = req.user.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event) => {
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  sendEvent({
    id: `messages-connected-${Date.now()}`,
    type: 'connected',
    payload: { message: 'Messaging stream connected' },
    created_at: new Date().toISOString()
  });

  const handleEvent = async (event) => {
    if (!event.type?.startsWith('message.')) return;

    const chatId = event.payload?.chat_id;
    if (!chatId) return;

    try {
      const participant = await getParticipant(chatId, authUserId);
      if (!participant || !ACTIVE_PARTICIPANT_STATES.has(participant.status || 'active')) return;
      if (asArray(event.payload?.message?.suppressed_for_user_ids).includes(authUserId)) return;
      sendEvent(event);
    } catch (error) {
      console.error('Message Stream Filter Error:', error.message);
    }
  };

  hub.on('event', handleEvent);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    hub.off('event', handleEvent);
    res.end();
  });
};

module.exports = {
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
};
