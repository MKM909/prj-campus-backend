-- ═══════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- BASE PLATFORM TABLES
-- These make this migration runnable on a fresh Supabase project while
-- still allowing the existing custom Express auth path to work.

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'student',
  department TEXT,
  status TEXT DEFAULT 'active',
  reliability_score FLOAT DEFAULT 5.0,
  total_reports INT DEFAULT 0,
  confirmed_reports INT DEFAULT 0,
  false_reports INT DEFAULT 0,
  rank TEXT DEFAULT 'Newcomer',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Existing projects may already have a public.users table. Ensure columns exist
-- before constraints reference them.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reliability_score FLOAT DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS total_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS false_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rank TEXT DEFAULT 'Newcomer',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.users
SET role = 'student'
WHERE role IS NULL
   OR role NOT IN ('student','staff','security','admin','super_admin','dept_admin','facilities','student_affairs','it_admin');

UPDATE public.users
SET status = 'active'
WHERE status IS NULL
   OR status NOT IN ('active', 'suspended', 'deleted');

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN (
    'student',
    'staff',
    'security',
    'admin',
    'super_admin',
    'dept_admin',
    'facilities',
    'student_affairs',
    'it_admin'
  ));

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'deleted'));

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS total_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS false_reports INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TABLE IF NOT EXISTS public.zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  polygon JSONB DEFAULT '[]'::jsonb,
  color TEXT DEFAULT '#4A90D9',
  status TEXT DEFAULT 'normal',
  status_override TEXT,
  status_override_reason TEXT,
  status_overridden_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status_overridden_at TIMESTAMPTZ,
  maintenance_mode BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS polygon JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#4A90D9',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS status_override TEXT,
  ADD COLUMN IF NOT EXISTS status_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_overridden_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_overridden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS centroid_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS centroid_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.zones
SET status = 'normal'
WHERE status IS NULL
   OR status NOT IN ('normal', 'watch', 'alert', 'critical', 'maintenance', 'closed');

