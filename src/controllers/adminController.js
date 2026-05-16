const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { emitRealtimeEvent, hub } = require('../utils/realtimeHub');
const {
  ADMIN_ROLES,
  DEFAULT_ADMIN_SETTINGS,
  applyAdminReportScope,
  buildAnalytics,
  buildBudgetEvidence,
  buildDashboardStats,
  buildEscalationCandidates,
  buildInbox,
  buildPredictions,
  buildSentiment,
  buildTensionSnapshot,
  buildZoneSummaries,
  enrichReportsWithZones,
  getReportDepartment,
  mergeAdminSettings,
  normalizeLifecycle,
  redactReportsForAdmin,
  redactReportIdentity
} = require('../services/adminIntelligenceService');

const ok = (res, data, extra = {}) => res.json({ status: 'success', ...extra, data });

const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ status: 'error', errors: errors.array() });
    return true;
  }
  return false;
};

const handleError = (res, label, error, statusCode = 500) => {
  console.error(`${label}:`, error.message);
  res.status(error.statusCode || statusCode).json({
    status: 'error',
    message: error.message || label
  });
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const handleControllerError = (res, label, error) => {
  handleError(res, label, error, error.statusCode || 500);
};

const parsePositiveInt = (value, fallback, max = 200) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const fetchReports = async (max = 5000) => {
  const withUsers = await supabase
    .from('reports')
    .select('*, users(display_name, avatar_url, email, rank)')
    .order('created_at', { ascending: false })
    .limit(max);

  if (!withUsers.error) return withUsers.data || [];

  const basic = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(max);

  if (basic.error) throw basic.error;
  return basic.data || [];
};

const fetchZones = async () => {
  const { data, error } = await supabase
    .from('zones')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
};

const fetchOptionalRows = async (table, column, value, select = '*') => {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq(column, value)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn(`Optional admin table unavailable: ${table} (${error.message})`);
    return [];
  }
};

const getAdminSettingsValue = async () => {
  try {
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'platform')
      .maybeSingle();

    if (error) throw error;
    return mergeAdminSettings(data?.value || {});
  } catch (error) {
    console.warn(`Admin settings unavailable, using defaults: ${error.message}`);
    return DEFAULT_ADMIN_SETTINGS;
  }
};

const saveAdminSettingsValue = async (value) => {
  const merged = mergeAdminSettings(value);
  const { data, error } = await supabase
    .from('admin_settings')
    .upsert({
      key: 'platform',
      value: merged,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })
    .select()
    .single();

  if (error) throw error;
  return mergeAdminSettings(data.value);
};

const logAdminAction = async (req, action, resourceType, resourceId, previousState, newState, metadata = {}) => {
  const admin = req.currentUser || req.adminUser || {};

  try {
    await supabase
      .from('admin_audit_logs')
      .insert([{
        admin_id: admin.id || req.user?.id || null,
        action_type: action,
        resource_type: resourceType,
        resource_id: resourceId || null,
        previous_state: previousState || null,
        new_state: newState || null,
        metadata,
        created_at: new Date().toISOString()
      }]);
  } catch (error) {
    console.warn(`Audit log failed for ${action}: ${error.message}`);
  }
};

const createAdminNotification = async ({ recipientRole, recipientUserId, type, title, body, resourceType, resourceId, metadata }) => {
  try {
    await supabase
      .from('admin_notifications')
      .insert([{
        recipient_role: recipientRole || null,
        recipient_user_id: recipientUserId || null,
        type,
        title,
        body: body || null,
        resource_type: resourceType || null,
        resource_id: resourceId || null,
        metadata: metadata || {},
        created_at: new Date().toISOString()
      }]);
  } catch (error) {
    console.warn(`Admin notification failed for ${type}: ${error.message}`);
  }
};

const insertReportHistory = async (reportId, lifecycleStatus, adminId, note, metadata = {}) => {
  try {
    await supabase
      .from('report_status_history')
      .insert([{
        report_id: reportId,
        lifecycle_status: lifecycleStatus,
        changed_by: adminId,
        note: note || null,
        metadata,
        created_at: new Date().toISOString()
      }]);
  } catch (error) {
    console.warn(`Report history failed for ${reportId}: ${error.message}`);
  }
};

