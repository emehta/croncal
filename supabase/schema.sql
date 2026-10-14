-- CronCal's database.
--
-- Paste this whole file into your Supabase project's SQL Editor and press Run.
-- It is safe to run again: it only adds what is missing, and it never drops
-- anything. Todoer's schema.sql can go into the same project.

BEGIN;

-- ─── Shared with Todoer ──────────────────────────────────────────────
-- Created by whichever app is set up first, and never replaced by the other.

-- One owner per project. The server claims this row before it makes the
-- account, so two tabs can never both make one.
CREATE TABLE IF NOT EXISTS public.app_owner (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keys and settings the server keeps for the owner (a Groq key, a Google
-- client). Nothing in the browser can read this table.
CREATE TABLE IF NOT EXISTS public.app_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Which version of each app's schema this project has. Written last, inside
-- the same transaction, so a row here means everything above it ran.
CREATE TABLE IF NOT EXISTS public.schema_versions (
  app TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_owner, public.app_settings, public.schema_versions FROM anon, authenticated;
GRANT ALL ON public.app_owner, public.app_settings, public.schema_versions TO service_role;

-- ─── Events ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  -- Every write names its zone; this is only for a row that somehow does not.
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT CONSTRAINT calendar_events_recurrence_check
    CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'yearly')),
  recurrence_until TIMESTAMPTZ,
  recurrence_exceptions TEXT[] NOT NULL DEFAULT '{}',
  -- A changed day of a series points at the series and the day it replaces.
  recurrence_parent_id UUID REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  original_occurrence_start TIMESTAMPTZ,
  participants TEXT,
  conferencing TEXT,
  meeting_notes TEXT,
  location TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  importance TEXT CONSTRAINT calendar_events_importance_check
    CHECK (importance IS NULL OR importance IN ('low', 'medium', 'high')),
  event_type TEXT CONSTRAINT calendar_events_event_type_check
    CHECK (event_type IS NULL OR event_type IN ('work', 'relaxation', 'admin', 'free', 'personal')),
  google_event_id TEXT,
  sync_to_google BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx
  ON public.calendar_events (user_id, start_time);
CREATE INDEX IF NOT EXISTS calendar_events_user_end_idx
  ON public.calendar_events (user_id, end_time);
CREATE INDEX IF NOT EXISTS calendar_events_recurrence_until_idx
  ON public.calendar_events (recurrence_until);
CREATE INDEX IF NOT EXISTS calendar_events_parent_idx
  ON public.calendar_events (recurrence_parent_id);
-- One changed copy per day of a series.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_override_unique
  ON public.calendar_events (recurrence_parent_id, original_occurrence_start)
  WHERE recurrence_parent_id IS NOT NULL AND original_occurrence_start IS NOT NULL;
-- One row per Google event, per account.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_google_event_unique
  ON public.calendar_events (user_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

-- ─── Google Calendar ─────────────────────────────────────────────────
-- The owner's Google tokens. Read and written by the server alone.

CREATE TABLE IF NOT EXISTS public.google_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL CONSTRAINT google_auth_user_id_key UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  calendar_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.google_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_auth FROM anon, authenticated;
GRANT ALL ON public.google_auth TO service_role;

-- ─── Who may touch the events ────────────────────────────────────────
-- Only the owner, and only their own rows. A stranger who signs up through
-- Supabase's own API is signed in but not the owner, so they see and write
-- nothing. The owner flag is in app_metadata, which only the server can set.
-- A later version adds columns with ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
-- since CREATE TABLE IF NOT EXISTS leaves an existing table as it was.

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Created when missing, and brought up to date when present (ALTER POLICY,
-- never DROP), so running a newer schema.sql changes an older project's rule.
DO $$
DECLARE
  target TEXT;
  owner_rule CONSTANT TEXT :=
    '(SELECT auth.uid()) = user_id AND coalesce(((SELECT auth.jwt()) -> ''app_metadata'' ->> ''self_host_owner'')::boolean, false)';
BEGIN
  FOREACH target IN ARRAY ARRAY['calendar_events'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = 'Owner manages own rows'
    ) THEN
      EXECUTE format('ALTER POLICY "Owner manages own rows" ON public.%I TO authenticated USING (%s) WITH CHECK (%s)', target, owner_rule, owner_rule);
    ELSE
      EXECUTE format('CREATE POLICY "Owner manages own rows" ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', target, owner_rule, owner_rule);
    END IF;
  END LOOP;
END $$;

-- Spelled out both ways. Newer Supabase projects grant nothing on a new
-- table, while others grant every privilege, TRUNCATE included, which row
-- level security does not cover.
REVOKE ALL ON public.calendar_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;

-- ─── Done ────────────────────────────────────────────────────────────

INSERT INTO public.schema_versions (app, version)
VALUES ('croncal', 1)
ON CONFLICT (app) DO UPDATE
  SET version = GREATEST(public.schema_versions.version, EXCLUDED.version),
      applied_at = now();

COMMIT;
