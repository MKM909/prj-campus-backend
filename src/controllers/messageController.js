const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');

// @desc    Create a new direct message chat
// @route   POST /api/messages/direct
// @access  Private
const createDirectMessage = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { targetUserId } = req.body;
  const authUserId = req.user.id;

  if (targetUserId === authUserId) {
    return res.status(400).json({ status: 'error', message: 'Cannot chat with yourself' });
  }

  try {
    // 1. Check if a direct chat already exists between these two users
    // This requires a complex query or just finding chats where both are members and type = 'direct'
    // We'll do a simple two-step check for simplicity
    const { data: userChats, error: userChatsError } = await supabase
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', authUserId);

    if (userChatsError) throw userChatsError;

    if (userChats && userChats.length > 0) {
      const chatIds = userChats.map(c => c.chat_id);
      const { data: existingChats, error: existingChatsError } = await supabase
        .from('chats')
        .select('id')
        .in('id', chatIds)
        .eq('type', 'direct');
        
      if (!existingChatsError && existingChats && existingChats.length > 0) {
        const directChatIds = existingChats.map(c => c.id);
        const { data: match, error: matchError } = await supabase
          .from('chat_participants')
          .select('chat_id')
          .in('chat_id', directChatIds)
          .eq('user_id', targetUserId);
          
        if (!matchError && match && match.length > 0) {
          return res.status(200).json({
            status: 'success',
            data: { chatId: match[0].chat_id }
          });
        }
      }
    }

    // 2. Create new direct chat
    const { data: newChat, error: createError } = await supabase
      .from('chats')
      .insert([{ type: 'direct', created_by: authUserId }])
      .select()
      .single();

    if (createError) throw createError;

    // 3. Add participants
    const { error: partError } = await supabase
      .from('chat_participants')
      .insert([
        { chat_id: newChat.id, user_id: authUserId, role: 'admin' },
        { chat_id: newChat.id, user_id: targetUserId, role: 'member' }
      ]);

    if (partError) throw partError;

    res.status(201).json({
      status: 'success',
      data: { chatId: newChat.id }
    });
  } catch (error) {
    console.error('Create DM Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Failed to create direct message' });
  }
};

// @desc    Create a new group chat
// @route   POST /api/messages/group
// @access  Private
const createGroup = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { name, participantIds } = req.body; // participantIds should be array of UUIDs
  const authUserId = req.user.id;

  try {
    const { data: newChat, error: createError } = await supabase
      .from('chats')
      .insert([{ type: 'group', name, created_by: authUserId }])
      .select()
      .single();

    if (createError) throw createError;

    const participants = [
      { chat_id: newChat.id, user_id: authUserId, role: 'admin' }
    ];

    if (participantIds && Array.isArray(participantIds)) {
      participantIds.forEach(id => {
        if (id !== authUserId) {
          participants.push({ chat_id: newChat.id, user_id: id, role: 'member' });
        }
      });
    }

    const { error: partError } = await supabase
      .from('chat_participants')
      .insert(participants);

    if (partError) throw partError;

    res.status(201).json({
      status: 'success',
      data: newChat
    });
  } catch (error) {
    console.error('Create Group Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Failed to create group' });
  }
};

// @desc    Send a message
// @route   POST /api/messages/:chatId
// @access  Private
const sendMessage = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { chatId } = req.params;
  const { body } = req.body;
  const authUserId = req.user.id;

  try {
    // RLS in supabase handles permissions (user must be participant to insert message into chat)
    const { data: message, error } = await supabase
      .from('chat_messages')
      .insert([{
        chat_id: chatId,
        sender_id: authUserId,
        body
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '42501') {
        return res.status(403).json({ status: 'error', message: 'Not authorized to send to this chat' });
      }
      throw error;
    }

    res.status(201).json({
      status: 'success',
      data: message
    });
  } catch (error) {
    console.error('Send Message Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Failed to send message' });
  }
};

// @desc    Get chats for user
// @route   GET /api/messages/chats
// @access  Private
const getChats = async (req, res) => {
  const authUserId = req.user.id;

  try {
    const { data: chats, error } = await supabase
      .from('chat_participants')
      .select('chat_id, joined_at, chats(*)')
      .eq('user_id', authUserId)
      .order('joined_at', { ascending: false });

    if (error) throw error;

    res.json({
      status: 'success',
      data: chats
    });
  } catch (error) {
    console.error('Get Chats Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Failed to get chats' });
  }
};

// @desc    Get messages for a chat
// @route   GET /api/messages/:chatId
// @access  Private
const getChatMessages = async (req, res) => {
  const { chatId } = req.params;

  try {
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*, users(display_name, avatar_url)')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(100); // Pagination could be added here

    if (error) throw error;

    res.json({
      status: 'success',
      data: messages
    });
  } catch (error) {
    console.error('Get Messages Error:', error.message);
    res.status(500).json({ status: 'error', message: 'Failed to get messages' });
  }
};

module.exports = {
  createDirectMessage,
  createGroup,
  sendMessage,
  getChats,
  getChatMessages
};
