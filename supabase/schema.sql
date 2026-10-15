-- CronCal's database.
--
-- Paste this whole file into your Supabase project's SQL Editor and press Run.
-- It is safe to run again: it only adds what is missing, and it never drops
-- anything. Todoer's schema.sql can go into the same project.

BEGIN;

-- Stops here, changing nothing, when the project already has a table by one
-- of CronCal's names that CronCal didn't make: the rules below would
-- otherwise go onto another app's table. Every CronCal schema has written its
-- row in schema_versions in the same transaction as its tables.
DO $$
DECLARE
  recorded BOOLEAN := false;
BEGIN
  IF to_regclass('public.calendar_events') IS NULL AND to_regclass('public.google_auth') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.schema_versions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.schema_versions WHERE app = $1)' INTO recorded USING 'croncal';
  END IF;
  IF NOT recorded THEN
    RAISE EXCEPTION 'This project already has a calendar_events or google_auth table that CronCal did not make. Use a new Supabase project for CronCal.';
  END IF;
END $$;

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

-- ─── Changing a repeating event ──────────────────────────────────────
-- A change to a series touches the series and its changed days together.
-- Each kind of change is one function, so it happens whole or not at all: a
-- failure part way cannot leave a day skipped with nothing in its place, or
-- a series cut short with nothing after it. The app works out the new times
-- and sends them; these only write them. They run as the signed-in owner
-- (SECURITY INVOKER), under the row rules above, with nothing found on a
-- search path. Sent again, the same change changes nothing more, so a save
-- whose answer was lost can be retried.