const applyReportFilters = (reports, query) => {
  let filtered = [...reports];
  const search = String(query.search || '').trim().toLowerCase();

  if (query.status) filtered = filtered.filter(report => report.status === query.status);
  if (query.category) filtered = filtered.filter(report => String(report.category).toLowerCase() === String(query.category).toLowerCase());
  if (query.zoneId) filtered = filtered.filter(report => String(report.zone_id) === String(query.zoneId));
  if (query.lifecycle) filtered = filtered.filter(report => normalizeLifecycle(report) === query.lifecycle);

  if (query.date) {
    const now = new Date();
    let start = null;
    if (query.date === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (query.date === 'this_week') start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (query.date === 'this_month') start = new Date(now.getFullYear(), now.getMonth(), 1);
    if (start) filtered = filtered.filter(report => new Date(report.created_at) >= start);
  }

  if (query.from) filtered = filtered.filter(report => new Date(report.created_at) >= new Date(query.from));
  if (query.to) filtered = filtered.filter(report => new Date(report.created_at) <= new Date(query.to));

  if (search) {
    filtered = filtered.filter(report => [
      report.title,
      report.description,
      report.specific_location,
      report.category,
      report.assigned_department
    ].some(value => String(value || '').toLowerCase().includes(search)));
  }

  return filtered;
};

const paginate = (items, query) => {
  const page = parsePositiveInt(query.page, 1, 10000);
  const limit = parsePositiveInt(query.limit, 50);
  const start = (page - 1) * limit;
  return {
    page,
    limit,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / limit)),
    data: items.slice(start, start + limit)
  };
};

const scopeAndRedactReports = (reports, zones, settings, adminUser) => {
  const enriched = enrichReportsWithZones(reports, zones).map(report => ({
    ...report,
    department: getReportDepartment(report, settings)
  }));
  const scoped = applyAdminReportScope(enriched, settings, adminUser);
  return redactReportsForAdmin(scoped, adminUser);
};

const assertReportAccess = (report, settings, adminUser) => {
  const scoped = applyAdminReportScope([report], settings, adminUser);
  if (!scoped.length) {
    throw createHttpError(403, 'Report is outside your admin scope');
  }
};

const hasRole = (user, roles) => roles.includes(user?.role);

const assertSentimentAccess = (user) => {
  if (!hasRole(user, ['admin', 'super_admin', 'student_affairs'])) {
    throw createHttpError(403, 'Sentiment data is outside your admin scope');
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([
      fetchReports(),
      fetchZones(),
      getAdminSettingsValue()
    ]);

    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildDashboardStats(scopedReports, zones, settings));
  } catch (error) {
    handleError(res, 'Dashboard Stats Error', error);
  }
};

const listAdminReports = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([
      fetchReports(),
      fetchZones(),
      getAdminSettingsValue()
    ]);

    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    const filtered = applyReportFilters(scopedReports, req.query);
    const page = paginate(filtered, req.query);

    ok(res, page.data, {
      results: page.data.length,
      pagination: {
        page: page.page,
        limit: page.limit,
        total: page.total,
        totalPages: page.totalPages
      }
    });
  } catch (error) {
    handleError(res, 'Admin Reports Error', error);
  }
};

