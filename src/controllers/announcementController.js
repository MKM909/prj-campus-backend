const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const { emitRealtimeEvent, hub } = require('../utils/realtimeHub');

const listAnnouncements = async (req, res) => {
  try {
    const { data: announcements, error } = await supabase
      .from('announcements')
      .select('*, users(display_name, avatar_url)')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      status: 'success',
      results: announcements.length,
      data: announcements
    });
  } catch (error) {
    console.error('List Announcements Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch announcements'
    });
  }
};

const createAnnouncement = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { title, body, priority, audienceRole, expiresAt } = req.body;

  try {
    const { data: announcement, error } = await supabase
      .from('announcements')
      .insert([{
        title,
        body,
        priority: priority || 'normal',
        audience_role: audienceRole || 'all',
        created_by: req.user.id,
        expires_at: expiresAt || null,
        created_at: new Date().toISOString()
      }])
      .select('*, users(display_name, avatar_url)')
      .single();

    if (error) throw error;

    emitRealtimeEvent('announcement.created', {
      announcement,
      created_by: req.currentUser
    });

    res.status(201).json({
      status: 'success',
      data: announcement
    });
  } catch (error) {
    console.error('Create Announcement Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to create announcement'
    });
  }
};

const subscribeToAnnouncementEvents = async (req, res) => {
  let audienceRole = 'student';

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    audienceRole = user?.role || audienceRole;
  } catch (error) {
    console.error('Announcement Stream Role Error:', error.message);
  }

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
    id: `announcements-connected-${Date.now()}`,
    type: 'connected',
    payload: { message: 'Announcement stream connected' },
    created_at: new Date().toISOString()
  });

  const handleEvent = (event) => {
    if (event.type !== 'announcement.created') return;

    const announcement = event.payload?.announcement;
    if (!announcement) return;

    if (announcement.audience_role === 'all' || announcement.audience_role === audienceRole) {
      sendEvent(event);
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
  listAnnouncements,
  createAnnouncement,
  subscribeToAnnouncementEvents
};