-- One day of a series changed on its own: skipped in the series, and a
-- changed copy at its place, made or updated.
CREATE OR REPLACE FUNCTION public.croncal_change_day(p_series UUID, p_place TEXT, p_fields JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  series public.calendar_events;
  changed public.calendar_events;
BEGIN
  SELECT * INTO series FROM public.calendar_events WHERE id = p_series FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event is no longer there. Reload and try again.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.calendar_events
     SET recurrence_exceptions = recurrence_exceptions || p_place
   WHERE id = p_series
     AND NOT EXISTS (SELECT 1 FROM unnest(recurrence_exceptions) AS skipped WHERE skipped::timestamptz = p_place::timestamptz);

  changed := jsonb_populate_record(series, p_fields);
  INSERT INTO public.calendar_events (
    title, description, start_time, end_time, all_day, timezone, participants, conferencing, meeting_notes,
    location, color, importance, event_type, recurrence, recurrence_until, recurrence_exceptions,
    recurrence_parent_id, original_occurrence_start, google_event_id, sync_to_google
  ) VALUES (
    changed.title, changed.description, changed.start_time, changed.end_time, changed.all_day, changed.timezone,
    changed.participants, changed.conferencing, changed.meeting_notes, changed.location, changed.color,
    changed.importance, changed.event_type, NULL, NULL, '{}', p_series, p_place::timestamptz, NULL, false
  )
  ON CONFLICT (recurrence_parent_id, original_occurrence_start)
    WHERE recurrence_parent_id IS NOT NULL AND original_occurrence_start IS NOT NULL
  DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time, all_day = EXCLUDED.all_day, timezone = EXCLUDED.timezone,
    participants = EXCLUDED.participants, conferencing = EXCLUDED.conferencing,
    meeting_notes = EXCLUDED.meeting_notes, location = EXCLUDED.location, color = EXCLUDED.color,
    importance = EXCLUDED.importance, event_type = EXCLUDED.event_type;
END;
$fn$;

-- One day of a series deleted: skipped, and its changed copy, if any, gone.
CREATE OR REPLACE FUNCTION public.croncal_delete_day(p_series UUID, p_place TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.calendar_events
     SET recurrence_exceptions = recurrence_exceptions || p_place
   WHERE id = p_series
     AND NOT EXISTS (SELECT 1 FROM unnest(recurrence_exceptions) AS skipped WHERE skipped::timestamptz = p_place::timestamptz);
  DELETE FROM public.calendar_events
   WHERE recurrence_parent_id = p_series AND original_occurrence_start = p_place::timestamptz;
END;
$fn$;

-- An event and its changed days. Answers how many events went: none when it
-- was already gone.
CREATE OR REPLACE FUNCTION public.croncal_delete_event(p_event UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.calendar_events WHERE recurrence_parent_id = p_event;
  DELETE FROM public.calendar_events WHERE id = p_event;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$fn$;

-- A series ended before `p_pivot`, its skipped and changed days from there
-- going with it; from its first day, the whole series.
CREATE OR REPLACE FUNCTION public.croncal_delete_following(p_series UUID, p_pivot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  series public.calendar_events;
  pivot TIMESTAMPTZ := p_pivot::timestamptz;
BEGIN
  SELECT * INTO series FROM public.calendar_events WHERE id = p_series FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF pivot <= series.start_time THEN
    DELETE FROM public.calendar_events WHERE recurrence_parent_id = p_series;
    DELETE FROM public.calendar_events WHERE id = p_series;
    RETURN;
  END IF;
  UPDATE public.calendar_events
     SET recurrence_until = LEAST(COALESCE(recurrence_until, pivot), pivot),
         recurrence_exceptions = ARRAY(
           SELECT skipped FROM unnest(recurrence_exceptions) WITH ORDINALITY AS listed(skipped, n)
            WHERE skipped::timestamptz < pivot ORDER BY n)
   WHERE id = p_series;
  DELETE FROM public.calendar_events
   WHERE recurrence_parent_id = p_series AND original_occurrence_start >= pivot;
END;
$fn$;

-- A series changed for all its days: `p_fields` on the series, and each of
-- `p_days` ({ id, fields }) on one of its changed days. With `p_drop_days`
-- the changed days go instead (the series no longer repeats).
CREATE OR REPLACE FUNCTION public.croncal_change_series(p_series UUID, p_fields JSONB, p_days JSONB, p_drop_days BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  series public.calendar_events;
  changed public.calendar_events;
  day JSONB;
BEGIN
  SELECT * INTO series FROM public.calendar_events WHERE id = p_series FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That event is no longer there. Reload and try again.' USING ERRCODE = 'P0002';
  END IF;
  IF p_drop_days THEN
    DELETE FROM public.calendar_events WHERE recurrence_parent_id = p_series;
  END IF;

  series := jsonb_populate_record(series, p_fields);
  UPDATE public.calendar_events SET
    title = series.title, description = series.description, start_time = series.start_time,
    end_time = series.end_time, all_day = series.all_day, timezone = series.timezone,
    recurrence = series.recurrence, recurrence_until = series.recurrence_until,
    recurrence_exceptions = series.recurrence_exceptions, participants = series.participants,
    conferencing = series.conferencing, meeting_notes = series.meeting_notes, location = series.location,
    color = series.color, importance = series.importance, event_type = series.event_type
  WHERE id = p_series;

  -- Moved days leave their places first, so two can trade places without the
  -- one-copy-per-place index refusing the first of them.
  UPDATE public.calendar_events SET original_occurrence_start = NULL
   WHERE recurrence_parent_id = p_series
     AND id IN (SELECT (moved ->> 'id')::uuid FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) AS moved
                 WHERE moved -> 'fields' ? 'original_occurrence_start');
  FOR day IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) LOOP
    SELECT * INTO changed FROM public.calendar_events
     WHERE id = (day ->> 'id')::uuid AND recurrence_parent_id = p_series FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    changed := jsonb_populate_record(changed, day -> 'fields');
    UPDATE public.calendar_events SET
      title = changed.title, description = changed.description, start_time = changed.start_time,
      end_time = changed.end_time, all_day = changed.all_day, timezone = changed.timezone,
      original_occurrence_start = changed.original_occurrence_start, participants = changed.participants,
      conferencing = changed.conferencing, location = changed.location, color = changed.color,
      importance = changed.importance, event_type = changed.event_type
    WHERE id = changed.id;
  END LOOP;
END;
$fn$;

-- A series changed from `p_pivot` on: a new series, `p_new` over the old
-- one's fields with an id the app chose, takes the day and the days after
-- it, and `p_days` ({ id, fields }) of the changed days from there go to it.
-- Any other changed day from there goes. The old series ends the day before,
-- or, split at its first day, is replaced.
CREATE OR REPLACE FUNCTION public.croncal_split_series(p_series UUID, p_pivot TEXT, p_new JSONB, p_days JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  series public.calendar_events;
  next_series public.calendar_events;
  changed public.calendar_events;
  day JSONB;
  pivot TIMESTAMPTZ := p_pivot::timestamptz;
BEGIN
  IF (p_new ->> 'id') IS NULL OR (p_new ->> 'id')::uuid = p_series THEN
    RAISE EXCEPTION 'The new series needs an id of its own.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO series FROM public.calendar_events WHERE id = p_series FOR UPDATE;
  IF NOT FOUND THEN
    -- Split at its first day by an earlier try, which made the new series.
    IF EXISTS (SELECT 1 FROM public.calendar_events WHERE id = (p_new ->> 'id')::uuid) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'That event is no longer there. Reload and try again.' USING ERRCODE = 'P0002';
  END IF;

  next_series := jsonb_populate_record(series, p_new);
  INSERT INTO public.calendar_events (
    id, title, description, start_time, end_time, all_day, timezone, recurrence, recurrence_until,
    recurrence_exceptions, participants, conferencing, meeting_notes, location, color, importance,
    event_type, recurrence_parent_id, original_occurrence_start, google_event_id, sync_to_google
  ) VALUES (
    next_series.id, next_series.title, next_series.description, next_series.start_time, next_series.end_time,
    next_series.all_day, next_series.timezone, next_series.recurrence, next_series.recurrence_until,
    next_series.recurrence_exceptions, next_series.participants, next_series.conferencing,
    next_series.meeting_notes, next_series.location, next_series.color, next_series.importance,
    next_series.event_type, NULL, NULL, NULL, false
  )
  ON CONFLICT (id) DO NOTHING;

  FOR day IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) LOOP
    SELECT * INTO changed FROM public.calendar_events
     WHERE id = (day ->> 'id')::uuid AND recurrence_parent_id = p_series FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    changed := jsonb_populate_record(changed, day -> 'fields');
    UPDATE public.calendar_events SET
      recurrence_parent_id = next_series.id, original_occurrence_start = changed.original_occurrence_start,
      title = changed.title, description = changed.description, start_time = changed.start_time,
      end_time = changed.end_time, all_day = changed.all_day, timezone = changed.timezone,
      participants = changed.participants, conferencing = changed.conferencing, location = changed.location,
      color = changed.color, importance = changed.importance, event_type = changed.event_type
    WHERE id = changed.id;
  END LOOP;

  DELETE FROM public.calendar_events
   WHERE recurrence_parent_id = p_series AND original_occurrence_start >= pivot;
  IF pivot <= series.start_time THEN
    DELETE FROM public.calendar_events WHERE recurrence_parent_id = p_series;
    DELETE FROM public.calendar_events WHERE id = p_series;
  ELSE
    UPDATE public.calendar_events
       SET recurrence_until = LEAST(COALESCE(recurrence_until, pivot), pivot),
           recurrence_exceptions = ARRAY(
             SELECT skipped FROM unnest(recurrence_exceptions) WITH ORDINALITY AS listed(skipped, n)
              WHERE skipped::timestamptz < pivot ORDER BY n)
     WHERE id = p_series;
  END IF;
END;
$fn$;

-- Nobody but the signed-in owner can call them, and the row rules decide
-- what each call reaches.
REVOKE ALL ON FUNCTION
  public.croncal_change_day(UUID, TEXT, JSONB),
  public.croncal_delete_day(UUID, TEXT),
  public.croncal_delete_event(UUID),
  public.croncal_delete_following(UUID, TEXT),
  public.croncal_change_series(UUID, JSONB, JSONB, BOOLEAN),
  public.croncal_split_series(UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.croncal_change_day(UUID, TEXT, JSONB),
  public.croncal_delete_day(UUID, TEXT),
  public.croncal_delete_event(UUID),
  public.croncal_delete_following(UUID, TEXT),
  public.croncal_change_series(UUID, JSONB, JSONB, BOOLEAN),
  public.croncal_split_series(UUID, TEXT, JSONB, JSONB)
  TO authenticated;

-- ─── Done ────────────────────────────────────────────────────────────

INSERT INTO public.schema_versions (app, version)
VALUES ('croncal', 2)
ON CONFLICT (app) DO UPDATE
  SET version = GREATEST(public.schema_versions.version, EXCLUDED.version),
      applied_at = now();

COMMIT;