const getAdminReport = async (req, res) => {
  const { id } = req.params;

  try {
    const [reports, zones, settings] = await Promise.all([
      fetchReports(),
      fetchZones(),
      getAdminSettingsValue()
    ]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    const report = scopedReports.find(item => String(item.id) === String(id));

    if (!report) {
      return res.status(404).json({ status: 'error', message: 'Report not found' });
    }

    const [comments, history, mentions, feedback, audit] = await Promise.all([
      fetchOptionalRows('comments', 'report_id', id, '*, users(display_name, avatar_url, rank)'),
      fetchOptionalRows('report_status_history', 'report_id', id),
      fetchOptionalRows('report_mentions', 'report_id', id),
      fetchOptionalRows('resolution_feedback', 'report_id', id),
      fetchOptionalRows('admin_audit_logs', 'resource_id', id)
    ]);

    ok(res, {
      ...redactReportIdentity(report, req.currentUser),
      department: getReportDepartment(report, settings),
      comments,
      timeline: history.reverse(),
      mentions,
      resolutionFeedback: feedback,
      auditLog: audit
    });
  } catch (error) {
    handleError(res, 'Admin Report Detail Error', error);
  }
};

const updateReportLifecycle = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id } = req.params;
  const lifecycleStatus = req.body.lifecycleStatus || req.body.lifecycle_status || req.body.status;
  const note = req.body.note || null;
  const now = new Date().toISOString();
  const adminId = req.currentUser?.id || req.user.id;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(previous, settings, req.currentUser);

    const update = {
      lifecycle_status: lifecycleStatus,
      updated_at: now
    };

    if (lifecycleStatus === 'acknowledged') {
      update.acknowledged_at = previous.acknowledged_at || now;
      update.acknowledged_by = previous.acknowledged_by || adminId;
    }

    if (lifecycleStatus === 'in_progress') {
      update.in_progress_at = previous.in_progress_at || now;
      update.in_progress_by = previous.in_progress_by || adminId;
      if (!previous.acknowledged_at) {
        update.acknowledged_at = now;
        update.acknowledged_by = adminId;
      }
    }

    if (lifecycleStatus === 'resolved') {
      update.status = 'resolved';
      update.resolved_at = previous.resolved_at || now;
      update.resolved_by = previous.resolved_by || adminId;
      if (!previous.acknowledged_at) {
        update.acknowledged_at = now;
        update.acknowledged_by = adminId;
      }
    }

    const { data: report, error } = await supabase
      .from('reports')
      .update(update)
      .eq('id', id)
      .select('*, users(display_name, avatar_url, email, rank)')
      .single();

    if (error) throw error;

    await insertReportHistory(id, lifecycleStatus, adminId, note, { source: 'admin_dashboard' });
    await logAdminAction(req, 'report.lifecycle_updated', 'report', id, previous, report, { note });

    emitRealtimeEvent('report.lifecycle_updated', {
      report,
      changed_by: req.currentUser,
      previous_lifecycle_status: normalizeLifecycle(previous)
    });

    ok(res, report);
  } catch (error) {
    handleError(res, 'Update Report Lifecycle Error', error);
  }
};

const assignReport = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id } = req.params;
  const department = req.body.department || req.body.assignedDepartment || req.body.assigned_department;
  const assigneeId = req.body.assigneeId || req.body.assigned_to || null;
  const now = new Date().toISOString();

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(previous, settings, req.currentUser);

    const { data: report, error } = await supabase
      .from('reports')
      .update({
        assigned_department: department,
        assigned_to: assigneeId,
        assigned_by: req.currentUser?.id || req.user.id,
        assigned_at: now,
        updated_at: now
      })
      .eq('id', id)
      .select('*, users(display_name, avatar_url, email, rank)')
      .single();

    if (error) throw error;

    await insertReportHistory(id, normalizeLifecycle(report), req.currentUser?.id || req.user.id, req.body.note, {
      assigned_department: department,
      assigned_to: assigneeId
    });
    await logAdminAction(req, 'report.assigned', 'report', id, previous, report);

    emitRealtimeEvent('report.assigned', {
      report,
      changed_by: req.currentUser
    });

    ok(res, report);
  } catch (error) {
    handleError(res, 'Assign Report Error', error);
  }
};

const addOfficialReportComment = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id } = req.params;

  try {
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (reportError) throw reportError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(report, settings, req.currentUser);

    const { data: comment, error } = await supabase
      .from('comments')
      .insert([{
        report_id: id,
        user_id: req.currentUser?.id || req.user.id,
        body: req.body.body,
        is_official: req.body.isOfficial !== false,
        mentioned_departments: req.body.mentionedDepartments || req.body.mentioned_departments || [],
        metadata: req.body.metadata || {},
        created_at: new Date().toISOString()
      }])
      .select('*, users(display_name, avatar_url, rank)')
      .single();

    if (error) throw error;

    await logAdminAction(req, 'report.official_comment_created', 'report', id, null, comment);
    emitRealtimeEvent('report.comment_created', { report_id: id, comment, changed_by: req.currentUser });

    res.status(201).json({ status: 'success', data: comment });
  } catch (error) {
    handleError(res, 'Official Comment Error', error);
  }
};

