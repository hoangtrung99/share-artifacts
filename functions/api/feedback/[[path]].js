// /api/feedback — review threads over an immutable artifact revision.
//
// Routes (JSON; all mutations are same-origin + application/json):
//   GET    /api/feedback                        list threads (+ counts/permissions)
//   POST   /api/feedback                        create thread (+ first message)
//   GET    /api/feedback/<threadId>             one thread
//   POST   /api/feedback/<threadId>/replies     reply
//   PATCH  /api/feedback/<threadId>             status transition (CAS via expectedVersion)
//   GET    /api/feedback/export?format=json|md  work-queue export (default open+addressed)
//   GET|POST /api/feedback/grants               admin-only review grants
//   DELETE /api/feedback/grants/<grantId>       revoke a grant (admin only)
//
// Access (see _feedback-access.js): OPEN feedback by default — any viewer who can read the artifact
// can read/write feedback (anonymous viewers of public artifacts included); protected/ghost projects
// still require their project/ghost cookie. The site owner (FEEDBACK_ADMIN_TOKEN) keeps exclusive
// powers (mark addressed, manage grants). Review-grant cookies remain supported but optional.
// Set FEEDBACK_REQUIRE_GRANT=1|true to restore the old grant-required/read-only-project policy.
// Anonymous authors are kind `guest` (unverified) and are rate-limited/idempotency-scoped per
// client IP (`guest:<CF-Connecting-IP>`), never in one shared bucket.
// Fail-safe: unbound FEEDBACK_DB → 503 feedback_not_configured.
//
// Scope (MVP): text-selection threads and whole-document comments bound to an immutable revision.
// No change feed (the UI polls the list), no element pinpointing, comments are plain text.

import { safeDecode } from '../../_store.js';
import {
  ApiError,
  adminAuthorized,
  basePermissions,
  currentRevision,
  errorResponse,
  formatFeedbackJson,
  formatFeedbackMarkdown,
  json,
  normalizeAuthorName,
  normalizeCreateBody,
  normalizeReplyBody,
  normalizeStatusPatch,
  rateLimit,
  readJsonBody,
  requireSameOrigin,
  resolveArtifact,
  resolveRevisionForArtifact,
  reviewUrlFor,
  revisionNumbers,
} from '../../_feedback.js';
import { resolveFeedbackAccess } from '../../_feedback-access.js';
import {
  MAX_MESSAGES_PER_ARTIFACT,
  MAX_MESSAGES_PER_THREAD,
  countArtifactMessages,
  countStatuses,
  currentTxid,
  messageCapacityExceeded,
  findMessageByClientId,
  findStatusReceipt,
  findThreadByClientId,
  getGrantRow,
  getThreadRow,
  grantJson,
  hasFeedbackDb,
  hydrateThread,
  hydrateThreads,
  insertGrant,
  insertMessage,
  insertThread,
  isUniqueConstraintError,
  listGrants,
  listThreadRows,
  revokeGrant,
  updateThreadStatus,
} from '../../_feedback-db.js';
import { sha256Hex } from '../../_feedback-revisions.js';

const READ_LIMIT = 120;
const WRITE_LIMIT = 30;
const MAX_THREADS = 500;
const TRANSITIONS = {
  // Addressed must be declared by the owner first (fixing revision recorded), then the reviewer
  // verifies and resolves. An open thread can never jump straight to resolved.
  open: new Set(['addressed']),
  addressed: new Set(['resolved']),
  resolved: new Set(['open']),
};

function randomHex(bytes) {
  const view = new Uint8Array(bytes);
  crypto.getRandomValues(view);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

function newId(prefix) {
  return `${prefix}_${randomHex(16)}`;
}

function pathSegments(params) {
  const raw = params?.path;
  const path = Array.isArray(raw) ? raw.join('/') : raw == null ? '' : String(raw);
  return path.split('/').filter(Boolean).map(safeDecode);
}

/** @param {object} artifact */
function artifactJson(artifact) {
  return {
    artifactId: artifact.artifactId,
    project: artifact.project,
    file: artifact.file,
    routePath: artifact.routePath,
    type: artifact.type,
    revisioningEnabled: Boolean(artifact.registry),
  };
}

/** Server-derived idempotency scope: actor + operation + payload hash. */
async function payloadHash(parts) {
  return sha256Hex(JSON.stringify(parts));
}

/**
 * Per-client IP. Only Cloudflare's `CF-Connecting-IP` is trusted (production always sets it); a
 * missing header maps to the shared `unknown` bucket. `X-Forwarded-For` is deliberately ignored:
 * it is client-controlled and must never be able to mint a fresh rate-limit/idempotency identity.
 */
function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip');
  return cf && cf.trim() ? cf.trim() : 'unknown';
}

