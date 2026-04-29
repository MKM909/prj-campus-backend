const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const { emitRealtimeEvent, hub } = require('../utils/realtimeHub');

const listUsers = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, display_name, avatar_url, role, reliability_score, rank, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      status: 'success',
      results: users.length,
      data: users
    });
  } catch (error) {
    console.error('List Users Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch users'
    });
  }
};

const updateUserRole = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { userId } = req.params;
  const { role } = req.body;

  try {
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId)
      .select('id, email, display_name, avatar_url, role, reliability_score, rank, created_at')
      .single();

    if (error) throw error;

    emitRealtimeEvent('user.role_updated', {
      user: updatedUser,
      changed_by: req.currentUser
    });

    res.json({
      status: 'success',
      data: updatedUser
    });
  } catch (error) {
    console.error('Update Role Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update user role'
    });
  }
};

const updateReportStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const { reportId } = req.params;
  const { status } = req.body;

  try {
    const { data: report, error } = await supabase
      .from('reports')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', reportId)
      .select('*, users(display_name, avatar_url)')
      .single();

    if (error) throw error;

    emitRealtimeEvent('report.updated', {
      report,
      changed_by: req.currentUser
    });

    res.json({
      status: 'success',
      data: report
    });
  } catch (error) {
    console.error('Update Report Status Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update report status'
    });
  }
};

const subscribeToAdminEvents = (req, res) => {
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
    id: `connected-${Date.now()}`,
    type: 'connected',
    payload: { message: 'Realtime admin stream connected' },
    created_at: new Date().toISOString()
  });

  hub.on('event', sendEvent);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    hub.off('event', sendEvent);
    res.end();
  });
};

module.exports = {
  listUsers,
  updateUserRole,
  updateReportStatus,
  subscribeToAdminEvents
};