const escalateReport = async (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(previous, settings, req.currentUser);

    const nextLevel = Number(previous.escalation_level || 0) + 1;
    const { data: report, error } = await supabase
      .from('reports')
      .update({
        escalation_level: nextLevel,
        updated_at: now,
        metadata: {
          ...(previous.metadata || {}),
          last_escalation_reason: req.body.reason || null,
          last_escalated_at: now,
          last_escalated_by: req.currentUser?.id || req.user.id
        }
      })
      .eq('id', id)
      .select('*, users(display_name, avatar_url, email, rank)')
      .single();

    if (error) throw error;

    await supabase
      .from('report_escalations')
      .insert([{
        report_id: id,
        from_level: Number(previous.escalation_level || 0),
        to_level: nextLevel,
        department: previous.assigned_department || null,
        reason: req.body.reason || 'Manual escalation',
        metadata: { source: 'manual' },
        created_by: req.currentUser?.id || req.user.id,
        created_at: now
      }]);

    await insertReportHistory(id, normalizeLifecycle(report), req.currentUser?.id || req.user.id, req.body.reason || 'Escalated', {
      escalation_level: nextLevel
    });
    await logAdminAction(req, 'report.escalated', 'report', id, previous, report);
    await createAdminNotification({
      recipientRole: report.assigned_department || previous.assigned_department || 'super_admin',
      type: 'report.escalated',
      title: 'Report escalated',
      body: report.title,
      resourceType: 'report',
      resourceId: report.id,
      metadata: { escalation_level: nextLevel }
    });
    emitRealtimeEvent('report.escalated', { report, changed_by: req.currentUser });

    ok(res, report);
  } catch (error) {
    handleError(res, 'Escalate Report Error', error);
  }
};

const markReportDuplicate = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id } = req.params;
  const duplicateOf = req.body.duplicateOf || req.body.duplicate_of;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(previous, settings, req.currentUser);

    const { data: report, error } = await supabase
      .from('reports')
      .update({
        duplicate_of: duplicateOf,
        updated_at: new Date().toISOString(),
        metadata: {
          ...(previous.metadata || {}),
          duplicate_note: req.body.note || null
        }
      })
      .eq('id', id)
      .select('*, users(display_name, avatar_url, email, rank)')
      .single();

    if (error) throw error;

    await logAdminAction(req, 'report.marked_duplicate', 'report', id, previous, report);
    emitRealtimeEvent('report.marked_duplicate', { report, changed_by: req.currentUser });

    ok(res, report);
  } catch (error) {
    handleError(res, 'Mark Duplicate Error', error);
  }
};

const deleteReport = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logAdminAction(req, 'report.deleted', 'report', id, previous, null);
    emitRealtimeEvent('report.deleted', { report_id: id, changed_by: req.currentUser });
    ok(res, { id });
  } catch (error) {
    handleError(res, 'Delete Report Error', error);
  }
};

const updateReportStatus = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { reportId } = req.params;
  const { status } = req.body;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (fetchError) throw fetchError;
    const settings = await getAdminSettingsValue();
    assertReportAccess(previous, settings, req.currentUser);

    const update = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'resolved') {
      update.lifecycle_status = 'resolved';
      update.resolved_at = previous.resolved_at || new Date().toISOString();
      update.resolved_by = previous.resolved_by || req.currentUser?.id || req.user.id;
    }

    const { data: report, error } = await supabase
      .from('reports')
      .update(update)
      .eq('id', reportId)
      .select('*, users(display_name, avatar_url, email, rank)')
      .single();

    if (error) throw error;

    await logAdminAction(req, 'report.status_updated', 'report', reportId, previous, report);
    emitRealtimeEvent('report.updated', { report, changed_by: req.currentUser });

    ok(res, report);
  } catch (error) {
    handleError(res, 'Update Report Status Error', error);
  }
};

const getAdminZones = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildZoneSummaries(zones, scopedReports), { results: zones.length });
  } catch (error) {
    handleError(res, 'Admin Zones Error', error);
  }
};

const updateZoneStatus = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id } = req.params;
  const now = new Date().toISOString();
  const status = req.body.status;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('zones')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const update = {
      status,
      status_override: req.body.statusOverride || req.body.status_override || status,
      status_override_reason: req.body.reason || req.body.status_override_reason || null,
      status_overridden_by: req.currentUser?.id || req.user.id,
      status_overridden_at: now,
      updated_at: now
    };

    if (typeof req.body.maintenanceMode === 'boolean') update.maintenance_mode = req.body.maintenanceMode;
    if (typeof req.body.isActive === 'boolean') update.is_active = req.body.isActive;

    const { data: zone, error } = await supabase
      .from('zones')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAdminAction(req, 'zone.status_overridden', 'zone', id, previous, zone);
    emitRealtimeEvent('zone.status_updated', { zone, changed_by: req.currentUser });

    ok(res, zone);
  } catch (error) {
    handleError(res, 'Update Zone Status Error', error);
  }
};