/**
 * Server-derived idempotency/rate-limit identity. Anonymous open-mode writers are keyed per client
 * IP so one visitor cannot exhaust every anonymous bucket; project/ghost sessions share a stable
 * key; grant/admin keep their own identities.
 */
function actorIdentity(access, grant, request) {
  if (access.admin) return 'admin';
  if (grant) return `grant:${grant.grant_id}`;
  if (access.authenticated) return 'project';
  return `guest:${clientIp(request)}`;
}

/**
 * Rate-limit identity: unlike the idempotency actor, gate-cookie (project/ghost) sessions are keyed
 * per client IP (`project:<ip>`) so one IP exhausting its bucket cannot 429 another IP sharing the
 * same project cookie. Grant/admin buckets stay stable.
 */
function rateLimitIdentity(access, grant, request) {
  if (access.admin) return 'admin';
  if (grant) return `grant:${grant.grant_id}`;
  if (access.authenticated) return `project:${clientIp(request)}`;
  return `guest:${clientIp(request)}`;
}

/**
 * Author identity for open-mode writers: admin → owner, grant → reviewer, everyone else (anonymous
 * public viewers and project/ghost sessions) → unverified `guest` with default name "Guest" unless
 * the client supplied an authorName.
 */
function actorFor(access) {
  if (access.admin) return { kind: 'owner', name: 'Owner' };
  if (access.reviewer) return { kind: 'reviewer', name: 'Reviewer' };
  return { kind: 'guest', name: 'Guest' };
}

/** Stable 429 for the open-feedback accumulation caps (no row was written). */
function capacityError() {
  return new ApiError(
    429,
    'feedback_capacity',
    'This artifact has reached the feedback message capacity; no new messages can be added.',
    { maxMessagesPerArtifact: MAX_MESSAGES_PER_ARTIFACT, maxMessagesPerThread: MAX_MESSAGES_PER_THREAD },
  );
}

function limitOrThrow(key, limit) {
  const result = rateLimit(key, limit);
  if (!result.ok) {
    throw new ApiError(429, 'rate_limited', 'Too many requests. Retry shortly.', {
      retryAfter: result.retryAfter,
    });
  }
}

function parseLimit(value, fallback, max) {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new ApiError(400, 'invalid_request', 'limit must be an integer.');
  const limit = Number(value);
  if (limit < 1 || limit > max) {
    throw new ApiError(400, 'invalid_request', `limit must be between 1 and ${max}.`);
  }
  return limit;
}

function parseCursor(value) {
  if (value === null || value === '') return null;
  if (!/^\d{1,15}$/.test(value)) throw new ApiError(400, 'invalid_request', 'Invalid cursor.');
  const cursor = Number(value);
  return cursor > 0 ? cursor : null;
}

function parseStatuses(value) {
  if (value === null || value === '') return [];
  const statuses = value.split(',').map((status) => status.trim()).filter(Boolean);
  const invalid = statuses.find((status) => !['open', 'addressed', 'resolved'].includes(status));
  if (invalid) throw new ApiError(400, 'invalid_request', `Unknown status: ${invalid}.`);
  return [...new Set(statuses)];
}

/** @param {URL} url @param {object} body */
function identityFrom(url, body = {}) {
  return {
    artifactId: body.artifactId || url.searchParams.get('artifact'),
    project: body.project || url.searchParams.get('project'),
    file: body.file || url.searchParams.get('file'),
  };
}

async function requireArtifact(env, url, body = {}) {
  const artifact = await resolveArtifact(env, identityFrom(url, body));
  if (!artifact) throw new ApiError(404, 'artifact_unknown', 'Unknown or unpublished artifact.');
  return artifact;
}