ALTER TABLE public.zones DROP CONSTRAINT IF EXISTS zones_status_check;
ALTER TABLE public.zones
  ADD CONSTRAINT zones_status_check
  CHECK (status IN ('normal', 'watch', 'alert', 'critical', 'maintenance', 'closed'));

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS status_override TEXT,
  ADD COLUMN IF NOT EXISTS status_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_overridden_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_overridden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS centroid_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS centroid_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_slug ON public.zones(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  zone_slug TEXT,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  osm_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buildings_zone ON public.buildings(zone_id);
CREATE INDEX IF NOT EXISTS idx_buildings_zone_slug ON public.buildings(zone_slug);

-- REPORT SYSTEM UPDATES
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create the reports table
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  zone_id UUID NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  is_anonymous BOOLEAN DEFAULT false,
  confidence_score FLOAT DEFAULT 3.0,
  reliability_score FLOAT DEFAULT 5.0,
  ai_score FLOAT DEFAULT 5.0,
  final_trust_score FLOAT DEFAULT 0.0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','community','verified','critical','resolved')),
  corroborations INT DEFAULT 0,
  disputes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_id UUID,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_score FLOAT DEFAULT 3.0,
  ADD COLUMN IF NOT EXISTS reliability_score FLOAT DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS ai_score FLOAT DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS final_trust_score FLOAT DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS corroborations INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disputes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.reports
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending','community','verified','critical','resolved');

-- 2. Create indexes for faster searching
CREATE INDEX IF NOT EXISTS idx_reports_zone ON public.reports(zone_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_status_check
  CHECK (status IN ('pending','community','verified','critical','resolved'));

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS exact_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS exact_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS specific_location TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS in_progress_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS in_progress_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_department TEXT,
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_level INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peak_status TEXT,
  ADD COLUMN IF NOT EXISTS peak_trust_score FLOAT,
  ADD COLUMN IF NOT EXISTS mesh_broadcast_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE public.reports
SET lifecycle_status = 'submitted'
WHERE lifecycle_status IS NULL
   OR lifecycle_status NOT IN ('submitted','acknowledged','in_progress','resolved');

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_lifecycle_status_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_lifecycle_status_check
  CHECK (lifecycle_status IN ('submitted','acknowledged','in_progress','resolved'));

CREATE INDEX IF NOT EXISTS idx_reports_lifecycle ON public.reports(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_department ON public.reports(assigned_department);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_specific_location ON public.reports(specific_location);

-- 3. Enable Security (RLS)
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reports: read all, insert any, update own
DROP POLICY IF EXISTS "reports_select" ON public.reports;
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
DROP POLICY IF EXISTS "reports_update" ON public.reports;
CREATE POLICY "reports_select" ON public.reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "reports_insert" ON public.reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "reports_update" ON public.reports FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_official BOOLEAN DEFAULT false,
  mentioned_departments TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_report ON public.comments(report_id);
CREATE INDEX IF NOT EXISTS idx_comments_mentions ON public.comments USING GIN(mentioned_departments);

CREATE TABLE IF NOT EXISTS public.report_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('submitted','acknowledged','in_progress','resolved')),
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  note TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_status_history_report ON public.report_status_history(report_id, created_at);

CREATE TABLE IF NOT EXISTS public.report_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE NOT NULL,
  comment_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  department TEXT NOT NULL,
  body TEXT,
  response_status TEXT DEFAULT 'unseen' CHECK (response_status IN ('unseen','seen','replied')),
  routed_at TIMESTAMPTZ DEFAULT now(),
  seen_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_mentions_department ON public.report_mentions(department, response_status);
CREATE INDEX IF NOT EXISTS idx_report_mentions_report ON public.report_mentions(report_id);

CREATE TABLE IF NOT EXISTS public.resolution_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_resolved BOOLEAN NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_feedback_report ON public.resolution_feedback(report_id);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  previous_state JSONB,
  new_state JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_resource ON public.admin_audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON public.admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.reports(id) ON DELETE CASCADE NOT NULL,
  from_level INT DEFAULT 0,
  to_level INT NOT NULL,
  department TEXT,
  reason TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_escalations_report ON public.report_escalations(report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_report_escalations_department ON public.report_escalations(department);

CREATE TABLE IF NOT EXISTS public.reliability_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_score FLOAT,
  new_score FLOAT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reliability_adjustments_user ON public.reliability_adjustments(user_id, created_at);

CREATE TABLE IF NOT EXISTS public.campus_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT NOT NULL DEFAULT 'tension',
  mood_score INT,
  tension_index INT,
  tension_status TEXT,
  primary_driver TEXT,
  affected_zone_ids UUID[] DEFAULT ARRAY[]::UUID[],
  payload JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campus_intelligence_snapshots_type_created ON public.campus_intelligence_snapshots(snapshot_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_role TEXT,
  recipient_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  resource_type TEXT,
  resource_id UUID,
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_role ON public.admin_notifications(recipient_role, read_at);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_user ON public.admin_notifications(recipient_user_id, read_at);

CREATE TABLE IF NOT EXISTS public.sos_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  exact_lat DOUBLE PRECISION,
  exact_lng DOUBLE PRECISION,
  is_anonymous BOOLEAN DEFAULT false,
  first_acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  first_acknowledged_at TIMESTAMPTZ,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','false_alarm')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sos_signals
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exact_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS exact_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.sos_signals
SET status = 'open'
WHERE status IS NULL
   OR status NOT IN ('open','acknowledged','resolved','false_alarm');

ALTER TABLE public.sos_signals DROP CONSTRAINT IF EXISTS sos_signals_status_check;
ALTER TABLE public.sos_signals
  ADD CONSTRAINT sos_signals_status_check
  CHECK (status IN ('open','acknowledged','resolved','false_alarm'));

CREATE INDEX IF NOT EXISTS idx_sos_signals_created ON public.sos_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sos_signals_status ON public.sos_signals(status);

CREATE TABLE IF NOT EXISTS public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID REFERENCES public.zones(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  reasoning TEXT,
  occurrence_count INT DEFAULT 0,
  predicted_window JSONB,
  confidence FLOAT DEFAULT 0.0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','dismissed','completed')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS zone_id UUID REFERENCES public.zones(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS reasoning TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predicted_window JSONB,
  ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.predictions
SET status = 'active'
WHERE status IS NULL
   OR status NOT IN ('active','dismissed','completed');

ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_status_check;
ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_status_check
  CHECK (status IN ('active','dismissed','completed'));

CREATE INDEX IF NOT EXISTS idx_predictions_zone ON public.predictions(zone_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON public.predictions(status);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resolution_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reliability_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_intelligence_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sos_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "zones_select" ON public.zones;
DROP POLICY IF EXISTS "buildings_select" ON public.buildings;
DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;

CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "zones_select" ON public.zones FOR SELECT TO authenticated USING (is_active = true OR is_active IS NULL);
CREATE POLICY "buildings_select" ON public.buildings FOR SELECT TO authenticated USING (true);
CREATE POLICY "reports_admin_update" ON public.reports FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')
  )
);

DROP POLICY IF EXISTS "comments_select" ON public.comments;
DROP POLICY IF EXISTS "comments_insert" ON public.comments;
DROP POLICY IF EXISTS "resolution_feedback_insert" ON public.resolution_feedback;
DROP POLICY IF EXISTS "admin_report_history_select" ON public.report_status_history;
DROP POLICY IF EXISTS "admin_mentions_select" ON public.report_mentions;
DROP POLICY IF EXISTS "admin_audit_select" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "admin_settings_select" ON public.admin_settings;
DROP POLICY IF EXISTS "admin_report_escalations_select" ON public.report_escalations;
DROP POLICY IF EXISTS "admin_reliability_adjustments_select" ON public.reliability_adjustments;
DROP POLICY IF EXISTS "admin_intelligence_snapshots_select" ON public.campus_intelligence_snapshots;
DROP POLICY IF EXISTS "admin_notifications_select" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_sos_select" ON public.sos_signals;
DROP POLICY IF EXISTS "admin_predictions_select" ON public.predictions;

CREATE POLICY "comments_select" ON public.comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON public.comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "resolution_feedback_insert" ON public.resolution_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin_report_history_select" ON public.report_status_history FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')));
CREATE POLICY "admin_mentions_select" ON public.report_mentions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')));
CREATE POLICY "admin_audit_select" ON public.admin_audit_logs FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'super_admin'));
CREATE POLICY "admin_settings_select" ON public.admin_settings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'super_admin'));
CREATE POLICY "admin_report_escalations_select" ON public.report_escalations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')));
CREATE POLICY "admin_reliability_adjustments_select" ON public.reliability_adjustments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'super_admin'));
CREATE POLICY "admin_intelligence_snapshots_select" ON public.campus_intelligence_snapshots FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin','super_admin','student_affairs')));
CREATE POLICY "admin_notifications_select" ON public.admin_notifications FOR SELECT TO authenticated
USING (
  recipient_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = recipient_role
  )
  OR EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'super_admin'
  )
);
CREATE POLICY "admin_sos_select" ON public.sos_signals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('super_admin','security')));
CREATE POLICY "admin_predictions_select" ON public.predictions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')));