const getAnalytics = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([
      fetchReports(),
      fetchZones(),
      getAdminSettingsValue()
    ]);

    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildAnalytics(scopedReports, zones, settings, req.query.range || 'this_month'));
  } catch (error) {
    handleError(res, 'Analytics Error', error);
  }
};

const getSentiment = async (req, res) => {
  try {
    assertSentimentAccess(req.currentUser);
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildSentiment(scopedReports, zones));
  } catch (error) {
    handleError(res, 'Sentiment Error', error);
  }
};

const getPredictions = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildPredictions(scopedReports, zones));
  } catch (error) {
    handleError(res, 'Predictions Error', error);
  }
};

const getBudgetEvidence = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    ok(res, buildBudgetEvidence(scopedReports, zones, req.query.zoneId, req.query.category));
  } catch (error) {
    handleError(res, 'Budget Evidence Error', error);
  }
};

const captureTensionSnapshot = async (req, res) => {
  try {
    assertSentimentAccess(req.currentUser);
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    const snapshot = buildTensionSnapshot(scopedReports, zones);

    const { data, error } = await supabase
      .from('campus_intelligence_snapshots')
      .insert([{
        snapshot_type: 'tension',
        mood_score: snapshot.mood_score,
        tension_index: snapshot.tension_index,
        tension_status: snapshot.tension_status,
        primary_driver: snapshot.primary_driver,
        affected_zone_ids: snapshot.affected_zone_ids,
        payload: snapshot.payload,
        created_by: req.currentUser?.id || req.user.id,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    await logAdminAction(req, 'sentiment.snapshot_created', 'sentiment', data.id, null, data);
    emitRealtimeEvent('sentiment.snapshot_created', { snapshot: data, changed_by: req.currentUser });

    res.status(201).json({ status: 'success', data });
  } catch (error) {
    handleError(res, 'Capture Tension Snapshot Error', error);
  }
};

const getTensionHistory = async (req, res) => {
  try {
    assertSentimentAccess(req.currentUser);

    const { data, error } = await supabase
      .from('campus_intelligence_snapshots')
      .select('*')
      .eq('snapshot_type', 'tension')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (error) throw error;
    ok(res, data || [], { results: data?.length || 0 });
  } catch (error) {
    handleError(res, 'Tension History Error', error);
  }
};

const getIncidents = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    const incidents = scopedReports
      .filter(report => report.status === 'critical' || report.peak_status === 'critical')
      .map(report => ({
        ...report,
        resolved_at: report.resolved_at || null,
        peakTrustScore: report.peak_trust_score || report.final_trust_score,
        meshBroadcastsSent: report.mesh_broadcast_count || 0
      }));

    ok(res, incidents, { results: incidents.length });
  } catch (error) {
    handleError(res, 'Incidents Error', error);
  }
};

const getSosHistory = async (req, res) => {
  try {
    if (!hasRole(req.currentUser, ['admin', 'super_admin', 'security'])) {
      throw createHttpError(403, 'SOS history is outside your admin scope');
    }

    const { data, error } = await supabase
      .from('sos_signals')
      .select('*, users(display_name, avatar_url, rank)')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (error) throw error;
    const rows = hasRole(req.currentUser, ['admin', 'super_admin'])
      ? data || []
      : (data || []).map(signal => ({ ...signal, user_id: null, users: null }));
    ok(res, rows, { results: rows.length });
  } catch (error) {
    handleError(res, 'SOS History Error', error);
  }
};

const listBroadcasts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*, users(display_name, avatar_url, role)')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (error) throw error;
    ok(res, data || [], { results: data?.length || 0 });
  } catch (error) {
    handleError(res, 'Broadcast List Error', error);
  }
};

