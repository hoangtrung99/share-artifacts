// D1 persistence for review feedback.
//
// The runtime injects a Cloudflare D1 binding (`env.FEEDBACK_DB`); unit tests inject a
// node:sqlite-backed shim with the same prepare/bind/first/all/run/batch contract. The SQL lives
// in migrations/0001_feedback.sql and is executed verbatim by the test shim.
//
// Concurrency model: every mutation is one `batch()` (SQLite transaction) that appends an `events`
// row and advances `threads.last_event_id`. Status/reply writes are guarded by `threads.version`
// (optimistic CAS); a failed CAS returns { ok:false } and writes no business data. A losing CAS can
// leave a stray event row, which is harmless: the change feed is driven by `threads.last_event_id`,
// so an event the thread never points at is invisible (and the next real event moves the pointer).

import { sha256Hex } from './_feedback-revisions.js';
import { threadPermissions } from './_feedback.js';

const THREAD_STATUSES = ['open', 'addressed', 'resolved'];

function randomHex(bytes) {
  const view = new Uint8Array(bytes);
  crypto.getRandomValues(view);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

function makeId(prefix) {
  return `${prefix}_${randomHex(16)}`;
}

/** True when a D1 binding is available. Feedback routes fail safe (503) when it is not. */
export function hasFeedbackDb(env) {
  return Boolean(env?.FEEDBACK_DB);
}

function binding(env) {
  if (!env?.FEEDBACK_DB) throw new Error('FEEDBACK_DB binding is not configured');
  return env.FEEDBACK_DB;
}

/** SELECT one row (D1 `.first()`; node:sqlite shim mirrors it). */
export async function first(env, sql, params = []) {
  const statement = binding(env).prepare(sql);
  const bound = params.length ? statement.bind(...params) : statement;
  const row = await bound.first();
  return row ?? null;
}

/** SELECT all rows. */
export async function all(env, sql, params = []) {
  const statement = binding(env).prepare(sql);
  const bound = params.length ? statement.bind(...params) : statement;
  const result = await bound.all();
  return Array.isArray(result?.results) ? result.results : [];
}

/** Run one statement, returning { changes, lastRowId }. */
export async function run(env, sql, params = []) {
  const statement = binding(env).prepare(sql);
  const bound = params.length ? statement.bind(...params) : statement;
  const result = await bound.run();
  return {
    changes: Number(result?.meta?.changes ?? 0),
    lastRowId: Number(result?.meta?.last_row_id ?? 0),
  };
}

/**
 * Execute a list of statements in one transaction (D1 `batch`).
 * @param {{ FEEDBACK_DB: any }} env
 * @param {{ sql: string, params?: unknown[] }[]} statements
 */
export async function batch(env, statements) {
  const prepared = statements.map(({ sql, params = [] }) => {
    const statement = binding(env).prepare(sql);
    return params.length ? statement.bind(...params) : statement;
  });
  const results = await binding(env).batch(prepared);
  return (results || []).map((result) => ({
    changes: Number(result?.meta?.changes ?? 0),
    lastRowId: Number(result?.meta?.last_row_id ?? 0),
  }));
}

/** Current change cursor for polling (`txid`). */
export async function currentTxid(env) {
  const row = await first(env, 'SELECT IFNULL(MAX(event_id), 0) AS txid FROM events');
  return Number(row?.txid || 0);
}

/** @param {unknown} error */
export function isUniqueConstraintError(error) {
  const message = String(error && /** @type {any} */ (error).message ? /** @type {any} */ (error).message : error);
  return /unique constraint|constraint failed: unique/i.test(message);
}

// ----------------------------------------------------------------- threads ---

const THREAD_COLUMNS = `thread_id, artifact_id, project, file, revision_id, kind, status, version,
  anchor_json, replacement, addressed_revision_id, created_at, created_by_name, created_by_kind,
  updated_at, last_event_id, client_id, client_actor, payload_hash`;

/** @param {{ FEEDBACK_DB: any }} env @param {string} threadId */
export async function getThreadRow(env, threadId) {
  return first(env, `SELECT ${THREAD_COLUMNS} FROM threads WHERE thread_id = ?`, [threadId]);
}

/** @param {{ FEEDBACK_DB: any }} env @param {string} artifactId @param {string} clientId */
export async function findThreadByClientId(env, artifactId, clientId) {
  return first(env, `SELECT ${THREAD_COLUMNS} FROM threads WHERE artifact_id = ? AND client_id = ?`, [
    artifactId,
    clientId,
  ]);
}

/** @param {{ FEEDBACK_DB: any }} env @param {string} threadId */
export async function listMessages(env, threadId) {
  return all(
    env,
    `SELECT message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
            created_at, client_id, client_actor, payload_hash
       FROM messages WHERE thread_id = ? ORDER BY seq ASC`,
    [threadId],
  );
}

/** @param {{ FEEDBACK_DB: any }} env @param {string} threadId @param {string} clientId */
export async function findMessageByClientId(env, threadId, clientId) {
  return first(
    env,
    `SELECT message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
            created_at, client_actor, payload_hash
       FROM messages WHERE thread_id = ? AND client_id = ?`,
    [threadId, clientId],
  );
}

/**
 * New thread + its first message + create event, atomically.
 * @param {{ FEEDBACK_DB: any }} env
 * @param {object} input
 */
export async function insertThread(env, input) {
  const {
    threadId,
    artifactId,
    project,
    file,
    revisionId,
    kind,
    anchor,
    replacement,
    createdAt,
    author,
    clientId,
    clientActor,
    payloadHash,
    messageId,
    body,
  } = input;
  await batch(env, [
    {
      sql: `INSERT INTO threads (
              thread_id, artifact_id, project, file, revision_id, kind, status, version,
              anchor_json, replacement, addressed_revision_id, created_at, created_by_name,
              created_by_kind, updated_at, last_event_id, client_id, client_actor, payload_hash
            ) VALUES (?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      params: [
        threadId,
        artifactId,
        project,
        file,
        revisionId,
        kind,
        JSON.stringify(anchor),
        replacement,
        createdAt,
        author.name,
        author.kind,
        createdAt,
        clientId,
        clientActor,
        payloadHash,
      ],
    },
    {
      sql: `INSERT INTO events (
              artifact_id, thread_id, type, actor_kind, actor_name, created_at,
              idempotency_key, payload_hash
            ) VALUES (?, ?, 'thread.create', ?, ?, ?, ?, ?)`,
      params: [artifactId, threadId, author.kind, author.name, createdAt, clientId, payloadHash],
    },
    {
      sql: 'UPDATE threads SET last_event_id = (SELECT MAX(event_id) FROM events) WHERE thread_id = ?',
      params: [threadId],
    },
    {
      sql: `INSERT INTO messages (
              message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
              created_at, client_id, client_actor, payload_hash
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        messageId,
        threadId,
        body,
        kind,
        replacement,
        author.name,
        author.kind,
        createdAt,
        clientId,
        clientActor,
        payloadHash,
      ],
    },
  ]);
  return { threadId };
}

/**
 * Append a reply with optimistic CAS on the thread version.
 * @returns {Promise<{ ok: true } | { ok: false, conflict: true }>}
 */
export async function insertMessage(env, input) {
  const { messageId, thread, body, kind, replacement, author, createdAt, clientId, clientActor, payloadHash } = input;
  const results = await batch(env, [
    {
      // Receipt insert is guarded by the same version predicate as the CAS below, so a CAS miss
      // appends no success event at all (never a "ghost" mutation).
      sql: `INSERT INTO events (
              artifact_id, thread_id, type, actor_kind, actor_name, created_at,
              idempotency_key, payload_hash
            )
            SELECT ?, ?, 'message.create', ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM threads WHERE thread_id = ? AND version = ?)`,
      params: [
        thread.artifact_id,
        thread.thread_id,
        author.kind,
        author.name,
        createdAt,
        clientId,
        payloadHash,
        thread.thread_id,
        thread.version,
      ],
    },
    {
      sql: `INSERT INTO messages (
              message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
              created_at, client_id, client_actor, payload_hash
            )
            SELECT ?, ?,
                   (SELECT IFNULL(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?),
                   ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM threads WHERE thread_id = ? AND version = ?)`,
      params: [
        messageId,
        thread.thread_id,
        thread.thread_id,
        body,
        kind,
        replacement,
        author.name,
        author.kind,
        createdAt,
        clientId,
        clientActor,
        payloadHash,
        thread.thread_id,
        thread.version,
      ],
    },
    {
      sql: `UPDATE threads
               SET last_event_id = (SELECT MAX(event_id) FROM events),
                   updated_at = ?,
                   version = version + 1
             WHERE thread_id = ? AND version = ?`,
      params: [createdAt, thread.thread_id, thread.version],
    },
  ]);
  if (results[0]?.changes === 0 || results[1]?.changes === 0 || results[2]?.changes === 0) {
    return { ok: false, conflict: true };
  }
  return { ok: true };
}

/**
 * Change status with optimistic CAS on the thread version.
 * @returns {Promise<{ ok: true } | { ok: false, conflict: true }>}
 */
export async function updateThreadStatus(env, input) {
  const {
    thread,
    status,
    addressedRevisionId,
    actor,
    actorIdentity,
    updatedAt,
    clientId,
    clientActor,
    payloadHash,
  } = input;
  const receipt = JSON.stringify({
    before: thread.status,
    after: status,
    addressedRevisionId: addressedRevisionId ?? null,
    actor: actorIdentity || clientActor || null,
  });
  const results = await batch(env, [
    {
      // Guarded by the CAS version: zero-row updates append no receipt/event.
      sql: `INSERT INTO events (
              artifact_id, thread_id, type, actor_kind, actor_name, created_at,
              idempotency_key, payload_hash, meta_json
            )
            SELECT ?, ?, 'status.change', ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM threads WHERE thread_id = ? AND version = ?)`,
      params: [
        thread.artifact_id,
        thread.thread_id,
        actor.kind,
        actor.name,
        updatedAt,
        clientId || null,
        payloadHash || null,
        receipt,
        thread.thread_id,
        thread.version,
      ],
    },
    {
      sql: `UPDATE threads
               SET status = ?,
                   addressed_revision_id = ?,
                   last_event_id = (SELECT MAX(event_id) FROM events),
                   updated_at = ?,
                   version = version + 1
             WHERE thread_id = ? AND version = ?`,
      params: [status, addressedRevisionId, updatedAt, thread.thread_id, thread.version],
    },
  ]);
  if (results[0]?.changes === 0 || results[1]?.changes === 0) return { ok: false, conflict: true };
  return { ok: true };
}

/**
 * Keyset-paginated thread rows for one artifact.
 * @param {object} env
 * @param {{ artifactId: string, statuses?: string[], revisionId?: string|null, cursor?: number|null, limit: number }} query
 */
export async function listThreadRows(env, { artifactId, statuses = [], revisionId = null, cursor = null, limit }) {
  const clauses = ['artifact_id = ?'];
  /** @type {(string | number)[]} */
  const params = [artifactId];
  const safeStatuses = (statuses || []).filter((status) => THREAD_STATUSES.includes(status));
  if (safeStatuses.length) {
    clauses.push(`status IN (${safeStatuses.map(() => '?').join(', ')})`);
    params.push(...safeStatuses);
  }
  if (revisionId) {
    clauses.push('revision_id = ?');
    params.push(revisionId);
  }
  if (cursor) {
    clauses.push('last_event_id < ?');
    params.push(cursor);
  }
  params.push(limit);
  return all(
    env,
    `SELECT ${THREAD_COLUMNS} FROM threads
      WHERE ${clauses.join(' AND ')}
      ORDER BY last_event_id DESC
      LIMIT ?`,
    params,
  );
}

/**
 * Previous receipt for an idempotent status mutation (replay support).
 * @param {object} env
 * @param {string} threadId
 * @param {string} idempotencyKey
 */
export async function findStatusReceipt(env, threadId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return first(
    env,
    `SELECT event_id, payload_hash, meta_json FROM events
      WHERE thread_id = ? AND type = 'status.change' AND idempotency_key = ?
      ORDER BY event_id DESC LIMIT 1`,
    [threadId, idempotencyKey],
  );
}

/** Threads changed after a cursor, oldest first (polling feed). */
export async function listChangedThreadRows(env, artifactId, after, limit = 200) {
  return all(
    env,
    `SELECT ${THREAD_COLUMNS} FROM threads
      WHERE artifact_id = ? AND IFNULL(last_event_id, 0) > ?
      ORDER BY last_event_id ASC
      LIMIT ?`,
    [artifactId, after, limit],
  );
}

/** Status counts for the artifact. */
export async function countStatuses(env, artifactId) {
  const rows = await all(
    env,
    'SELECT status, COUNT(*) AS count FROM threads WHERE artifact_id = ? GROUP BY status',
    [artifactId],
  );
  const counts = { open: 0, addressed: 0, resolved: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] = Number(row.count);
  return counts;
}

// ---------------------------------------------------------------- hydrating ---

function parseAnchor(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function messageJson(row) {
  return {
    messageId: row.message_id,
    seq: Number(row.seq),
    body: row.body,
    kind: row.kind,
    replacement: row.replacement ?? null,
    author: {
      name: row.author_name,
      kind: row.author_kind,
      unverified: row.author_kind !== 'owner',
    },
    createdAt: row.created_at,
  };
}

/**
 * Convert a threads row into the public Thread JSON (including messages/replies/permissions).
 * @param {object} env
 * @param {object} row
 * @param {{ access: object, revisionNumbers?: Map<string, number> }} context
 */
export async function hydrateThread(env, row, { access, revisionNumbers = new Map() }) {
  const messageRows = await listMessages(env, row.thread_id);
  const messages = messageRows.map(messageJson);
  return {
    threadId: row.thread_id,
    artifactId: row.artifact_id,
    project: row.project,
    file: row.file,
    revisionId: row.revision_id,
    revisionNumber: revisionNumbers.get(row.revision_id) ?? null,
    kind: row.kind,
    status: row.status,
    version: Number(row.version),
    anchor: parseAnchor(row.anchor_json),
    replacement: row.replacement ?? null,
    addressedRevisionId: row.addressed_revision_id ?? null,
    author: {
      name: row.created_by_name,
      kind: row.created_by_kind,
      unverified: row.created_by_kind !== 'owner',
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
    replies: messages.slice(1),
    permissions: threadPermissions(access, { status: row.status }),
  };
}

/** Hydrate many rows in order. */
export async function hydrateThreads(env, rows, context) {
  const out = [];
  for (const row of rows) out.push(await hydrateThread(env, row, context));
  return out;
}

// ------------------------------------------------------------------ grants ---

/** @param {string} token */
export function hashGrantToken(token) {
  return sha256Hex(String(token));
}

/**
 * Create a review grant. Only the sha256 of the token is stored.
 * @param {object} env
 * @param {{ artifactId: string, project: string, file: string, scope?: string, ttlSeconds: number, createdBy: string }} input
 */
export async function insertGrant(env, input) {
  const grantId = makeId('gr');
  const secret = randomHex(32);
  const token = `${grantId}.${secret}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + input.ttlSeconds * 1000).toISOString();
  // One scope for now: `comment` means "create/reply/resolve"; addressed stays owner-only.
  const scope = 'comment';
  await run(
    env,
    `INSERT INTO grants (grant_id, artifact_id, project, file, scope, token_hash, created_at,
                         expires_at, revoked_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      grantId,
      input.artifactId,
      input.project,
      input.file,
      scope,
      await hashGrantToken(token),
      createdAt.toISOString(),
      expiresAt,
      input.createdBy,
    ],
  );
  return { grantId, token, artifactId: input.artifactId, project: input.project, file: input.file, scope, createdAt: createdAt.toISOString(), expiresAt };
}

/**
 * Verify a review-grant token for one artifact. Returns the grant row or null.
 * @param {object} env
 * @param {string} token
 * @param {string} artifactId
 */
export async function verifyGrant(env, token, artifactId) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 256) return null;
  const tokenHash = await hashGrantToken(token);
  return first(
    env,
    `SELECT grant_id, artifact_id, project, file, scope, created_at, expires_at, revoked_at
       FROM grants
      WHERE token_hash = ? AND artifact_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    [tokenHash, artifactId, new Date().toISOString()],
  );
}

/** @param {object} env @param {string} grantId */
export async function getGrantRow(env, grantId) {
  return first(
    env,
    `SELECT grant_id, artifact_id, project, file, scope, created_at, expires_at, revoked_at
       FROM grants WHERE grant_id = ?`,
    [grantId],
  );
}

/**
 * Look up a grant by its opaque token (redemption route + per-request re-check). Expiry/revocation
 * are part of the query, so a stale cookie can never outlive its grant.
 * @param {object} env
 * @param {string} token
 */
export async function findGrantByToken(env, token) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 256) return null;
  const tokenHash = await hashGrantToken(token);
  return first(
    env,
    `SELECT grant_id, artifact_id, project, file, scope, created_at, expires_at, revoked_at
       FROM grants
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    [tokenHash, new Date().toISOString()],
  );
}

/** @param {object} env @param {string} artifactId */
export async function listGrants(env, artifactId) {
  return all(
    env,
    `SELECT grant_id, artifact_id, project, file, scope, created_at, expires_at, revoked_at
       FROM grants WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 100`,
    [artifactId],
  );
}

/** Revoke one grant. Returns true when a live grant was revoked. */
export async function revokeGrant(env, grantId) {
  const result = await run(
    env,
    'UPDATE grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL',
    [new Date().toISOString(), grantId],
  );
  return result.changes > 0;
}

/** Public JSON for a grant row. */
export function grantJson(row) {
  return {
    grantId: row.grant_id,
    artifactId: row.artifact_id,
    project: row.project,
    file: row.file,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
  };
}