-- ═══════════════════════════════════════════════════════════════════
-- MESSAGING & GROUPS
-- ═══════════════════════════════════════════════════════════════════

-- chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'group',
  name TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

UPDATE public.chats
SET type = 'group'
WHERE type IS NULL
   OR type NOT IN ('direct', 'group', 'community', 'zone', 'course');

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_type_check
  CHECK (type IN ('direct', 'group', 'community', 'zone', 'course'));

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS zone_id TEXT,
  ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS announcement_chat_id UUID,
  ADD COLUMN IF NOT EXISTS is_announcement_channel BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS community_member_visibility TEXT DEFAULT 'subgroups',
  ADD COLUMN IF NOT EXISTS community_join_policy TEXT DEFAULT 'admins',
  ADD COLUMN IF NOT EXISTS max_subgroups INT DEFAULT 50,
  ADD COLUMN IF NOT EXISTS max_announcement_members INT DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS send_policy TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS edit_info_policy TEXT DEFAULT 'admins',
  ADD COLUMN IF NOT EXISTS pin_policy TEXT DEFAULT 'admins',
  ADD COLUMN IF NOT EXISTS join_approval_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_code_revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disappearing_seconds INT,
  ADD COLUMN IF NOT EXISTS retention_days INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_message_id UUID,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_send_policy_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_send_policy_check CHECK (send_policy IN ('all', 'admins'));

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_edit_info_policy_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_edit_info_policy_check CHECK (edit_info_policy IN ('all', 'admins'));

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_pin_policy_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_pin_policy_check CHECK (pin_policy IN ('all', 'admins'));

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_community_member_visibility_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_community_member_visibility_check
  CHECK (community_member_visibility IN ('subgroups', 'community_admins'));

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_community_join_policy_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_community_join_policy_check
  CHECK (community_join_policy IN ('admins', 'open'));