const createBroadcast = async (req, res) => {
  if (handleValidation(req, res)) return;

  const scheduledFor = req.body.scheduledFor || req.body.scheduled_for || null;
  const targetZoneId = req.body.targetZoneId || req.body.target_zone_id || null;
  const priority = req.body.priority || 'normal';

  try {
    const { data: broadcast, error } = await supabase
      .from('announcements')
      .insert([{
        title: req.body.title,
        body: req.body.body || req.body.message,
        priority,
        audience_role: req.body.audienceRole || req.body.audience_role || 'all',
        broadcast_category: req.body.category || 'official_update',
        target_zone_id: targetZoneId,
        scheduled_for: scheduledFor,
        sent_at: scheduledFor ? null : new Date().toISOString(),
        created_by: req.currentUser?.id || req.user.id,
        metadata: req.body.metadata || {},
        created_at: new Date().toISOString()
      }])
      .select('*, users(display_name, avatar_url, role)')
      .single();

    if (error) throw error;

    await logAdminAction(req, 'broadcast.created', 'broadcast', broadcast.id, null, broadcast);

    if (!scheduledFor) {
      emitRealtimeEvent('broadcast.created', {
        broadcast,
        created_by: req.currentUser
      });
      await createAdminNotification({
        recipientRole: 'super_admin',
        type: 'broadcast.sent',
        title: 'Broadcast sent',
        body: broadcast.title,
        resourceType: 'broadcast',
        resourceId: broadcast.id,
        metadata: { priority: broadcast.priority }
      });
    }

    res.status(201).json({ status: 'success', data: broadcast });
  } catch (error) {
    handleError(res, 'Create Broadcast Error', error);
  }
};

const processScheduledBroadcasts = async (req, res) => {
  const now = new Date().toISOString();

  try {
    const { data: scheduled, error: fetchError } = await supabase
      .from('announcements')
      .select('*')
      .is('sent_at', null)
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', now)
      .eq('is_active', true)
      .limit(100);

    if (fetchError) throw fetchError;

    const processed = [];
    for (const broadcast of scheduled || []) {
      const { data, error } = await supabase
        .from('announcements')
        .update({ sent_at: now, updated_at: now })
        .eq('id', broadcast.id)
        .select('*, users(display_name, avatar_url, role)')
        .single();

      if (error) throw error;
      processed.push(data);

      await logAdminAction(req, 'broadcast.scheduled_sent', 'broadcast', data.id, broadcast, data);
      emitRealtimeEvent('broadcast.created', {
        broadcast: data,
        created_by: req.currentUser,
        scheduled: true
      });
      await createAdminNotification({
        recipientRole: 'super_admin',
        type: 'broadcast.sent',
        title: 'Scheduled broadcast sent',
        body: data.title,
        resourceType: 'broadcast',
        resourceId: data.id,
        metadata: { scheduled_for: data.scheduled_for }
      });
    }

    ok(res, processed, { results: processed.length });
  } catch (error) {
    handleError(res, 'Process Scheduled Broadcasts Error', error);
  }
};

const getBroadcastTemplates = async (req, res) => {
  try {
    const settings = await getAdminSettingsValue();
    ok(res, settings.broadcastTemplates || []);
  } catch (error) {
    handleError(res, 'Broadcast Templates Error', error);
  }
};

const getInbox = async (req, res) => {
  try {
    const [reports, zones, settings] = await Promise.all([
      fetchReports(),
      fetchZones(),
      getAdminSettingsValue()
    ]);
    let inbox = buildInbox(scopeAndRedactReports(reports, zones, settings, req.currentUser), settings, req.currentUser);
    const tab = req.query.tab || 'unacknowledged';

    if (tab === 'unacknowledged') inbox = inbox.filter(report => normalizeLifecycle(report) === 'submitted');
    if (tab === 'in_progress') inbox = inbox.filter(report => normalizeLifecycle(report) === 'in_progress' || normalizeLifecycle(report) === 'acknowledged');
    if (tab === 'resolved') inbox = inbox.filter(report => normalizeLifecycle(report) === 'resolved');

    ok(res, inbox, { results: inbox.length });
  } catch (error) {
    handleError(res, 'Inbox Error', error);
  }
};

const listEscalations = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('report_escalations')
      .select('*, reports(title, category, status, lifecycle_status, zone_id)')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (error) throw error;

    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const allowedReportIds = new Set(scopeAndRedactReports(reports, zones, settings, req.currentUser).map(report => String(report.id)));
    const scoped = (data || []).filter(escalation => allowedReportIds.has(String(escalation.report_id)));

    ok(res, scoped, { results: scoped.length });
  } catch (error) {
    handleError(res, 'Escalations Error', error);
  }
};

