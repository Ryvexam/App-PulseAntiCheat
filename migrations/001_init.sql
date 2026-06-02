CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS exam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL,
  student_name TEXT,
  exam_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  risk_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, exam_id)
);

CREATE TABLE IF NOT EXISTS exam_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 0,
  is_infraction BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_events_session_time ON exam_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_exam_events_type ON exam_events(type);
CREATE INDEX IF NOT EXISTS idx_exam_events_infraction ON exam_events(is_infraction) WHERE is_infraction;

CREATE TABLE IF NOT EXISTS screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  event_type TEXT,
  event_timestamp TIMESTAMPTZ,
  relative_ms INTEGER,
  kind TEXT NOT NULL DEFAULT 'screenshot',
  object_key TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  tab_id TEXT,
  tab_index INTEGER,
  tab_url TEXT,
  tab_title TEXT,
  tab_active BOOLEAN,
  window_id INTEGER,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screenshots_session_time ON screenshots(session_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_screenshots_event ON screenshots(session_id, event_type, event_timestamp);

CREATE TABLE IF NOT EXISTS heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  extension_active BOOLEAN,
  session_active BOOLEAN,
  fullscreen BOOLEAN,
  last_screenshot_at TIMESTAMPTZ,
  last_upload_status TEXT,
  tab_count INTEGER,
  window_count INTEGER,
  current_url TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_session_time ON heartbeats(session_id, received_at);

CREATE TABLE IF NOT EXISTS environments (
  session_id UUID PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE,
  score INTEGER,
  niveau TEXT,
  signaux JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_agent TEXT,
  reported_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
