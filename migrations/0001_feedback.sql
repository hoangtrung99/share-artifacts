-- D1 (SQLite) schema for artifact review feedback.
--
-- Apply once per environment (the owner creates the database; this change creates none):
--   npx wrangler d1 create artifacts-feedback
--   npx wrangler d1 migrations apply artifacts-feedback --remote
-- Local/dev: npx wrangler pages dev dist --d1=FEEDBACK_DB
-- Unit tests execute this file verbatim through a node:sqlite D1 shim
-- (test/feedback-sqlite-helper.mjs), so keep the SQL plain SQLite.
--
-- Fail-safe: when FEEDBACK_DB is not bound, every /api/feedback route returns 503 and the rest of
-- the site is unaffected.

CREATE TABLE IF NOT EXISTS threads (
  thread_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  project TEXT NOT NULL,
  file TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'replace', 'remove')),
  status TEXT NOT NULL CHECK (status IN ('open', 'addressed', 'resolved')),
  version INTEGER NOT NULL CHECK (version >= 1),
  anchor_json TEXT NOT NULL,
  replacement TEXT,
  addressed_revision_id TEXT,
  created_at TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('owner', 'reviewer', 'guest')),
  updated_at TEXT NOT NULL,
  last_event_id INTEGER,
  client_id TEXT,
  -- Server-derived idempotency scope: actor + operation + payload hash. Reusing a key with a
  -- different actor or payload is rejected (409 idempotency_conflict) instead of returning another
  -- caller's thread.
  client_actor TEXT,
  payload_hash TEXT,
  UNIQUE (artifact_id, client_id),
  CHECK (length(project) <= 64),
  CHECK (length(file) <= 200),
  CHECK (length(created_by_name) <= 80),
  CHECK (length(anchor_json) <= 16384),
  CHECK (client_id IS NULL OR length(client_id) <= 128)
);

CREATE INDEX IF NOT EXISTS threads_artifact_event
  ON threads (artifact_id, last_event_id DESC);

CREATE INDEX IF NOT EXISTS threads_artifact_status
  ON threads (artifact_id, status, last_event_id DESC);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'replace', 'remove')),
  replacement TEXT,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('owner', 'reviewer', 'guest')),
  created_at TEXT NOT NULL,
  client_id TEXT,
  client_actor TEXT,
  payload_hash TEXT,
  UNIQUE (thread_id, seq),
  UNIQUE (thread_id, client_id),
  CHECK (length(body) BETWEEN 1 AND 8000),
  CHECK (length(author_name) <= 80),
  CHECK (client_id IS NULL OR length(client_id) <= 128)
);

CREATE INDEX IF NOT EXISTS messages_thread_seq ON messages (thread_id, seq);

-- Append-only change log. event_id is the polling cursor (`txid`): clients ask for changes after
-- the last txid they saw, so equal timestamps can never hide a change.
-- Mutation receipts / audit rows. Every successful mutation appends exactly one event inside the
-- same transaction as its business write (a CAS miss appends none: the insert is guarded by the
-- same version predicate). event_id is the polling cursor (`txid`); idempotency_key + payload_hash
-- make the receipt replay-auditable.
CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES threads(thread_id),
  type TEXT NOT NULL CHECK (type IN ('thread.create', 'message.create', 'status.change')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner', 'reviewer', 'guest')),
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  meta_json TEXT,
  idempotency_key TEXT,
  payload_hash TEXT
);

CREATE INDEX IF NOT EXISTS events_artifact ON events (artifact_id, event_id);

-- Review grants: one artifact, comment scope, TTL, revocable. Only the sha256 of the token is
-- stored, so a database read cannot mint a working review link.
CREATE TABLE IF NOT EXISTS grants (
  grant_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  project TEXT NOT NULL,
  file TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('comment')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS grants_artifact ON grants (artifact_id, expires_at);