const runEscalationSweep = async (req, res) => {
  const now = new Date().toISOString();

  try {
    const [reports, zones, settings] = await Promise.all([fetchReports(), fetchZones(), getAdminSettingsValue()]);
    const scopedReports = scopeAndRedactReports(reports, zones, settings, req.currentUser);
    const candidates = buildEscalationCandidates(scopedReports, settings, new Date(now));
    const processed = [];

    for (const candidate of candidates) {
      const previous = candidate.report;
      const metadata = {
        sla_stage: candidate.sla.stage,
        overdue_hours: candidate.sla.overdueHours,
        department: candidate.department,
        triggered_by: req.currentUser?.id || req.user.id
      };

      const { data: report, error: updateError } = await supabase
        .from('reports')
        .update({
          escalation_level: candidate.nextLevel,
          updated_at: now,
          metadata: {
            ...(previous.metadata || {}),
            last_escalation_reason: 'SLA breach',
            last_escalated_at: now,
            last_escalated_by: req.currentUser?.id || req.user.id
          }
        })
        .eq('id', previous.id)
        .select('*, users(display_name, avatar_url, email, rank)')
        .single();

      if (updateError) throw updateError;

      const { data: escalation, error: escalationError } = await supabase
        .from('report_escalations')
        .insert([{
          report_id: previous.id,
          from_level: Number(previous.escalation_level || 0),
          to_level: candidate.nextLevel,
          department: candidate.department,
          reason: 'SLA breach',
          metadata,
          created_by: req.currentUser?.id || req.user.id,
          created_at: now
        }])
        .select()
        .single();

      if (escalationError) throw escalationError;

      await insertReportHistory(previous.id, normalizeLifecycle(report), req.currentUser?.id || req.user.id, 'Escalated by SLA sweep', metadata);
      await logAdminAction(req, 'report.sla_escalated', 'report', previous.id, previous, report, metadata);
      await createAdminNotification({
        recipientRole: candidate.department,
        type: 'report.sla_breach',
        title: 'SLA breach escalated',
        body: report.title,
        resourceType: 'report',
        resourceId: report.id,
        metadata
      });
      await createAdminNotification({
        recipientRole: 'super_admin',
        type: 'report.sla_breach',
        title: 'SLA breach escalated',
        body: report.title,
        resourceType: 'report',
        resourceId: report.id,
        metadata
      });
      emitRealtimeEvent('report.escalated', { report, escalation, changed_by: req.currentUser });
      processed.push({ report, escalation });
    }

    ok(res, processed, { results: processed.length });
  } catch (error) {
    handleError(res, 'Run Escalation Sweep Error', error);
  }
};

const getMentions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('report_mentions')
      .select('*, reports(title, category, status, lifecycle_status, zone_id), users(display_name, avatar_url, rank)')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (error) throw error;

    const role = req.currentUser?.role;
    const scoped = ['admin', 'super_admin'].includes(role)
      ? data || []
      : (data || []).filter(mention => mention.department === role);
    const output = ['admin', 'super_admin'].includes(role)
      ? scoped
      : scoped.map(mention => ({ ...mention, user_id: null, users: null }));

    ok(res, output, { results: output.length });
  } catch (error) {
    handleError(res, 'Mentions Error', error);
  }
};

const listUsers = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 500, 1000));

    if (error) throw error;

    ok(res, users || [], { results: users?.length || 0 });
  } catch (error) {
    handleError(res, 'List Users Error', error);
  }
};

const createStaffUser = async (req, res) => {
  if (handleValidation(req, res)) return;

  const {
    email,
    password,
    displayName,
    display_name,
    department,
    role
  } = req.body;

  try {
    const normalizedEmail = String(email).toLowerCase();
    if (!normalizedEmail.endsWith('@unilorin.edu.ng')) {
      throw createHttpError(400, 'Staff/admin email must be @unilorin.edu.ng');
    }

    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (existingUser) throw createHttpError(409, 'User already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        email: normalizedEmail,
        password_hash: passwordHash,
        display_name: displayName || display_name || normalizedEmail.split('@')[0],
        department: department || null,
        role: role || 'staff',
        reliability_score: 5,
        rank: 'Staff',
        status: 'active',
        created_at: new Date().toISOString()
      }])
      .select('*')
      .single();

    if (error) throw error;

    await logAdminAction(req, 'user.staff_created', 'user', user.id, null, { ...user, password_hash: undefined });
    emitRealtimeEvent('user.created', { user: { ...user, password_hash: undefined }, changed_by: req.currentUser });

    const { password_hash, ...safeUser } = user;
    res.status(201).json({ status: 'success', data: safeUser });
  } catch (error) {
    handleError(res, 'Create Staff User Error', error);
  }
};

