CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  intake_hash TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('coordination','patient_safety','ccih')),
  password TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id),
  protocol TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('nonconformity','incident')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('received','in_progress','closed')),
  created_at TEXT NOT NULL,
  closure TEXT,
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id),
  UNIQUE(unit_id, request_id)
) STRICT;

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  area TEXT NOT NULL CHECK(area IN ('patient_safety','ccih')),
  assignee_id TEXT NOT NULL REFERENCES users(id),
  opinion_due TEXT NOT NULL,
  actions_due TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','pending_approval','revision','actions','pending_validation','complement','validated')),
  draft TEXT,
  UNIQUE(notification_id, area)
) STRICT;

CREATE TABLE IF NOT EXISTS opinions (
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  decision TEXT CHECK(decision IN ('approved','rejected')),
  reason TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  PRIMARY KEY(assignment_id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  description TEXT NOT NULL,
  performed_on TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES actions(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  assignment_id TEXT REFERENCES assignments(id),
  actor_id TEXT REFERENCES users(id),
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS notifications_unit_queue ON notifications(unit_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS assignments_assignee ON assignments(assignee_id, notification_id);
CREATE INDEX IF NOT EXISTS actions_assignment ON actions(assignment_id);
CREATE INDEX IF NOT EXISTS evidence_action ON evidence(action_id);
CREATE INDEX IF NOT EXISTS history_notification ON history(notification_id, id);
