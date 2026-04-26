-- ═══════════════════════════════════════════════════════════════════
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

-- 2. Create indexes for faster searching
CREATE INDEX IF NOT EXISTS idx_reports_zone ON public.reports(zone_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);

-- 3. Enable Security (RLS)
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reports: read all, insert any, update own
CREATE POLICY "reports_select" ON public.reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "reports_insert" ON public.reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "reports_update" ON public.reports FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- MESSAGING & GROUPS
-- ═══════════════════════════════════════════════════════════════════

-- chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name TEXT, -- Optional, used for groups
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- chat_participants table
CREATE TABLE IF NOT EXISTS public.chat_participants (
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- chat_messages table
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- chat_read_receipts table
CREATE TABLE IF NOT EXISTS public.chat_read_receipts (
  message_id UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) FOR MESSAGING
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_read_receipts ENABLE ROW LEVEL SECURITY;

-- Chats: users can read chats they are a participant in
CREATE POLICY "chats_select" ON public.chats 
FOR SELECT TO authenticated 
USING (EXISTS (SELECT 1 FROM public.chat_participants WHERE chat_id = id AND user_id = auth.uid()));

CREATE POLICY "chats_insert" ON public.chats 
FOR INSERT TO authenticated 
WITH CHECK (true);

-- Chat Participants: users can read participants of chats they are in
CREATE POLICY "chat_participants_select" ON public.chat_participants 
FOR SELECT TO authenticated 
USING (EXISTS (SELECT 1 FROM public.chat_participants cp WHERE cp.chat_id = chat_id AND cp.user_id = auth.uid()));

CREATE POLICY "chat_participants_insert" ON public.chat_participants 
FOR INSERT TO authenticated 
WITH CHECK (true); -- Application logic should enforce admin checks

-- Chat Messages: users can read messages in chats they are in
CREATE POLICY "chat_messages_select" ON public.chat_messages 
FOR SELECT TO authenticated 
USING (EXISTS (SELECT 1 FROM public.chat_participants WHERE chat_id = public.chat_messages.chat_id AND user_id = auth.uid()));

CREATE POLICY "chat_messages_insert" ON public.chat_messages 
FOR INSERT TO authenticated 
WITH CHECK (EXISTS (SELECT 1 FROM public.chat_participants WHERE chat_id = public.chat_messages.chat_id AND user_id = auth.uid()));

-- Read Receipts: users can read receipts for messages in their chats
CREATE POLICY "chat_receipts_select" ON public.chat_read_receipts 
FOR SELECT TO authenticated 
USING (EXISTS (
  SELECT 1 FROM public.chat_messages cm
  JOIN public.chat_participants cp ON cm.chat_id = cp.chat_id
  WHERE cm.id = message_id AND cp.user_id = auth.uid()
));

CREATE POLICY "chat_receipts_insert" ON public.chat_read_receipts 
FOR INSERT TO authenticated 
WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- REALTIME
-- ═══════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