const updateUser = async (req, res) => {
  if (handleValidation(req, res)) return;

  const { id, userId } = req.params;
  const targetUserId = id || userId;
  const update = {};
  const allowedFields = ['role', 'reliability_score', 'display_name', 'department', 'status'];

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) update[field] = req.body[field];
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'reliabilityScore')) {
    update.reliability_score = req.body.reliabilityScore;
  }

  if (Object.prototype.hasOwnProperty.call(update, 'reliability_score') && !req.body.reason) {
    return res.status(400).json({
      status: 'error',
      message: 'A reason is required when changing reliability score'
    });
  }

  update.updated_at = new Date().toISOString();

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', targetUserId)
      .single();

    if (fetchError) throw fetchError;

    const { data: user, error } = await supabase
      .from('users')
      .update(update)
      .eq('id', targetUserId)
      .select('*')
      .single();

    if (error) throw error;

    if (Object.prototype.hasOwnProperty.call(update, 'reliability_score')) {
      await supabase
        .from('reliability_adjustments')
        .insert([{
          user_id: targetUserId,
          admin_id: req.currentUser?.id || req.user.id,
          previous_score: previous.reliability_score,
          new_score: user.reliability_score,
          reason: req.body.reason,
          created_at: new Date().toISOString()
        }]);
    }

    await logAdminAction(req, 'user.updated', 'user', targetUserId, previous, user, {
      reason: req.body.reason || null
    });
    emitRealtimeEvent('user.updated', { user, changed_by: req.currentUser });

    ok(res, user);
  } catch (error) {
    handleError(res, 'Update User Error', error);
  }
};

const updateUserRole = updateUser;

const adjustUserReliability = async (req, res) => {
  req.body.reliability_score = req.body.reliabilityScore ?? req.body.reliability_score;
  return updateUser(req, res);
};

const getSettings = async (req, res) => {
  try {
    ok(res, await getAdminSettingsValue());
  } catch (error) {
    handleError(res, 'Get Settings Error', error);
  }
};

const updateSettings = async (req, res) => {
  try {
    const previous = await getAdminSettingsValue();
    const next = await saveAdminSettingsValue({
      ...previous,
      ...req.body,
      sla: {
        ...previous.sla,
        ...(req.body.sla || {})
      }
    });

    await logAdminAction(req, 'settings.updated', 'settings', 'platform', previous, next);
    emitRealtimeEvent('settings.updated', { settings: next, changed_by: req.currentUser });

    ok(res, next);
  } catch (error) {
    handleError(res, 'Update Settings Error', error);
  }
};

const getAuditLog = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('*, users(display_name, avatar_url, email, role)')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 200, 1000));

    if (error) throw error;
    ok(res, data || [], { results: data?.length || 0 });
  } catch (error) {
    handleError(res, 'Audit Log Error', error);
  }
};

const listAdminNotifications = async (req, res) => {
  try {
    let query = supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parsePositiveInt(req.query.limit, 100));

    if (!hasRole(req.currentUser, ['super_admin'])) {
      query = query.or(`recipient_user_id.eq.${req.currentUser.id},recipient_role.eq.${req.currentUser.role}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    ok(res, data || [], {
      results: data?.length || 0,
      unread: (data || []).filter(item => !item.read_at).length
    });
  } catch (error) {
    handleError(res, 'Notifications Error', error);
  }
};

const markNotificationRead = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: previous, error: fetchError } = await supabase
      .from('admin_notifications')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const canRead = hasRole(req.currentUser, ['super_admin']) ||
      previous.recipient_user_id === req.currentUser.id ||
      previous.recipient_role === req.currentUser.role;

    if (!canRead) throw createHttpError(403, 'Notification is outside your admin scope');

    const { data, error } = await supabase
      .from('admin_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    ok(res, data);
  } catch (error) {
    handleError(res, 'Mark Notification Read Error', error);
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
  listAdminReports,
  listBroadcasts,
  listEscalations,
  listAdminNotifications,
  listUsers,
  markReportDuplicate,
  markNotificationRead,
  processScheduledBroadcasts,
  runEscalationSweep,
  subscribeToAdminEvents,
  updateReportLifecycle,
  updateReportStatus,
  updateSettings,
  updateUser,
  updateUserRole,
  updateZoneStatus
};
