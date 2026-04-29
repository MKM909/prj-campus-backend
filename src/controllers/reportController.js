const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');
const { emitRealtimeEvent } = require('../utils/realtimeHub');

// @desc    Create a new report
// @route   POST /api/reports
// @access  Private
const createReport = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: 'error', errors: errors.array() });
  }

  const {
    id,
    zoneId,
    category,
    title,
    description,
    photoUrl,
    isAnonymous,
    confidenceScore,
  } = req.body;

  // Use userId from the authenticated JWT (req.user)
  const authUserId = req.user.id;

  try {
    // Fetch the user's reliability score from the database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('reliability_score')
      .eq('id', authUserId)
      .single();

    if (userError) throw userError;

    const reliabilityScore = userData?.reliability_score || 5.0;
    const aiScore = 5.0; // Starts at 5.0, updated by Claude
    const baseConfidence = confidenceScore || 3.0;

    // FTS = (Confidence × 0.40) + (Reliability × 0.35) + (AI Score × 0.25)
    let finalTrustScore = (baseConfidence * 0.40) + (reliabilityScore * 0.35) + (aiScore * 0.25);
    finalTrustScore = Math.max(0, Math.min(10, finalTrustScore)); // Clamp to 0-10

    // Determine initial status based on FTS
    let status = 'pending';
    if (finalTrustScore >= 7.5) status = 'critical';
    else if (finalTrustScore >= 5.5) status = 'verified';
    else if (finalTrustScore >= 3.5) status = 'community';

    // If anonymous, set user_id to null to hide identity, but we still used their score
    const finalUserId = isAnonymous ? null : authUserId;

    const reportData = {
      user_id: finalUserId,
      zone_id: zoneId,
      category,
      title,
      description,
      photo_url: photoUrl,
      is_anonymous: isAnonymous || false,
      confidence_score: baseConfidence,
      reliability_score: reliabilityScore,
      ai_score: aiScore,
      final_trust_score: finalTrustScore,
      status: status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (id) reportData.id = id;

    const { data: newReport, error } = await supabase
      .from('reports')
      .insert([reportData])
      .select()
      .single();

    if (error) throw error;

    emitRealtimeEvent('report.created', {
      report: newReport
    });

    res.status(201).json({
      status: 'success',
      data: newReport
    });

  } catch (error) {
    console.error('Create Report Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to save report: ' + error.message
    });
  }
};

// @desc    Get all reports (with optional filters)
// @route   GET /api/reports
// @access  Public
const getReports = async (req, res) => {
  const { zoneId, category, status } = req.query;

  try {
    let query = supabase
      .from('reports')
      .select('*, users(display_name, avatar_url)')
      .order('created_at', { ascending: false });

    if (zoneId) query = query.eq('zone_id', zoneId);
    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);

    const { data: reports, error } = await query;

    if (error) throw error;

    res.json({
      status: 'success',
      results: reports.length,
      data: reports
    });

  } catch (error) {
    console.error('Get Reports Error:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch reports'
    });
  }
};

module.exports = {
  createReport,
  getReports
};
