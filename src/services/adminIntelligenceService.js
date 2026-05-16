const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const ADMIN_ROLES = [
  'admin',
  'super_admin',
  'dept_admin',
  'facilities',
  'security',
  'student_affairs',
  'it_admin'
];

const SUPER_ADMIN_ROLES = ['super_admin'];
const FULL_ACCESS_ROLES = ['admin', 'super_admin'];

const CATEGORY_DEPARTMENT_MAP = {
  power: 'facilities',
  water: 'facilities',
  sanitation: 'facilities',
  structural: 'facilities',
  security: 'security',
  connectivity: 'it_admin',
  environment: 'student_affairs',
  welfare: 'student_affairs'
};

const DEPARTMENT_CATEGORY_SCOPE = {
  facilities: ['power', 'water', 'sanitation', 'structural'],
  security: ['security'],
  student_affairs: ['environment', 'welfare'],
  it_admin: ['connectivity']
};

const DEFAULT_ADMIN_SETTINGS = {
  sla: {
    power: { acknowledgeHours: 4, resolveHours: 48 },
    water: { acknowledgeHours: 8, resolveHours: 72 },
    security: { acknowledgeHours: 1, resolveHours: 24 },
    sanitation: { acknowledgeHours: 24, resolveHours: 96 },
    structural: { acknowledgeHours: 48, resolveHours: 168 },
    connectivity: { acknowledgeHours: 4, resolveHours: 48 },
    environment: { acknowledgeHours: 2, resolveHours: 24 },
    welfare: { acknowledgeHours: 8, resolveHours: 72 }
  },
  departments: [
    {
      id: 'facilities',
      name: 'Facilities Dept',
      categories: ['power', 'water', 'sanitation', 'structural'],
      escalationEmail: null
    },
    {
      id: 'security',
      name: 'Security Dept',
      categories: ['security'],
      escalationEmail: null
    },
    {
      id: 'it_admin',
      name: 'IT Department',
      categories: ['connectivity'],
      escalationEmail: null
    },
    {
      id: 'student_affairs',
      name: 'Student Affairs',
      categories: ['environment', 'welfare'],
      escalationEmail: null
    }
  ],
  notifications: {
    criticalReports: { enabled: true, roles: ['super_admin', 'security', 'facilities'] },
    slaBreaches: { enabled: true, roles: ['super_admin', 'dept_admin'] },
    tensionIndex: { enabled: true, threshold: 60, roles: ['super_admin'] },
    mentions: { enabled: true },
    dailyHealthSummary: { enabled: false, time: '08:00', roles: ['super_admin'] }
  },
  broadcastTemplates: [
    'Power maintenance scheduled for [zone] on [date] from [time] to [time]',
    'Water supply restored in [zone] - all facilities now operational',
    'Security alert: Exercise caution in [zone]. Security team has been notified.',
    'Generator failure in [zone] - Engineering team dispatched, ETA [time]',
    'Exam period reminder: Report any facility issues immediately via Buzz'
  ]
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const hoursBetween = (start, end) => {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate || !endDate) return null;
  return Math.max(0, (endDate.getTime() - startDate.getTime()) / MS_PER_HOUR);
};

const normalizeCategory = (category) => String(category || 'uncategorized').toLowerCase();

const normalizeLifecycle = (report) => {
  if (report?.lifecycle_status) return report.lifecycle_status;
  if (report?.status === 'resolved' || report?.resolved_at) return 'resolved';
  return 'submitted';
};

const resolvedAt = (report) => report?.resolved_at || (report?.status === 'resolved' ? report?.updated_at : null);

const isResolvedReport = (report) => report?.status === 'resolved' || normalizeLifecycle(report) === 'resolved' || Boolean(report?.resolved_at);

const isActiveReport = (report) => !isResolvedReport(report);

const getReportDepartment = (report, settings = DEFAULT_ADMIN_SETTINGS) => {
  if (report?.assigned_department) return report.assigned_department;
  const category = normalizeCategory(report?.category);
  const configured = settings.departments?.find(dept => dept.categories?.includes(category));
  return configured?.id || CATEGORY_DEPARTMENT_MAP[category] || 'unassigned';
};