-- chat_participants table
CREATE TABLE IF NOT EXISTS public.chat_participants (
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();

UPDATE public.chat_participants
SET role = 'member'
WHERE role IS NULL
   OR role NOT IN ('owner', 'admin', 'moderator', 'member');

ALTER TABLE public.chat_participants DROP CONSTRAINT IF EXISTS chat_participants_role_check;
ALTER TABLE public.chat_participants
  ADD CONSTRAINT chat_participants_role_check
  CHECK (role IN ('owner', 'admin', 'moderator', 'member'));

ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_level TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_read_message_id UUID,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.chat_participants
SET status = 'active'
WHERE status IS NULL
   OR status NOT IN ('active', 'pending', 'left', 'removed');

UPDATE public.chat_participants
SET notification_level = 'all'
WHERE notification_level IS NULL
   OR notification_level NOT IN ('all', 'mentions', 'urgent', 'none');

ALTER TABLE public.chat_participants DROP CONSTRAINT IF EXISTS chat_participants_status_check;
ALTER TABLE public.chat_participants
  ADD CONSTRAINT chat_participants_status_check
  CHECK (status IN ('active', 'pending', 'left', 'removed'));

ALTER TABLE public.chat_participants DROP CONSTRAINT IF EXISTS chat_participants_notification_level_check;
ALTER TABLE public.chat_participants
  ADD CONSTRAINT chat_participants_notification_level_check
  CHECK (notification_level IN ('all', 'mentions', 'urgent', 'none'));

-- chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.chat_messages ALTER COLUMN body DROP NOT NULL;

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reply_to_client_message_id TEXT,
  ADD COLUMN IF NOT EXISTS message_status TEXT DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS delivery_state TEXT DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_scope TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forward_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mentions UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sent_via_mesh BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppressed_for_user_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.chat_messages
SET type = 'text'
WHERE type IS NULL
   OR type NOT IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'poll', 'system', 'contact', 'location');

UPDATE public.chat_messages
SET message_status = 'sent'
WHERE message_status IS NULL
   OR message_status NOT IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed');

UPDATE public.chat_messages
SET delivery_state = 'sent'
WHERE delivery_state IS NULL
   OR delivery_state NOT IN ('queued', 'sent', 'partially_delivered', 'delivered', 'read', 'failed');