async function resolveArtifactForThread(env, row) {
  const artifact = await resolveArtifact(env, { project: row.project, file: row.file });
  if (!artifact || artifact.artifactId !== row.artifact_id) {
    throw new ApiError(404, 'artifact_unknown', 'Unknown or unpublished artifact.');
  }
  return artifact;
}

function conflict(current, code = 'version_conflict', message = 'The thread changed. Reload and retry.') {
  return new ApiError(409, code, message, { current });
}

async function threadJson(env, row, access, artifact) {
  return hydrateThread(env, row, {
    access,
    revisionNumbers: revisionNumbers(artifact.registry),
  });
}

// ------------------------------------------------------------------- routes ---

async function handleList({ request, env }) {
  const url = new URL(request.url);
  const artifact = await requireArtifact(env, url);
  const { access } = await resolveFeedbackAccess(env, request, artifact);
  limitOrThrow(`r:${rateLimitIdentity(access, null, request)}:${artifact.artifactId}`, READ_LIMIT);

  const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const statuses = parseStatuses(url.searchParams.get('status'));
  const revisionParam = url.searchParams.get('revision');
  let revisionId = null;
  if (revisionParam === 'current') {
    const current = await currentRevision(env, artifact);
    if (!current) throw new ApiError(400, 'invalid_revision', 'This artifact has no registered revisions.');
    revisionId = current.revisionId;
  } else if (revisionParam && revisionParam !== 'all') {
    if (!/^[0-9a-f]{64}$/.test(revisionParam)) {
      throw new ApiError(400, 'invalid_revision', 'revision must be all, current or a revision id.');
    }
    revisionId = revisionParam;
  }

  const rows = await listThreadRows(env, {
    artifactId: artifact.artifactId,
    statuses,
    revisionId,
    cursor,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const threads = await hydrateThreads(env, page, {
    access,
    revisionNumbers: revisionNumbers(artifact.registry),
  });
  const counts = await countStatuses(env, artifact.artifactId);
  const current = await currentRevision(env, artifact);
  const nextCursor = hasMore && page.length ? String(page[page.length - 1].last_event_id) : null;

  return json({
    schemaVersion: 1,
    artifact: artifactJson(artifact),
    revision: current ? { revisionId: current.revisionId, number: current.number } : null,
    threads,
    counts,
    permissions: basePermissions(access),
    txid: await currentTxid(env),
    nextCursor,
  });
}

async function handleCreate({ request, env }) {
  const url = new URL(request.url);
  requireSameOrigin(request, url);
  const body = await readJsonBody(request);
  const input = normalizeCreateBody(body);
  const artifact = await requireArtifact(env, url, input);
  const { access, grant } = await resolveFeedbackAccess(env, request, artifact, { write: true });
  limitOrThrow(`w:${rateLimitIdentity(access, grant, request)}:${artifact.artifactId}`, WRITE_LIMIT);

  const revision = await resolveRevisionForArtifact(env, artifact, input.revisionId);
  if (!revision) {
    throw new ApiError(
      400,
      'invalid_revision',
      'revisionId is not a registered revision of this artifact. Publish an immutable revision first.',
    );
  }

  const actor = actorFor(access);
  const actorId = actorIdentity(access, grant, request);
  const hash = await payloadHash({
    operation: 'thread.create',
    artifactId: artifact.artifactId,
    revisionId: input.revisionId,
    kind: input.kind,
    anchor: input.anchor,
    body: input.body,
    replacement: input.replacement,
  });

  const existing = await findThreadByClientId(env, artifact.artifactId, input.idempotencyKey);
  if (existing) {
    if (existing.client_actor !== actorId || existing.payload_hash !== hash) {
      throw conflict(
        await threadJson(env, existing, access, artifact),
        'idempotency_conflict',
        'This idempotencyKey was already used with a different actor or payload.',
      );
    }
    return json({
      thread: await threadJson(env, existing, access, artifact),
      permissions: basePermissions(access),
      txid: await currentTxid(env),
    });
  }

  if ((await countArtifactMessages(env, artifact.artifactId)) >= MAX_MESSAGES_PER_ARTIFACT) {
    throw new ApiError(
      429,
      'feedback_capacity',
      'This artifact has reached the feedback message capacity; no new messages can be added.',
      { maxMessagesPerArtifact: MAX_MESSAGES_PER_ARTIFACT, maxMessagesPerThread: MAX_MESSAGES_PER_THREAD },
    );
  }

  const createdAt = new Date().toISOString();
  const threadId = newId('th');
  const messageId = newId('msg');
  const author = { kind: actor.kind, name: normalizeAuthorName(input.authorName, actor.name) };
  try {
    const inserted = await insertThread(env, {
      threadId,
      artifactId: artifact.artifactId,
      project: artifact.project,
      file: artifact.file,
      revisionId: revision.revisionId,
      kind: input.kind,
      anchor: input.anchor,
      replacement: input.replacement,
      createdAt,
      author,
      clientId: input.idempotencyKey,
      clientActor: actorId,
      payloadHash: hash,
      messageId,
      body: input.body,
    });
    // The transaction-time capacity guard rejected the insert (e.g. a concurrent request consumed
    // the last slot after our pre-check): return the stable 429, never hydrate a missing row.
    if (!inserted.ok) throw capacityError();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await findThreadByClientId(env, artifact.artifactId, input.idempotencyKey);
      if (winner && winner.client_actor === actorId && winner.payload_hash === hash) {
        return json({
          thread: await threadJson(env, winner, access, artifact),
          permissions: basePermissions(access),
          txid: await currentTxid(env),
        });
      }
      if (winner) {
        throw conflict(
          await threadJson(env, winner, access, artifact),
          'idempotency_conflict',
          'This idempotencyKey was already used with a different actor or payload.',
        );
      }
    }
    throw error;
  }

  const row = await getThreadRow(env, threadId);
  if (!row) throw capacityError(); // guarded insert created nothing: never hydrate a null row
  return json(
    {
      thread: await threadJson(env, row, access, artifact),
      permissions: basePermissions(access),
      txid: await currentTxid(env),
    },
    201,
  );
}

async function loadThreadOr404(env, threadId) {
  const row = await getThreadRow(env, threadId);
  if (!row) throw new ApiError(404, 'thread_not_found', 'Unknown review thread.');
  return row;
}

async function handleGetThread({ request, env, threadId }) {
  const row = await loadThreadOr404(env, threadId);
  const artifact = await resolveArtifactForThread(env, row);
  const { access } = await resolveFeedbackAccess(env, request, artifact);
  limitOrThrow(`r:${rateLimitIdentity(access, null, request)}:${artifact.artifactId}`, READ_LIMIT);
  return json({
    thread: await threadJson(env, row, access, artifact),
    permissions: basePermissions(access),
    txid: await currentTxid(env),
  });
}

async function handleReply({ request, env, threadId }) {
  const url = new URL(request.url);
  requireSameOrigin(request, url);
  const body = await readJsonBody(request);
  const input = normalizeReplyBody(body);
  const row = await loadThreadOr404(env, threadId);
  const artifact = await resolveArtifactForThread(env, row);
  const { access, grant } = await resolveFeedbackAccess(env, request, artifact, { write: true });
  limitOrThrow(`w:${rateLimitIdentity(access, grant, request)}:${artifact.artifactId}`, WRITE_LIMIT);

  const actor = actorFor(access);
  const actorId = actorIdentity(access, grant, request);
  const hash = await payloadHash({
    operation: 'message.create',
    threadId,
    kind: input.kind,
    body: input.body,
    replacement: input.replacement,
  });

  const replay = await findMessageByClientId(env, threadId, input.idempotencyKey);
  if (replay) {
    if (replay.client_actor !== actorId || replay.payload_hash !== hash) {
      throw conflict(
        await threadJson(env, row, access, artifact),
        'idempotency_conflict',
        'This idempotencyKey was already used with a different actor or payload.',
      );
    }
    return json({
      thread: await threadJson(env, row, access, artifact),
      message: messageFromRow(replay),
      txid: await currentTxid(env),
    });
  }

  if (await messageCapacityExceeded(env, threadId, artifact.artifactId)) {
    throw new ApiError(
      429,
      'feedback_capacity',
      'This thread or artifact has reached the feedback message capacity; no new replies can be added.',
      { maxMessagesPerArtifact: MAX_MESSAGES_PER_ARTIFACT, maxMessagesPerThread: MAX_MESSAGES_PER_THREAD },
    );
  }

  const createdAt = new Date().toISOString();
  let result;
  try {
    result = await insertMessage(env, {
      messageId: newId('msg'),
      thread: row,
      body: input.body,
      kind: input.kind,
      replacement: input.replacement,
      author: { kind: actor.kind, name: normalizeAuthorName(input.authorName, actor.name) },
      createdAt,
      clientId: input.idempotencyKey,
      clientActor: actorId,
      payloadHash: hash,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await findMessageByClientId(env, threadId, input.idempotencyKey);
      if (winner && winner.client_actor === actorId && winner.payload_hash === hash) {
        return json({
          thread: await threadJson(env, row, access, artifact),
          message: messageFromRow(winner),
          txid: await currentTxid(env),
        });
      }
    }
    throw error;
  }

  const freshRow = await getThreadRow(env, threadId);
  if (!result.ok) {
    if ('capacity' in result && result.capacity) {
      throw new ApiError(
        429,
        'feedback_capacity',
        'This thread or artifact has reached the feedback message capacity; no new replies can be added.',
        { maxMessagesPerArtifact: MAX_MESSAGES_PER_ARTIFACT, maxMessagesPerThread: MAX_MESSAGES_PER_THREAD },
      );
    }
    throw conflict(await threadJson(env, freshRow, access, artifact));
  }
  const winner = await findMessageByClientId(env, threadId, input.idempotencyKey);
  return json(
    {
      thread: await threadJson(env, freshRow, access, artifact),
      message: winner ? messageFromRow(winner) : null,
      txid: await currentTxid(env),
    },
    201,
  );
}

/** Message JSON for a row (same shape as Thread.messages entries). */
function messageFromRow(row) {
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

async function handlePatchThread({ request, env, threadId }) {
  const url = new URL(request.url);
  requireSameOrigin(request, url);
  const body = await readJsonBody(request);
  const patch = normalizeStatusPatch(body);
  const row = await loadThreadOr404(env, threadId);
  const artifact = await resolveArtifactForThread(env, row);
  const { access, grant } = await resolveFeedbackAccess(env, request, artifact, { write: true });
  limitOrThrow(`w:${rateLimitIdentity(access, grant, request)}:${artifact.artifactId}`, WRITE_LIMIT);

  if (patch.status === 'addressed' && !access.canMarkAddressed) {
    throw new ApiError(403, 'forbidden', 'Only the site owner can mark a thread addressed.');
  }
  if (patch.status !== 'addressed' && !access.canResolve) {
    throw new ApiError(403, 'forbidden', 'A site owner or review-grant credential is required.');
  }

  const actor = actorFor(access);
  const actorId = actorIdentity(access, grant, request);
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null;
  const hash = await payloadHash({
    operation: 'status.change',
    threadId,
    status: patch.status,
    addressedRevisionId: patch.addressedRevisionId ?? null,
    expectedVersion: patch.expectedVersion,
  });

  // Idempotent replay of a status mutation: return the original outcome (200), not a spurious
  // invalid_status/version_conflict. A reused key with a different payload is a conflict.
  if (idempotencyKey) {
    const receipt = await findStatusReceipt(env, threadId, idempotencyKey);
    if (receipt) {
      if (receipt.payload_hash !== hash) {
        throw conflict(await threadJson(env, row, access, artifact), 'idempotency_conflict',
          'This idempotencyKey was already used with a different payload.');
      }
      const previousStatus = parseReceipt(body?.idempotencyKey, receipt)?.before ?? null;
      return json({
        thread: await threadJson(env, row, access, artifact),
        previousStatus,
        txid: await currentTxid(env),
      });
    }
  }

  if (!TRANSITIONS[row.status]?.has(patch.status)) {
    throw new ApiError(400, 'invalid_status', `Cannot change a ${row.status} thread to ${patch.status}.`);
  }
  if (patch.expectedVersion !== Number(row.version)) {
    throw conflict(await threadJson(env, row, access, artifact));
  }

  // Resolve only ever uses the fixing revision recorded by the owner; the caller may not retarget.
  let addressedRevisionId = null;
  if (patch.status === 'addressed') {
    const current = await currentRevision(env, artifact);
    addressedRevisionId = patch.addressedRevisionId || (current ? current.revisionId : null);
    if (!addressedRevisionId) throw new ApiError(400, 'invalid_revision', 'No revision recorded for the fix.');
    if (!(await resolveRevisionForArtifact(env, artifact, addressedRevisionId))) {
      throw new ApiError(400, 'invalid_revision', 'addressedRevisionId is not a registered revision.');
    }
  } else if (patch.status === 'resolved') {
    const recorded = row.addressed_revision_id || null;
    if (!recorded) {
      throw new ApiError(
        400,
        'invalid_revision',
        'Resolve requires the owner-recorded fixing revision: this thread has no addressedRevisionId.',
      );
    }
    if (patch.addressedRevisionId && patch.addressedRevisionId !== recorded) {
      throw new ApiError(
        400,
        'invalid_revision',
        'addressedRevisionId does not match the owner-recorded fixing revision.',
      );
    }
    const revision = await resolveRevisionForArtifact(env, artifact, recorded);
    if (!revision) throw new ApiError(400, 'invalid_revision', 'The recorded revision is not registered.');
    addressedRevisionId = revision.revisionId;
  } // reopen clears the fixing revision

  const updatedAt = new Date().toISOString();
  const result = await updateThreadStatus(env, {
    thread: { ...row, version: patch.expectedVersion },
    status: patch.status,
    addressedRevisionId,
    actor,
    actorIdentity: actorId,
    updatedAt,
    clientId: idempotencyKey,
    clientActor: actorId,
    payloadHash: hash,
  });
  const freshRow = await getThreadRow(env, threadId);
  if (!result.ok) throw conflict(await threadJson(env, freshRow, access, artifact));
  return json({
    thread: await threadJson(env, freshRow, access, artifact),
    previousStatus: row.status,
    txid: await currentTxid(env),
  });
}

/** Parse the stored receipt meta_json (defensive: storage is ours, but never crash on drift). */
function parseReceipt(_key, receipt) {
  try {
    return receipt?.meta_json ? JSON.parse(receipt.meta_json) : null;
  } catch {
    return null;
  }
}

async function handleExport({ request, env }) {
  const url = new URL(request.url);
  const artifact = await requireArtifact(env, url);
  const { access } = await resolveFeedbackAccess(env, request, artifact);
  limitOrThrow(`r:${rateLimitIdentity(access, null, request)}:${artifact.artifactId}`, READ_LIMIT);
  const format = (url.searchParams.get('format') || 'json').toLowerCase();
  if (format !== 'json' && format !== 'md') {
    throw new ApiError(400, 'invalid_request', 'format must be json or md.');
  }
  const statuses = parseStatuses(url.searchParams.get('status'));
  const effectiveStatuses = statuses.length ? statuses : ['open', 'addressed'];

  const rows = [];
  let cursor = null;
  while (rows.length < MAX_THREADS) {
    const page = await listThreadRows(env, {
      artifactId: artifact.artifactId,
      statuses: effectiveStatuses,
      cursor,
      limit: 100,
    });
    rows.push(...page);
    if (page.length < 100) break;
    cursor = page[page.length - 1].last_event_id;
  }
  const threads = await hydrateThreads(env, rows, {
    access,
    revisionNumbers: revisionNumbers(artifact.registry),
  });
  const counts = await countStatuses(env, artifact.artifactId);
  const current = await currentRevision(env, artifact);
  const revision = current ? { revisionId: current.revisionId, number: current.number } : null;
  const exportedAt = new Date().toISOString();
  const artifactPayload = artifactJson(artifact);

  if (format === 'md') {
    const markdown = formatFeedbackMarkdown({
      artifact: artifactPayload,
      revision,
      threads,
      counts,
      exportedAt,
    });
    return new Response(markdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="feedback-${artifact.artifactId.slice(0, 8)}-${exportedAt.slice(0, 10)}.md"`,
        'x-content-type-options': 'nosniff',
      },
    });
  }
  return json(
    formatFeedbackJson({ artifact: artifactPayload, revision, threads, counts, exportedAt }),
  );
}

// ------------------------------------------------------------------ grants ---

async function requireAdmin(env, request) {
  if (!(await adminAuthorized(env, request))) {
    throw new ApiError(403, 'forbidden', 'Only the site owner (FEEDBACK_ADMIN_TOKEN) can manage review grants.');
  }
}

async function handleCreateGrant({ request, env }) {
  const url = new URL(request.url);
  requireSameOrigin(request, url);
  await requireAdmin(env, request);
  const body = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_request', 'A JSON object body is required.');
  }
  const artifact = await requireArtifact(env, url, body);
  limitOrThrow(`w:grant:${artifact.artifactId}`, WRITE_LIMIT);

  const ttlRaw = body.ttlSeconds ?? 7 * 24 * 60 * 60;
  if (!Number.isInteger(ttlRaw) || ttlRaw < 60 || ttlRaw > 180 * 24 * 60 * 60) {
    throw new ApiError(400, 'invalid_request', 'ttlSeconds must be an integer between 60 and 15552000.');
  }
  if (body.scope !== undefined && body.scope !== 'comment') {
    throw new ApiError(400, 'invalid_request', 'scope must be "comment".');
  }
  const grant = await insertGrant(env, {
    artifactId: artifact.artifactId,
    project: artifact.project,
    file: artifact.file,
    scope: 'comment',
    ttlSeconds: ttlRaw,
    createdBy: 'admin',
  });
  return json(
    {
      grantId: grant.grantId,
      token: grant.token,
      artifactId: grant.artifactId,
      scope: grant.scope,
      expiresAt: grant.expiresAt,
      reviewUrl: reviewUrlFor(url.origin, artifact, grant.token),
      txid: await currentTxid(env),
    },
    201,
  );
}

async function handleListGrants({ request, env }) {
  const url = new URL(request.url);
  await requireAdmin(env, request);
  const artifact = await requireArtifact(env, url);
  const grants = await listGrants(env, artifact.artifactId);
  return json({ artifact: artifactJson(artifact), grants: grants.map(grantJson) });
}

async function handleRevokeGrant({ request, env, grantId }) {
  const url = new URL(request.url);
  requireSameOrigin(request, url);
  await requireAdmin(env, request);
  const grant = await getGrantRow(env, grantId);
  if (!grant) throw new ApiError(404, 'not_found', 'Unknown review grant.');
  const revoked = await revokeGrant(env, grantId);
  return json({ revoked, grantId });
}

// ----------------------------------------------------------------- dispatch ---

function methodNotAllowed(allow) {
  return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, {
    allow: allow.join(', '),
  });
}

export const onRequest = async (context) => {
  const { request, env, params } = context;
  const method = request.method;

  try {
    if (!hasFeedbackDb(env)) {
      return json(
        { error: 'Review feedback is not configured on this deployment.', code: 'feedback_not_configured' },
        503,
      );
    }
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      return json({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, {
        allow: 'GET, POST, PATCH, DELETE',
      });
    }

    const segments = pathSegments(params);
    const head = segments[0] || '';
    const rest = segments.slice(1);

    if (segments.length === 0) {
      if (method === 'GET' || method === 'HEAD') return await handleList(context);
      if (method === 'POST') return await handleCreate(context);
      return methodNotAllowed(['GET', 'POST']);
    }
    if (segments.length === 1 && head === 'export') {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET']);
      return await handleExport(context);
    }
    if (head === 'grants') {
      if (rest.length === 0) {
        if (method === 'GET' || method === 'HEAD') return await handleListGrants(context);
        if (method === 'POST') return await handleCreateGrant(context);
        return methodNotAllowed(['GET', 'POST']);
      }
      if (rest.length === 1) {
        if (method !== 'DELETE') return methodNotAllowed(['DELETE']);
        return await handleRevokeGrant({ ...context, grantId: rest[0] });
      }
      return json({ error: 'Not found.', code: 'not_found' }, 404);
    }
    if (rest.length === 0) {
      if (method === 'GET' || method === 'HEAD') return await handleGetThread({ ...context, threadId: head });
      if (method === 'PATCH') return await handlePatchThread({ ...context, threadId: head });
      return methodNotAllowed(['GET', 'PATCH']);
    }
    if (rest.length === 1 && rest[0] === 'replies') {
      if (method !== 'POST') return methodNotAllowed(['POST']);
      return await handleReply({ ...context, threadId: head });
    }
    return json({ error: 'Not found.', code: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error('[feedback] unexpected failure:', error && error.message ? error.message : error);
    return json({ error: 'Review feedback failed.', code: 'internal_error' }, 500);
  }
};