const categoriesForDepartment = (department, settings = DEFAULT_ADMIN_SETTINGS) => {
  const configured = settings.departments?.find(item => item.id === department || item.name === department);
  if (configured?.categories?.length) return configured.categories.map(normalizeCategory);
  return DEPARTMENT_CATEGORY_SCOPE[department] || [];
};

const applyAdminReportScope = (reports, settings = DEFAULT_ADMIN_SETTINGS, user = {}) => {
  const role = user?.role || 'student';
  if (FULL_ACCESS_ROLES.includes(role)) return reports;

  if (role === 'dept_admin') {
    const scopedDepartment = user?.department;
    if (!scopedDepartment) return [];

    const categories = categoriesForDepartment(scopedDepartment, settings);
    return reports.filter(report => {
      const reportDepartment = getReportDepartment(report, settings);
      return reportDepartment === scopedDepartment || categories.includes(normalizeCategory(report.category));
    });
  }

  if (DEPARTMENT_CATEGORY_SCOPE[role]) {
    const categories = categoriesForDepartment(role, settings);
    return reports.filter(report => categories.includes(normalizeCategory(report.category)));
  }

  return [];
};

const redactReportIdentity = (report, user = {}) => {
  if (FULL_ACCESS_ROLES.includes(user?.role)) return report;

  const redacted = { ...report };
  redacted.user_id = null;
  if (redacted.users) redacted.users = null;
  if (redacted.user) redacted.user = null;
  return redacted;
};

const redactReportsForAdmin = (reports, user = {}) => reports.map(report => redactReportIdentity(report, user));