UPDATE public.chat_messages
SET delete_scope = NULL
WHERE delete_scope IS NOT NULL
  AND delete_scope NOT IN ('me', 'everyone');

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_type_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'poll', 'system', 'contact', 'location'));

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_message_status_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_message_status_check
  CHECK (message_status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed'));

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_delivery_state_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_delivery_state_check
  CHECK (delivery_state IN ('queued', 'sent', 'partially_delivered', 'delivered', 'read', 'failed'));

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_delete_scope_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_delete_scope_check
  CHECK (delete_scope IS NULL OR delete_scope IN ('me', 'everyone'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chats_last_message_id_fkey'
  ) THEN
    ALTER TABLE public.chats
      ADD CONSTRAINT chats_last_message_id_fkey
      FOREIGN KEY (last_message_id)
      REFERENCES public.chat_messages(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chats_announcement_chat_id_fkey'
  ) THEN
    ALTER TABLE public.chats
      ADD CONSTRAINT chats_announcement_chat_id_fkey
      FOREIGN KEY (announcement_chat_id)
      REFERENCES public.chats(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- chat_read_receipts table
CREATE TABLE IF NOT EXISTS public.chat_read_receipts (
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.chat_read_receipts
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS played_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Media hash registry for dedupe and upload resume metadata.
CREATE TABLE IF NOT EXISTS public.chat_media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash TEXT UNIQUE,
  encrypted_hash TEXT,
  cdn_url TEXT,
  thumbnail_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  upload_status TEXT DEFAULT 'pending',
  upload_session_id TEXT,
  upload_progress NUMERIC DEFAULT 0,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.chat_media_files
  ADD COLUMN IF NOT EXISTS upload_status TEXT DEFAULT 'pending';

UPDATE public.chat_media_files
SET upload_status = 'pending'
WHERE upload_status IS NULL
   OR upload_status NOT IN ('pending', 'uploading', 'completed', 'failed');

ALTER TABLE public.chat_media_files DROP CONSTRAINT IF EXISTS chat_media_files_upload_status_check;
ALTER TABLE public.chat_media_files
  ADD CONSTRAINT chat_media_files_upload_status_check
  CHECK (upload_status IN ('pending', 'uploading', 'completed', 'failed'));

CREATE TABLE IF NOT EXISTS public.chat_message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  media_id UUID REFERENCES public.chat_media_files(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'document',
  cdn_url TEXT,
  thumbnail_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  file_size_label TEXT,
  mime_type TEXT,
  file_hash TEXT,
  encrypted_hash TEXT,
  upload_session_id TEXT,
  upload_status TEXT DEFAULT 'completed',
  duration_ms INT,
  duration_label TEXT,
  width INT,
  height INT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_message_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  editor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_body TEXT,
  new_body TEXT,
  edited_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_message_deletions (
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_message_stars (
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.chat_message_pins (
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  pinned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  unpinned_at TIMESTAMPTZ,
  unpinned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS public.chat_join_requests (
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE public.chat_join_requests
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.chat_join_requests
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'approved', 'rejected');

ALTER TABLE public.chat_join_requests DROP CONSTRAINT IF EXISTS chat_join_requests_status_check;
ALTER TABLE public.chat_join_requests
  ADD CONSTRAINT chat_join_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_chats_last_message_at ON public.chats(last_message_at);
CREATE INDEX IF NOT EXISTS idx_chats_invite_code ON public.chats(invite_code);
CREATE INDEX IF NOT EXISTS idx_chats_community ON public.chats(community_id);
CREATE INDEX IF NOT EXISTS idx_chats_announcement_channel ON public.chats(community_id, is_announcement_channel);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON public.chat_participants(user_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created ON public.chat_messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_created ON public.chat_messages(sender_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_sender_client
  ON public.chat_messages(sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_read_receipts_user ON public.chat_read_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_media_files_hash ON public.chat_media_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON public.chat_message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON public.chat_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks(blocked_id);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) FOR MESSAGING
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_select" ON public.chats;
DROP POLICY IF EXISTS "chats_insert" ON public.chats;
DROP POLICY IF EXISTS "chat_participants_select" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_insert" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_messages_insert" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_receipts_select" ON public.chat_read_receipts;
DROP POLICY IF EXISTS "chat_receipts_insert" ON public.chat_read_receipts;
DROP POLICY IF EXISTS "chat_receipts_update" ON public.chat_read_receipts;
DROP POLICY IF EXISTS "chat_media_files_select" ON public.chat_media_files;
DROP POLICY IF EXISTS "chat_media_files_insert" ON public.chat_media_files;
DROP POLICY IF EXISTS "chat_media_files_update" ON public.chat_media_files;
DROP POLICY IF EXISTS "chat_attachments_select" ON public.chat_message_attachments;
DROP POLICY IF EXISTS "chat_reactions_select" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "chat_reactions_insert" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "chat_reactions_update" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "chat_reactions_delete" ON public.chat_message_reactions;
DROP POLICY IF EXISTS "chat_user_private_select" ON public.chat_message_deletions;
DROP POLICY IF EXISTS "chat_user_private_insert" ON public.chat_message_deletions;
DROP POLICY IF EXISTS "chat_stars_select" ON public.chat_message_stars;
DROP POLICY IF EXISTS "chat_stars_insert" ON public.chat_message_stars;
DROP POLICY IF EXISTS "chat_stars_delete" ON public.chat_message_stars;
DROP POLICY IF EXISTS "chat_pins_select" ON public.chat_message_pins;
DROP POLICY IF EXISTS "chat_join_requests_select" ON public.chat_join_requests;
DROP POLICY IF EXISTS "chat_join_requests_insert" ON public.chat_join_requests;
DROP POLICY IF EXISTS "user_blocks_select" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_insert" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_delete" ON public.user_blocks;

-- Chats: users can read chats they are a participant in
CREATE POLICY "chats_select" ON public.chats 
FOR SELECT TO authenticated 
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chats.id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chats_insert" ON public.chats 
FOR INSERT TO authenticated 
WITH CHECK (true);

-- Chat Participants: users can read participants of chats they are in
CREATE POLICY "chat_participants_select" ON public.chat_participants 
FOR SELECT TO authenticated 
USING (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chat_participants.chat_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_participants_insert" ON public.chat_participants 
FOR INSERT TO authenticated 
WITH CHECK (true); -- Application logic should enforce admin checks

-- Chat Messages: users can read messages in chats they are in
CREATE POLICY "chat_messages_select" ON public.chat_messages 
FOR SELECT TO authenticated 
USING (
  auth.uid() IS NOT NULL
  AND NOT (
    auth.uid() = ANY(
      COALESCE(public.chat_messages.suppressed_for_user_ids, ARRAY[]::uuid[])
    )
  )
  AND EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chat_messages.chat_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_messages_insert" ON public.chat_messages 
FOR INSERT TO authenticated 
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chat_messages.chat_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

-- Read Receipts: users can read receipts for messages in their chats
CREATE POLICY "chat_receipts_select" ON public.chat_read_receipts 
FOR SELECT TO authenticated 
USING (EXISTS (
  SELECT 1 FROM public.chat_messages cm
  JOIN public.chat_participants cp ON cm.chat_id = cp.chat_id
  WHERE cm.id = public.chat_read_receipts.message_id
  AND cp.user_id = auth.uid()
  AND cp.status = 'active'
));

CREATE POLICY "chat_receipts_insert" ON public.chat_read_receipts 
FOR INSERT TO authenticated 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_receipts_update" ON public.chat_read_receipts
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_media_files_select" ON public.chat_media_files
FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE POLICY "chat_media_files_insert" ON public.chat_media_files
FOR INSERT TO authenticated
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "chat_media_files_update" ON public.chat_media_files
FOR UPDATE TO authenticated
USING (uploaded_by = auth.uid())
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "chat_attachments_select" ON public.chat_message_attachments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.chat_messages cm
    JOIN public.chat_participants cp ON cp.chat_id = cm.chat_id
    WHERE cm.id = public.chat_message_attachments.message_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_reactions_select" ON public.chat_message_reactions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.chat_messages cm
    JOIN public.chat_participants cp ON cp.chat_id = cm.chat_id
    WHERE cm.id = public.chat_message_reactions.message_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_reactions_insert" ON public.chat_message_reactions
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_reactions_update" ON public.chat_message_reactions
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_reactions_delete" ON public.chat_message_reactions
FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "chat_user_private_select" ON public.chat_message_deletions
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "chat_user_private_insert" ON public.chat_message_deletions
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_stars_select" ON public.chat_message_stars
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "chat_stars_insert" ON public.chat_message_stars
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat_stars_delete" ON public.chat_message_stars
FOR DELETE TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "chat_pins_select" ON public.chat_message_pins
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chat_message_pins.chat_id
    AND cp.user_id = auth.uid()
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_join_requests_select" ON public.chat_join_requests
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = public.chat_join_requests.chat_id
    AND cp.user_id = auth.uid()
    AND cp.role IN ('owner', 'admin', 'moderator')
    AND cp.status = 'active'
  )
);

CREATE POLICY "chat_join_requests_insert" ON public.chat_join_requests
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR requested_by = auth.uid());

CREATE POLICY "user_blocks_select" ON public.user_blocks
FOR SELECT TO authenticated
USING (blocker_id = auth.uid());

CREATE POLICY "user_blocks_insert" ON public.user_blocks
FOR INSERT TO authenticated
WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "user_blocks_delete" ON public.user_blocks
FOR DELETE TO authenticated
USING (blocker_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- REALTIME
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  realtime_table TEXT;
BEGIN
  FOREACH realtime_table IN ARRAY ARRAY[
    'chats',
    'chat_participants',
    'chat_messages',
    'chat_read_receipts',
    'chat_message_attachments',
    'chat_message_reactions',
    'chat_message_pins',
    'chat_join_requests'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = realtime_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', realtime_table);
    END IF;
  END LOOP;
END $$;

-- ADMIN ANNOUNCEMENTS

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  audience_role TEXT DEFAULT 'all' CHECK (audience_role IN ('all', 'student', 'staff', 'security', 'admin')),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS audience_role TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.announcements
SET priority = 'normal'
WHERE priority IS NULL
   OR priority NOT IN ('normal', 'important', 'urgent', 'critical');

UPDATE public.announcements
SET audience_role = 'all'
WHERE audience_role IS NULL
   OR audience_role NOT IN ('all','student','staff','security','admin','super_admin','dept_admin','facilities','student_affairs','it_admin');

CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON public.announcements(created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_audience ON public.announcements(audience_role);

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_priority_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_priority_check
  CHECK (priority IN ('normal', 'important', 'urgent', 'critical'));

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_audience_role_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_audience_role_check
  CHECK (audience_role IN ('all','student','staff','security','admin','super_admin','dept_admin','facilities','student_affairs','it_admin'));

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS broadcast_category TEXT DEFAULT 'official_update',
  ADD COLUMN IF NOT EXISTS target_zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reach_online INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_mesh INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_announcements_target_zone ON public.announcements(target_zone_id);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled_for ON public.announcements(scheduled_for);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select" ON public.announcements;
DROP POLICY IF EXISTS "announcements_insert_admin" ON public.announcements;

CREATE POLICY "announcements_select" ON public.announcements
FOR SELECT TO authenticated
USING (
  is_active = true
  AND (expires_at IS NULL OR expires_at > now())
);

CREATE POLICY "announcements_insert_admin" ON public.announcements
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin','super_admin','dept_admin','facilities','security','student_affairs','it_admin')
  )
);

INSERT INTO public.admin_settings (key, value)
VALUES (
  'platform',
  '{
    "sla": {
      "power": { "acknowledgeHours": 4, "resolveHours": 48 },
      "water": { "acknowledgeHours": 8, "resolveHours": 72 },
      "security": { "acknowledgeHours": 1, "resolveHours": 24 },
      "sanitation": { "acknowledgeHours": 24, "resolveHours": 96 },
      "structural": { "acknowledgeHours": 48, "resolveHours": 168 },
      "connectivity": { "acknowledgeHours": 4, "resolveHours": 48 },
      "environment": { "acknowledgeHours": 2, "resolveHours": 24 },
      "welfare": { "acknowledgeHours": 8, "resolveHours": 72 }
    },
    "departments": [
      { "id": "facilities", "name": "Facilities Dept", "categories": ["power", "water", "sanitation", "structural"], "escalationEmail": null },
      { "id": "security", "name": "Security Dept", "categories": ["security"], "escalationEmail": null },
      { "id": "it_admin", "name": "IT Department", "categories": ["connectivity"], "escalationEmail": null },
      { "id": "student_affairs", "name": "Student Affairs", "categories": ["environment", "welfare"], "escalationEmail": null }
    ],
    "notifications": {
      "criticalReports": { "enabled": true, "roles": ["super_admin", "security", "facilities"] },
      "slaBreaches": { "enabled": true, "roles": ["super_admin", "dept_admin"] },
      "tensionIndex": { "enabled": true, "threshold": 60, "roles": ["super_admin"] },
      "mentions": { "enabled": true },
      "dailyHealthSummary": { "enabled": false, "time": "08:00", "roles": ["super_admin"] }
    }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  realtime_table TEXT;
BEGIN
  FOREACH realtime_table IN ARRAY ARRAY[
    'reports',
    'comments',
    'report_status_history',
    'report_mentions',
    'report_escalations',
    'resolution_feedback',
    'reliability_adjustments',
    'campus_intelligence_snapshots',
    'admin_notifications',
    'admin_audit_logs',
    'announcements',
    'sos_signals',
    'predictions',
    'zones'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = realtime_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', realtime_table);
    END IF;
  END LOOP;
END $$;
