const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyAdminReportScope,
  buildAnalytics,
  buildBudgetEvidence,
  buildDashboardStats,
  buildEscalationCandidates,
  buildInbox,
  buildPredictions,
  buildSentiment,
  calculateCampusHealthScore,
  calculateZoneHealthScore,
  getSlaState,
  mergeAdminSettings,
  redactReportsForAdmin,
  zoneStatusFromScore
} = require('../src/services/adminIntelligenceService');

const zones = [
  { id: 'zone-a', name: 'Student Hostels', status: 'normal' },
  { id: 'zone-b', name: 'Faculty of CIS', status: 'normal' }
];

const reports = [
  {
    id: 'r1',
    zone_id: 'zone-a',
    category: 'power',
    title: 'Power outage',
    status: 'critical',
    lifecycle_status: 'submitted',
    final_trust_score: 8.7,
    created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'r2',
    zone_id: 'zone-a',
    category: 'water',
    title: 'Water pressure',
    status: 'verified',
    lifecycle_status: 'acknowledged',
    acknowledged_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    final_trust_score: 6.1,
    created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'r3',
    zone_id: 'zone-b',
    category: 'security',
    title: 'Lighting',
    status: 'resolved',
    lifecycle_status: 'resolved',
    final_trust_score: 7,
    created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    resolved_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  }
];

test('calculateCampusHealthScore follows PRD active report weighting', () => {
  const health = calculateCampusHealthScore(reports);
  assert.equal(health.activeCount, 2);
  assert.equal(health.counts.critical, 1);
  assert.equal(health.counts.verified, 1);
  assert.equal(health.score, 80);
});

test('calculateZoneHealthScore maps to PRD zone status bands', () => {
  const score = calculateZoneHealthScore(reports.filter(report => report.zone_id === 'zone-a'));
  assert.equal(score, 72);
  assert.equal(zoneStatusFromScore(score), 'watch');
});

test('buildDashboardStats returns command centre payload', () => {
  const stats = buildDashboardStats(reports, zones);
  assert.equal(stats.campusHealth, 80);
  assert.equal(stats.criticalActive, 1);
  assert.equal(stats.totalActiveReports, 2);
  assert.equal(stats.zoneHealth.length, 2);
  assert.equal(stats.liveFeed[0].id, 'r1');
});

test('getSlaState detects overdue submitted reports', () => {
  const settings = mergeAdminSettings({});
  const sla = getSlaState(reports[0], settings);
  assert.equal(sla.breached, true);
  assert.equal(sla.stage, 'acknowledge');
});

test('buildInbox scopes non-super-admin users to their department', () => {
  const settings = mergeAdminSettings({});
  const inbox = buildInbox(reports, settings, { role: 'facilities' });
  assert.deepEqual(inbox.map(report => report.id).sort(), ['r1', 'r2']);
});

test('buildAnalytics, sentiment, and predictions provide dashboard-ready objects', () => {
  const settings = mergeAdminSettings({});
  const analytics = buildAnalytics(reports, zones, settings, 'this_week');
  const sentiment = buildSentiment(reports, zones);
  const predictions = buildPredictions([
    ...reports,
    { ...reports[0], id: 'r4' },
    { ...reports[0], id: 'r5' }
  ], zones);

  assert.ok(Array.isArray(analytics.reportVolumeOverTime));
  assert.equal(sentiment.primaryDriver, 'power');
  assert.ok(predictions.predictions.length >= 1);
});

test('applyAdminReportScope limits department roles to their categories', () => {
  const settings = mergeAdminSettings({});
  const scoped = applyAdminReportScope(reports, settings, { role: 'security' });
  assert.deepEqual(scoped.map(report => report.id), ['r3']);
});

test('redactReportsForAdmin hides reporter identity outside full-access roles', () => {
  const redacted = redactReportsForAdmin([{ id: 'r1', user_id: 'u1', users: { email: 'a@school.edu.ng' } }], { role: 'facilities' });
  assert.equal(redacted[0].user_id, null);
  assert.equal(redacted[0].users, null);
});

test('buildBudgetEvidence summarizes evidence for zone and category', () => {
  const evidence = buildBudgetEvidence(reports, zones, 'zone-a', 'power');
  assert.equal(evidence.totalReports, 1);
  assert.equal(evidence.criticalIncidents, 1);
  assert.equal(evidence.zone.name, 'Student Hostels');
});

test('buildEscalationCandidates detects SLA candidates above current level', () => {
  const settings = mergeAdminSettings({});
  const candidates = buildEscalationCandidates(reports, settings, new Date());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].report.id, 'r1');
  assert.equal(candidates[0].department, 'facilities');
});