const countBy = (items, getKey) => {
  const counts = {};
  for (const item of items) {
    const key = getKey(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

const average = (values) => {
  const numeric = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const startOfDayIso = (value) => {
  const date = toDate(value);
  if (!date) return 'unknown';
  return date.toISOString().slice(0, 10);
};

const getRangeStart = (range = 'this_month') => {
  const now = new Date();
  const normalized = String(range || '').toLowerCase();

  if (normalized === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (normalized === 'this_week') return new Date(now.getTime() - 7 * MS_PER_DAY);
  if (normalized === 'this_semester') return new Date(now.getTime() - 120 * MS_PER_DAY);
  if (normalized === 'last_12_months') return new Date(now.getTime() - 365 * MS_PER_DAY);
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const filterReportsByRange = (reports, range) => {
  const start = getRangeStart(range);
  return reports.filter(report => {
    const created = toDate(report.created_at);
    return created && created >= start;
  });
};

const calculateCampusHealthScore = (reports) => {
  const active = reports.filter(isActiveReport);
  const counts = countBy(active, report => report.status || 'pending');
  const rawScore = 100 - (
    (counts.critical || 0) * 15 +
    (counts.verified || 0) * 5 +
    (counts.community || 0) * 2 +
    (counts.pending || 0) * 0.5
  );

  return {
    score: Math.round(clamp(rawScore, 0, 100)),
    activeCount: active.length,
    counts
  };
};

const calculateZoneHealthScore = (zoneReports) => {
  const active = zoneReports.filter(isActiveReport);
  const counts = countBy(active, report => report.status || 'pending');
  const rawScore = 100 - (
    (counts.critical || 0) * 20 +
    (counts.verified || 0) * 8 +
    (counts.community || 0) * 3 +
    (counts.pending || 0) * 1
  );

  return Math.round(clamp(rawScore, 0, 100));
};

const zoneStatusFromScore = (score) => {
  if (score >= 75) return 'normal';
  if (score >= 50) return 'watch';
  if (score >= 30) return 'alert';
  return 'critical';
};

const enrichReportsWithZones = (reports, zones) => {
  const zoneMap = new Map((zones || []).map(zone => [String(zone.id), zone]));
  return reports.map(report => ({
    ...report,
    zone: zoneMap.get(String(report.zone_id)) || null,
    lifecycle_status: normalizeLifecycle(report),
    department: getReportDepartment(report)
  }));
};

const buildZoneSummaries = (zones, reports) => {
  return (zones || []).map(zone => {
    const zoneReports = reports.filter(report => String(report.zone_id) === String(zone.id));
    const active = zoneReports.filter(isActiveReport);
    const score = calculateZoneHealthScore(zoneReports);
    const lastIncident = zoneReports
      .map(report => toDate(report.created_at))
      .filter(Boolean)
      .sort((a, b) => b - a)[0];

    return {
      ...zone,
      healthScore: score,
      computedStatus: zoneStatusFromScore(score),
      displayStatus: zone.status_override || zone.status || zoneStatusFromScore(score),
      activeReports: active.length,
      lastIncidentAt: lastIncident ? lastIncident.toISOString() : null,
      categoryCounts: countBy(zoneReports, report => normalizeCategory(report.category))
    };
  }).sort((a, b) => a.healthScore - b.healthScore);
};

const getSlaForReport = (report, settings = DEFAULT_ADMIN_SETTINGS) => {
  const category = normalizeCategory(report?.category);
  return settings.sla?.[category] || { acknowledgeHours: 24, resolveHours: 72 };
};

const getSlaState = (report, settings = DEFAULT_ADMIN_SETTINGS, now = new Date()) => {
  const created = toDate(report.created_at);
  if (!created || isResolvedReport(report)) {
    return { breached: false, stage: null, overdueHours: 0 };
  }

  const lifecycle = normalizeLifecycle(report);
  const ageHours = (now.getTime() - created.getTime()) / MS_PER_HOUR;
  const sla = getSlaForReport(report, settings);

  if (lifecycle === 'submitted' && ageHours > sla.acknowledgeHours) {
    return {
      breached: true,
      stage: 'acknowledge',
      overdueHours: Math.round((ageHours - sla.acknowledgeHours) * 10) / 10
    };
  }

  if (ageHours > sla.resolveHours) {
    return {
      breached: true,
      stage: 'resolve',
      overdueHours: Math.round((ageHours - sla.resolveHours) * 10) / 10
    };
  }

  return { breached: false, stage: null, overdueHours: 0 };
};

const buildDashboardStats = (reports, zones, settings = DEFAULT_ADMIN_SETTINGS) => {
  const enrichedReports = enrichReportsWithZones(reports, zones);
  const health = calculateCampusHealthScore(enrichedReports);
  const activeReports = enrichedReports.filter(isActiveReport);
  const criticalReports = activeReports.filter(report => report.status === 'critical');
  const unacknowledgedCritical = criticalReports.filter(report => normalizeLifecycle(report) === 'submitted');
  const zoneSummaries = buildZoneSummaries(zones, enrichedReports);
  const resolvedThisWeek = filterReportsByRange(enrichedReports.filter(isResolvedReport), 'this_week');
  const resolutionHours = resolvedThisWeek
    .map(report => hoursBetween(report.created_at, resolvedAt(report)))
    .filter(value => value !== null);
  const slaBreaches = activeReports.filter(report => getSlaState(report, settings).breached);

  return {
    campusHealth: health.score,
    statusCounts: health.counts,
    criticalActive: criticalReports.length,
    unacknowledgedCritical: unacknowledgedCritical.length,
    totalActiveReports: activeReports.length,
    activeZoneCount: zoneSummaries.filter(zone => zone.activeReports > 0).length,
    avgResolutionHoursThisWeek: average(resolutionHours),
    slaBreaches: slaBreaches.length,
    criticalAlerts: criticalReports
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20),
    zoneHealth: zoneSummaries,
    liveFeed: enrichedReports
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50)
  };
};

const buildAnalytics = (reports, zones, settings = DEFAULT_ADMIN_SETTINGS, range = 'this_month') => {
  const rangedReports = filterReportsByRange(enrichReportsWithZones(reports, zones), range);
  const resolvedReports = rangedReports.filter(isResolvedReport);
  const zoneSummaries = buildZoneSummaries(zones, rangedReports);
  const volumeMap = {};
  const hourlyPattern = Array.from({ length: 7 }, (_, day) => ({
    day,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  }));

  for (const report of rangedReports) {
    const day = startOfDayIso(report.created_at);
    const category = normalizeCategory(report.category);
    volumeMap[day] ||= {};
    volumeMap[day][category] = (volumeMap[day][category] || 0) + 1;

    const created = toDate(report.created_at);
    if (created) hourlyPattern[created.getDay()].hours[created.getHours()].count += 1;
  }

  const resolutionByCategory = Object.entries(countBy(resolvedReports, report => normalizeCategory(report.category)))
    .map(([category]) => {
      const categoryReports = resolvedReports.filter(report => normalizeCategory(report.category) === category);
      return {
        category,
        avgHours: average(categoryReports.map(report => hoursBetween(report.created_at, resolvedAt(report))))
      };
    });

  const trustBuckets = [
    { label: '0-2', min: 0, max: 2 },
    { label: '2-4', min: 2, max: 4 },
    { label: '4-6', min: 4, max: 6 },
    { label: '6-8', min: 6, max: 8 },
    { label: '8-10', min: 8, max: 10.01 }
  ].map(bucket => ({
    ...bucket,
    count: rangedReports.filter(report => {
      const score = Number(report.final_trust_score || 0);
      return score >= bucket.min && score < bucket.max;
    }).length
  }));

  const departmentPerformance = buildDepartmentPerformance(rangedReports, settings);
  const slaEligible = rangedReports.filter(report => report.acknowledged_at || report.resolved_at);
  const slaCompliant = slaEligible.filter(report => {
    const ackHours = hoursBetween(report.created_at, report.acknowledged_at || report.resolved_at);
    if (ackHours === null) return false;
    return ackHours <= getSlaForReport(report, settings).acknowledgeHours;
  });

  return {
    range,
    reportVolumeOverTime: Object.entries(volumeMap).map(([date, categories]) => ({ date, categories })),
    categoryDistribution: countBy(rangedReports, report => normalizeCategory(report.category)),
    zoneHealthRanking: zoneSummaries,
    resolutionTimeByCategory: resolutionByCategory,
    trustScoreDistribution: trustBuckets,
    hourlyIncidentPattern: hourlyPattern,
    statCards: {
      reportsInRange: rangedReports.length,
      fastestResolvedHours: average(resolvedReports.map(report => hoursBetween(report.created_at, resolvedAt(report))) || []),
      mostReportedZone: zoneSummaries.slice().sort((a, b) => b.activeReports - a.activeReports)[0] || null,
      slaComplianceRate: slaEligible.length ? Math.round((slaCompliant.length / slaEligible.length) * 100) : null,
      chronicIssuesDetected: detectChronicIssues(rangedReports).length,
      meshBroadcastsSent: 0
    },
    departmentPerformance
  };
};

const buildBudgetEvidence = (reports, zones, zoneId, category) => {
  const normalizedCategory = normalizeCategory(category);
  const selectedReports = reports.filter(report => {
    const matchesZone = !zoneId || String(report.zone_id) === String(zoneId);
    const matchesCategory = !category || normalizeCategory(report.category) === normalizedCategory;
    return matchesZone && matchesCategory;
  });
  const zone = zones.find(item => String(item.id) === String(zoneId)) || null;
  const verified = selectedReports.filter(report => Number(report.final_trust_score || 0) > 5);
  const critical = selectedReports.filter(report => report.status === 'critical');
  const resolved = selectedReports.filter(isResolvedReport);
  const avgTrust = average(selectedReports.map(report => Number(report.final_trust_score || 0)));
  const meanResolution = average(resolved.map(report => hoursBetween(report.created_at, resolvedAt(report))));
  const byQuarter = countBy(selectedReports, report => {
    const created = toDate(report.created_at);
    if (!created) return 'unknown';
    return `${created.getUTCFullYear()}-Q${Math.floor(created.getUTCMonth() / 3) + 1}`;
  });
  const peakBuckets = countBy(selectedReports, report => {
    const created = toDate(report.created_at);
    if (!created) return 'unknown';
    return `day-${created.getUTCDay()}-hour-${created.getUTCHours()}`;
  });

  return {
    zone: zone ? { id: zone.id, name: zone.name } : null,
    category: category || 'all',
    period: 'last_12_months',
    totalReports: selectedReports.length,
    crowdVerified: verified.length,
    crowdVerifiedRate: selectedReports.length ? Math.round((verified.length / selectedReports.length) * 100) : 0,
    criticalIncidents: critical.length,
    averageTrustScore: avgTrust,
    meanResolutionHours: meanResolution,
    chronicIssue: detectChronicIssues(selectedReports).length > 0,
    historicalPattern: byQuarter,
    peakFailureBuckets: Object.entries(peakBuckets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([bucket, count]) => ({ bucket, count })),
    reports: selectedReports.slice(0, 100)
  };
};

const buildDepartmentPerformance = (reports, settings = DEFAULT_ADMIN_SETTINGS) => {
  const departments = settings.departments || DEFAULT_ADMIN_SETTINGS.departments;
  return departments.map(department => {
    const assigned = reports.filter(report => getReportDepartment(report, settings) === department.id);
    const acknowledged = assigned.filter(report => report.acknowledged_at || normalizeLifecycle(report) !== 'submitted');
    const resolved = assigned.filter(isResolvedReport);
    return {
      id: department.id,
      name: department.name,
      assigned: assigned.length,
      acknowledged: acknowledged.length,
      resolved: resolved.length,
      acknowledgementRate: assigned.length ? Math.round((acknowledged.length / assigned.length) * 100) : 0,
      resolutionRate: assigned.length ? Math.round((resolved.length / assigned.length) * 100) : 0,
      avgResolutionHours: average(resolved.map(report => hoursBetween(report.created_at, resolvedAt(report))))
    };
  });
};

const detectChronicIssues = (reports) => {
  const groups = {};
  for (const report of reports) {
    const key = `${report.zone_id || 'unknown'}:${normalizeCategory(report.category)}`;
    groups[key] ||= [];
    groups[key].push(report);
  }

  return Object.entries(groups)
    .filter(([, groupedReports]) => groupedReports.length >= 3)
    .map(([key, groupedReports]) => {
      const [zoneId, category] = key.split(':');
      return { zoneId, category, count: groupedReports.length, reports: groupedReports.slice(0, 10) };
    });
};

const buildSentiment = (reports, zones) => {
  const active = reports.filter(isActiveReport);
  const critical = active.filter(report => report.status === 'critical').length;
  const oldCritical = active.filter(report => {
    const created = toDate(report.created_at);
    return report.status === 'critical' && created && Date.now() - created.getTime() > 24 * MS_PER_HOUR;
  }).length;
  const categoryCounts = countBy(active, report => normalizeCategory(report.category));
  const tensionIndex = Math.round(clamp(critical * 12 + oldCritical * 10 + active.length * 1.5, 0, 100));
  const moodScore = Math.round(clamp(100 - tensionIndex * 0.7, 0, 100));
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    moodScore,
    moodBand: moodScore >= 80 ? 'campus_thriving' : moodScore >= 60 ? 'mild_concern' : moodScore >= 40 ? 'elevated_stress' : 'high_tension',
    primaryDriver: topCategories[0]?.[0] || null,
    affectedZones: buildZoneSummaries(zones, active).slice(0, 5),
    tensionIndex,
    tensionStatus: tensionIndex >= 80 ? 'critical' : tensionIndex >= 60 ? 'elevated' : 'stable',
    trendingConcerns: topCategories.map(([category, count]) => ({
      category,
      reportCount: count,
      sentiment: count >= 10 ? 'highly frustrated' : count >= 4 ? 'persistent concern' : 'emerging signal'
    })),
    resolutionSatisfaction: {
      overallRate: null,
      byCategory: {},
      disputedReports: []
    },
    generatedBy: 'derived_report_metrics'
  };
};

const buildTensionSnapshot = (reports, zones) => {
  const sentiment = buildSentiment(reports, zones);
  return {
    mood_score: sentiment.moodScore,
    tension_index: sentiment.tensionIndex,
    tension_status: sentiment.tensionStatus,
    primary_driver: sentiment.primaryDriver,
    affected_zone_ids: sentiment.affectedZones.map(zone => zone.id),
    payload: sentiment
  };
};

const buildPredictions = (reports, zones) => {
  const chronicIssues = detectChronicIssues(filterReportsByRange(reports, 'last_12_months'));
  const zoneMap = new Map((zones || []).map(zone => [String(zone.id), zone]));
  const predictions = chronicIssues.map(issue => {
    const confidence = clamp(40 + issue.count * 10, 40, 95);
    return {
      id: `${issue.zoneId}-${issue.category}`,
      zoneId: issue.zoneId,
      zoneName: zoneMap.get(String(issue.zoneId))?.name || 'Unknown zone',
      category: issue.category,
      title: `${issue.category} risk`,
      confidence,
      severity: confidence > 80 ? 'high' : confidence >= 60 ? 'likely' : 'possible',
      predictedWindow: {
        start: new Date(Date.now() + 7 * MS_PER_DAY).toISOString(),
        end: new Date(Date.now() + 30 * MS_PER_DAY).toISOString()
      },
      basis: `${issue.count} similar reports in the selected historical window`
    };
  });

  const riskMatrix = buildZoneSummaries(zones, reports).map(zone => {
    const zoneReports = reports.filter(report => String(report.zone_id) === String(zone.id));
    const categories = ['power', 'water', 'security', 'structural', 'sanitation', 'connectivity', 'environment', 'welfare'];
    const risks = {};
    for (const category of categories) {
      const count = zoneReports.filter(report => normalizeCategory(report.category) === category).length;
      risks[category] = count >= 5 ? 'high' : count >= 3 ? 'medium' : count >= 1 ? 'low' : 'none';
    }
    return { zoneId: zone.id, zoneName: zone.name, risks };
  });

  return {
    predictions,
    riskMatrix,
    budgetEvidenceAvailable: true,
    semesterBenchmark: {
      generatedBy: 'derived_report_metrics',
      metrics: []
    }
  };
};

const buildEscalationCandidates = (reports, settings = DEFAULT_ADMIN_SETTINGS, now = new Date()) => {
  return reports
    .filter(isActiveReport)
    .map(report => {
      const sla = getSlaState(report, settings, now);
      if (!sla.breached) return null;

      const ageHours = hoursBetween(report.created_at, now.toISOString()) || 0;
      const acknowledgeHours = getSlaForReport(report, settings).acknowledgeHours || 1;
      const escalationMultiple = Math.floor(ageHours / acknowledgeHours);
      const computedLevel = escalationMultiple >= 4 ? 3 : escalationMultiple >= 2 ? 2 : 1;
      const nextLevel = Math.min(3, Math.max(computedLevel, Number(report.escalation_level || 0) + 1));

      return {
        report,
        sla,
        lifecycle: normalizeLifecycle(report),
        nextLevel,
        department: getReportDepartment(report, settings)
      };
    })
    .filter(Boolean)
    .filter(candidate => candidate.nextLevel > Number(candidate.report.escalation_level || 0));
};

const buildInbox = (reports, settings, user) => {
  const role = user?.role || 'admin';
  const scopedDepartment = user?.department || role;
  const allowedDepartments = ['admin', 'super_admin'].includes(role) ? null : [scopedDepartment];

  return reports
    .filter(report => {
      const department = getReportDepartment(report, settings);
      return !allowedDepartments || allowedDepartments.includes(department);
    })
    .map(report => ({
      ...report,
      department: getReportDepartment(report, settings),
      sla: getSlaState(report, settings)
    }))
    .sort((a, b) => {
      if (a.sla.breached !== b.sla.breached) return a.sla.breached ? -1 : 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
};

const mergeAdminSettings = (value = {}) => ({
  ...DEFAULT_ADMIN_SETTINGS,
  ...value,
  sla: {
    ...DEFAULT_ADMIN_SETTINGS.sla,
    ...(value.sla || {})
  },
  notifications: {
    ...DEFAULT_ADMIN_SETTINGS.notifications,
    ...(value.notifications || {})
  },
  departments: value.departments || DEFAULT_ADMIN_SETTINGS.departments,
  broadcastTemplates: value.broadcastTemplates || DEFAULT_ADMIN_SETTINGS.broadcastTemplates
});

module.exports = {
  ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  FULL_ACCESS_ROLES,
  DEFAULT_ADMIN_SETTINGS,
  CATEGORY_DEPARTMENT_MAP,
  DEPARTMENT_CATEGORY_SCOPE,
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
  calculateCampusHealthScore,
  calculateZoneHealthScore,
  categoriesForDepartment,
  detectChronicIssues,
  enrichReportsWithZones,
  getReportDepartment,
  getSlaState,
  getSlaForReport,
  isActiveReport,
  isResolvedReport,
  mergeAdminSettings,
  normalizeLifecycle,
  redactReportIdentity,
  redactReportsForAdmin,
  zoneStatusFromScore
};
