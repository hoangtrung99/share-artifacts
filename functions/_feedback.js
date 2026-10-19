// Shared helpers for the review-feedback backend.
//
// Keeping these in one place ensures the routes, the D1 layer and the read-only CLI all agree on:
//   - artifact identity validation (project/file names, ids, revisions),
//   - request/payload bounds and anchored-quote shape (W3C TextQuoteSelector-style),
//   - the project/ghost read gates (re-implemented because /api/* bypasses _middleware.js),
//   - review grants and the permission matrix exposed to the client,
//   - export formatting (JSON + Markdown) and stable error bodies.
//
// No Cloudflare-only APIs here beyond WebCrypto; everything is unit-testable in Node.

import { jsonResponse } from './_http.js';
import {
  loadCatalog,
  findByRoutePath,
  contentKey,
  getText,
  PROTECTED_KEY,
  GHOST_KEY,
} from './_store.js';
import {
  pwKey,
  cookieName,
  verifyToken,
  readCookie,
  pwVersion,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
} from './_auth.js';
import {
  artifactIdFor,
  artifactTypeFor,
  isArtifactId,
  isRevisionId,
  loadRevisionRegistryState,
  isTombstoned,
  findRevision,
  latestRevision,
} from './_feedback-revisions.js';

export const MAX_BODY_BYTES = 32 * 1024;
export const BODY_MAX_CHARS = 8000;
export const REPLACEMENT_MAX_CHARS = 8000;
export const AUTHOR_NAME_MAX = 80;
export const ANCHOR_EXACT_MAX = 2000;
export const ANCHOR_CONTEXT_MAX = 160;
export const ANCHOR_HEADING_MAX = 300;
export const ANCHOR_ELEMENT_TEXT_MAX = 500;
export const ANCHOR_SELECTOR_MAX = 500;
export const THREAD_STATUSES = ['open', 'addressed', 'resolved'];
export const THREAD_KINDS = ['comment', 'replace', 'remove'];
export const AUTHOR_KINDS = ['owner', 'reviewer', 'guest'];
export const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9._-]*$/;
const FILE_EXT_RE = /\.(html|md)$/i;
const FILE_UNSAFE_RE = /[\\?#%\u0000-\u001f]/;

/** HTTP error carrying a stable machine code. Routes catch this and emit the JSON body. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** JSON response helper shared by every feedback route. */
export function json(body, status = 200, extra = {}) {
  return jsonResponse(body, status, extra);
}

/** Convert an ApiError into the stable error body; rethrow anything else. */
export function errorResponse(error) {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code, ...error.extra }, error.status);
  }
  throw error;
}

export function notFound(message = 'Not found.') {
  return new ApiError(404, 'not_found', message);
}

// ---------------------------------------------------------------- identity ---

/** Project-name rule shared with scripts/lib/names.mjs (kept local: runtime cannot import scripts). */
export function projectNameError(project) {
  const name = String(project ?? '');
  if (!name) return 'project name is required';
  if (name.length > 64) return 'project name must be 64 characters or fewer';
  if (!PROJECT_RE.test(name)) return 'project name must be lowercase alphanumeric/dot/dash/underscore';
  if (name.includes('..')) return 'project name cannot contain ".."';
  return null;
}

/** Artifact file-path rule shared with scripts/lib/names.mjs. */
export function filePathError(file) {
  const value = String(file ?? '');
  if (!value) return 'file path is required';
  if (value.length > 200) return 'file path must be 200 characters or fewer';
  if (value.startsWith('/')) return 'file path must be project-relative (no leading slash)';
  if (FILE_UNSAFE_RE.test(value)) return 'file path contains an unsafe character';
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'file path cannot contain empty, "." or ".." segments';
  }
  if (!FILE_EXT_RE.test(value)) return 'file path must end in .html or .md';
  return null;
}

/**
 * Resolve the artifact identity for a feedback/revisions request.
 * Accepts `project`+`file` (authoritative names) and/or `artifactId`; both forms are cross-checked.
 * Returns null when the artifact cannot be addressed (unknown identity).
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {{ artifactId?: string|null, project?: string|null, file?: string|null }} input
 */
export async function resolveArtifact(env, input) {
  const project = input.project ? String(input.project) : '';
  const file = input.file ? String(input.file) : '';
  const requestedId = input.artifactId ? String(input.artifactId) : '';

  if (project || file) {
    if (projectNameError(project) || filePathError(file)) return null;
    const artifactId = await artifactIdFor(project, file);
    if (requestedId && requestedId !== artifactId) return null;
    const type = artifactTypeFor(project, file);
    let state = await loadRevisionRegistryState(env, artifactId);
    if (!state.registry && !state.malformed) {
      // Refresh one cached manifest miss before we answer 404/legacy: a manifest published moments
      // ago must not be hidden by the isolate cache.
      state = await loadRevisionRegistryState(env, artifactId, { fresh: true });
    }
    if (state.malformed) {
      throw new ApiError(503, 'registry_unavailable', 'The revision manifest for this artifact is unreadable; review is closed until it is fixed.');
    }
    const registry = state.registry && state.registry.project === project && state.registry.file === file ? state.registry : null;
    if (registry && isTombstoned(registry)) return null; // unpublished: feedback and history are gone
    if (!registry) {
      // Names alone are not proof the artifact exists: require a catalog entry or a content object
      // (same existence rule the content route uses for its 404s).
      const routePath = `${project}/${file.replace(FILE_EXT_RE, '')}`;
      let catalogEntry = null;
      try {
        catalogEntry = findByRoutePath(await loadCatalog(env), routePath);
      } catch {
        catalogEntry = null;
      }
      if (!catalogEntry) {
        const head = env.ARTIFACTS?.head ? await env.ARTIFACTS.head(contentKey(project, file)) : null;
        if (!head) return null;
      }
    }
    return {
      artifactId,
      project,
      file,
      type,
      routePath: `${project}/${file.replace(FILE_EXT_RE, '')}`,
      registry,
    };
  }

  if (!isArtifactId(requestedId)) return null;
  let state = await loadRevisionRegistryState(env, requestedId);
  if (!state.registry && !state.malformed) state = await loadRevisionRegistryState(env, requestedId, { fresh: true });
  if (state.malformed) {
    throw new ApiError(503, 'registry_unavailable', 'The revision manifest for this artifact is unreadable; review is closed until it is fixed.');
  }
  if (state.registry) {
    if (isTombstoned(state.registry)) return null;
    return {
      artifactId: requestedId,
      project: state.registry.project,
      file: state.registry.file,
      type: state.registry.type,
      routePath: `${state.registry.project}/${state.registry.file.replace(FILE_EXT_RE, '')}`,
      registry: state.registry,
    };
  }

  // No registry: fall back to the catalog to recover project/file from the id. The artifact is
  // unbootstrapped, so writes are rejected but reads/version history can still be answered.
  let catalog;
  try {
    catalog = await loadCatalog(env);
  } catch {
    return null;
  }
  for (const [projectName, entry] of Object.entries(catalog.projects || {})) {
    for (const fileEntry of entry?.files || []) {
      if (typeof fileEntry?.file !== 'string' || !FILE_EXT_RE.test(fileEntry.file)) continue;
      const candidate = await artifactIdFor(projectName, fileEntry.file);
      if (candidate !== requestedId) continue;
      return {
        artifactId: candidate,
        project: projectName,
        file: fileEntry.file,
        type: artifactTypeFor(projectName, fileEntry.file),
        routePath: `${projectName}/${fileEntry.file.replace(FILE_EXT_RE, '')}`,
        registry: null,
      };
    }
  }
  return null;
}

/**
 * Latest registered revision of an artifact. Feedback is bound to immutable snapshots only:
 * unbootstrapped/legacy artifacts have no current revision and reject thread creation.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {object} artifact result of resolveArtifact
 */
export async function currentRevision(env, artifact) {
  return latestRevision(artifact.registry);
}

/**
 * Map revisionId → revision number from the registry (null when unknown).
 * @param {object|null} registry
 */
export function revisionNumbers(registry) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const revision of registry?.revisions || []) map.set(revision.revisionId, revision.number);
  return map;
}

/**
 * Validate that a requested revision is a registered immutable revision of the artifact.
 * No content-hash fallback: feedback on unbootstrapped artifacts is rejected.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {object} artifact
 * @param {string} revisionId
 */
export async function resolveRevisionForArtifact(env, artifact, revisionId) {
  if (!isRevisionId(revisionId) || !artifact.registry) return null;
  return findRevision(artifact.registry, revisionId);
}

// ------------------------------------------------------------- auth gates ---

/**
 * Protected/ghost registry names for feedback routes. Unlike _store.js (which is fail-open for
 * content serving), a malformed registry throws 503: feedback must never be treated as public
 * because a security registry could not be parsed.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 */
export async function loadFeedbackRegistry(env) {
  const [protectedRaw, ghostRaw] = await Promise.all([
    getText(env.ARTIFACTS, PROTECTED_KEY),
    getText(env.ARTIFACTS, GHOST_KEY),
  ]);
  return {
    protected: parseRegistryNames(protectedRaw, 'protected'),
    ghost: parseRegistryNames(ghostRaw, 'ghost'),
  };
}

function parseRegistryNames(raw, label) {
  if (raw == null) return new Set();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ApiError(503, 'registry_unavailable', `The ${label} registry is unreadable; review is closed until it is fixed.`);
  }
  if (!Array.isArray(data)) {
    throw new ApiError(503, 'registry_unavailable', `The ${label} registry has an invalid shape; review is closed until it is fixed.`);
  }
  return new Set(data.map((name) => String(name).trim()).filter(Boolean));
}

/**
 * Read gate mirroring _middleware.js for /api/* routes:
 *   ghost project  → valid cf_ghost cookie
 *   protected project → valid cf_auth_<project> cookie
 *   public project → anonymous read allowed
 * Returns { ok:true, owner } or { ok:false, status, code, message }.
 * @param {{ ARTIFACTS?: R2Bucket, COOKIE_SECRET?: string, GHOST_MASTER_PW?: string, [key: string]: unknown }} env
 * @param {Request} request
 * @param {string} project
 */
export async function resolveProjectAccess(env, request, project) {
  const { protected: protectedFolders, ghost: ghostFolders } = await loadFeedbackRegistry(env);
  const cookieHeader = request.headers.get('cookie');
  let authenticated = false;

  if (ghostFolders.has(project)) {
    if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) {
      return { ok: false, status: 403, code: 'misconfigured', message: 'Ghost access is not configured.' };
    }
    const ghostVersion = await pwVersion(env.COOKIE_SECRET, env.GHOST_MASTER_PW);
    const ghostToken = readCookie(cookieHeader, GHOST_COOKIE_NAME);
    if (!(await verifyToken(env.COOKIE_SECRET, ghostToken, GHOST_PROJECT, ghostVersion))) {
      return { ok: false, status: 401, code: 'auth_required', message: 'Ghost access is required.' };
    }
    authenticated = true;
  }

  const expected = env[pwKey(project)];
  const mustAuth = protectedFolders.has(project) || Boolean(expected);
  if (!mustAuth) return { ok: true, authenticated };
  if (!expected || !env.COOKIE_SECRET) {
    return { ok: false, status: 403, code: 'misconfigured', message: 'This project is protected but not fully configured.' };
  }
  const version = await pwVersion(env.COOKIE_SECRET, String(expected));
  const token = readCookie(cookieHeader, cookieName(project));
  if (!(await verifyToken(env.COOKIE_SECRET, token, project, version))) {
    return { ok: false, status: 401, code: 'auth_required', message: 'Project authentication is required.' };
  }
  return { ok: true, authenticated: true };
}

/** True when the request carries the site-owner feedback admin token. */
export async function adminAuthorized(env, request) {
  const provided = request.headers.get('x-feedback-admin');
  if (!env.FEEDBACK_ADMIN_TOKEN || !provided) return false;
  return secureEqual(env.FEEDBACK_ADMIN_TOKEN, provided);
}

/** @param {string} a @param {string} b */
async function secureEqual(a, b) {
  const digest = async (/** @type {string} */ value) => {
    const bytes = new TextEncoder().encode(String(value));
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  };
  const [ha, hb] = await Promise.all([digest(a), digest(b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/**
 * Artifact-scoped review cookie. GET /r/<token> redeems a grant into this HttpOnly cookie; the
 * token never appears in the artifact URL, JS storage, or a request header.
 * @param {string} artifactId
 */
export function reviewGrantCookieName(artifactId) {
  return `cf_review_${String(artifactId).slice(0, 16)}`;
}

/** Read the review-grant credential for one artifact ('' when absent). */
export function readReviewGrantToken(request, artifactId) {
  const token = readCookie(request.headers.get('cookie'), reviewGrantCookieName(artifactId));
  return token && token.length <= 256 ? token : '';
}

/** Serialize the artifact-scoped review cookie; Max-Age is capped at the grant's remaining TTL. */
export function reviewGrantCookie(artifactId, token, maxAgeSeconds) {
  const maxAge = Math.max(1, Math.floor(maxAgeSeconds));
  return `${reviewGrantCookieName(artifactId)}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Effective capabilities for a caller.
 *  - `admin`       — FEEDBACK_ADMIN_TOKEN (site owner; the ONLY credential that can mark addressed
 *                    or manage grants). A project/share cookie is NOT owner proof.
 *  - `reviewer`    — validated artifact-scoped review grant (comment/reply/resolve/reopen).
 *  - `authenticated` — project/ghost cookie (read access only).
 * @param {{ admin?: boolean, reviewer?: boolean, authenticated?: boolean }} input
 */
export function accessCapabilities({ admin = false, reviewer = false, authenticated = false }) {
  return {
    admin,
    reviewer,
    authenticated,
    canWrite: admin || reviewer,
    canMarkAddressed: admin,
    canResolve: admin || reviewer,
    canExport: true,
  };
}

/** Permissions object for the list/revision envelope (no alias fields). */
export function basePermissions(access) {
  return {
    canComment: access.canWrite,
    canChangeStatus: access.canMarkAddressed,
    canResolve: access.canResolve,
    canExport: access.canExport,
  };
}

/** Per-thread permissions included in every Thread JSON. */
export function threadPermissions(access, thread) {
  const resolved = thread.status === 'resolved';
  return {
    canReply: access.canWrite,
    canChangeStatus: access.canMarkAddressed && !resolved,
    canResolve: access.canResolve && !resolved,
    canReopen: access.canResolve && resolved,
  };
}

// ------------------------------------------------------------- validation ---

/**
 * Read a bounded JSON body. Throws ApiError(413/400/415).
 * @param {Request} request
 * @param {number} [maxBytes]
 */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  if (Number(request.headers.get('content-length')) > maxBytes) {
    throw new ApiError(413, 'payload_too_large', `Request exceeds the ${maxBytes} byte limit.`);
  }
  if (!request.body) throw new ApiError(400, 'invalid_request', 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'payload_too_large', `Request exceeds the ${maxBytes} byte limit.`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_request', 'Invalid JSON body.');
  } finally {
    reader.releaseLock();
  }
}

/** Mutations must be same-origin (CSRF). */
export function requireSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== url.origin) {
    throw new ApiError(403, 'csrf', 'Same-origin request required.');
  }
}

/** @param {unknown} value */
function optionalBoundedText(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value.trim();
}

/**
 * Bounded text stored EXACTLY as captured (no trimming). Anchor context windows include boundary
 * whitespace on purpose: trimming them shifts the match up to the client's quote anchoring and can
 * turn duplicate-sentence anchors unanchored after reload. Validation is size/content only.
 * @param {unknown} value
 * @param {number} max
 */
function boundedRawText(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value;
}

/** @param {unknown} value */
export function normalizeAuthorName(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'authorName must be a string.');
  const name = value.trim();
  if (!name) return fallback;
  if (name.length > AUTHOR_NAME_MAX) {
    throw new ApiError(400, 'invalid_request', `authorName must be at most ${AUTHOR_NAME_MAX} characters.`);
  }
  return name;
}

/** @param {unknown} value */
export function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_RE.test(value)) {
    throw new ApiError(400, 'invalid_request', 'idempotencyKey must be 8-128 chars [A-Za-z0-9._:-].');
  }
  return value;
}

/**
 * Validate + normalize the quote anchor. Server validates shape/size only; locating the quote in
 * the artifact DOM is a client concern. Returns null for an invalid anchor.
 * @param {unknown} raw
 */
export function normalizeAnchor(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = /** @type {any} */ (raw);
  if (input.version !== undefined && input.version !== 1) return null;
  const type = input.type === undefined ? 'text' : input.type;
  // MVP: selectable text or a whole-document comment. Element metadata may be attached as a hint
  // but is not a location contract (no pinpoint UX yet).
  if (type !== 'text' && type !== 'document') return null;

  // `exact` is stored as selected (verbatim; no trimming) — only validated for size/content.
  const exact = typeof input.exact === 'string' ? input.exact : '';
  if (exact.length > ANCHOR_EXACT_MAX) return null;
  if (type === 'text' && !exact.trim()) return null;

  // W3C TextQuoteSelector context is stored verbatim: the captured window may start/end with a
  // space, and that whitespace is part of the client's anchor disambiguation.
  const prefix = boundedRawText(input.prefix, ANCHOR_CONTEXT_MAX);
  const suffix = boundedRawText(input.suffix, ANCHOR_CONTEXT_MAX);
  if (prefix === undefined || suffix === undefined) return null;

  // Offsets are optional hints (normalized text positions); anchoring is client-side.
  let start = null;
  let end = null;
  if (input.start !== undefined || input.end !== undefined) {
    if (!Number.isInteger(input.start) || !Number.isInteger(input.end)) return null;
    if (input.start < 0 || input.end <= input.start) return null;
    start = input.start;
    end = input.end;
  }

  const heading = optionalBoundedText(input.heading, ANCHOR_HEADING_MAX);
  if (heading === undefined) return null;
  let headingPath = null;
  if (input.headingPath !== undefined && input.headingPath !== null) {
    if (!Array.isArray(input.headingPath) || input.headingPath.length > 10) return null;
    headingPath = [];
    for (const item of input.headingPath) {
      if (typeof item !== 'string' || item.length > ANCHOR_HEADING_MAX) return null;
      headingPath.push(item);
    }
  }

  let element = null;
  if (input.element !== undefined && input.element !== null) {
    const el = input.element;
    if (typeof el !== 'object' || Array.isArray(el)) return null;
    const tag = optionalBoundedText(el.tag, 40);
    const id = optionalBoundedText(el.id, 120);
    const role = optionalBoundedText(el.role, 40);
    const selector = optionalBoundedText(el.selector, ANCHOR_SELECTOR_MAX);
    const text = optionalBoundedText(el.text, ANCHOR_ELEMENT_TEXT_MAX);
    if ([tag, id, role, selector, text].some((value) => value === undefined)) return null;
    element = { tag: tag ?? null, id: id ?? null, role: role ?? null, selector: selector ?? null, text: text ?? null };
  }

  let context = null;
  if (input.context !== undefined && input.context !== null) {
    const ctx = input.context;
    if (typeof ctx !== 'object' || Array.isArray(ctx)) return null;
    const language = optionalBoundedText(ctx.language, 20);
    const tab = optionalBoundedText(ctx.tab, 80);
    if (language === undefined || tab === undefined) return null;
    context = { language: language ?? null, tab: tab ?? null };
  }

  return {
    version: 1,
    type,
    exact,
    prefix: prefix ?? '',
    suffix: suffix ?? '',
    start,
    end,
    heading: heading ?? '',
    headingPath,
    element,
    context,
  };
}

/** @param {unknown} value @param {number} max */
function requiredBody(value, max) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'body must be a string.');
  const body = value.trim();
  if (!body) throw new ApiError(400, 'invalid_request', 'body is required.');
  if (body.length > max) throw new ApiError(400, 'invalid_request', `body must be at most ${max} characters.`);
  return body;
}

/** @param {unknown} value @param {string} kind */
function replacementFor(value, kind) {
  if (value === undefined || value === null || value === '') {
    if (kind === 'replace') throw new ApiError(400, 'invalid_request', 'replacement is required for kind=replace.');
    return null;
  }
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'replacement must be a string.');
  const replacement = value.trim();
  if (replacement.length > REPLACEMENT_MAX_CHARS) {
    throw new ApiError(400, 'invalid_request', `replacement must be at most ${REPLACEMENT_MAX_CHARS} characters.`);
  }
  if (kind !== 'replace') throw new ApiError(400, 'invalid_request', 'replacement is only valid for kind=replace.');
  return replacement;
}

/**
 * Validate a create-thread body.
 * @param {unknown} raw
 */
export function normalizeCreateBody(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'invalid_request', 'A JSON object body is required.');
  }
  const input = /** @type {any} */ (raw);
  const kind = input.kind === undefined ? 'comment' : input.kind;
  if (!THREAD_KINDS.includes(kind)) {
    throw new ApiError(400, 'invalid_request', `kind must be one of ${THREAD_KINDS.join(', ')}.`);
  }
  const body = requiredBody(input.body, BODY_MAX_CHARS);
  const replacement = replacementFor(input.replacement, kind);
  const anchor = normalizeAnchor(input.anchor);
  if (!anchor) throw new ApiError(400, 'invalid_anchor', 'anchor is missing required fields or exceeds limits.');
  // Feedback is always bound to an immutable revision; there is no "latest" default.
  if (typeof input.revisionId !== 'string' || !isRevisionId(input.revisionId)) {
    throw new ApiError(
      400,
      'invalid_revision',
      'revisionId is required: review feedback must target a registered immutable revision.',
    );
  }
  const revisionId = input.revisionId;
  return {
    artifactId: input.artifactId === undefined || input.artifactId === null ? '' : String(input.artifactId),
    project: input.project ? String(input.project) : '',
    file: input.file ? String(input.file) : '',
    revisionId,
    kind,
    body,
    replacement,
    anchor,
    authorName: input.authorName === undefined ? null : input.authorName,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
  };
}

/** Validate a reply body. */
export function normalizeReplyBody(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'invalid_request', 'A JSON object body is required.');
  }
  const input = /** @type {any} */ (raw);
  const kind = input.kind === undefined ? 'comment' : input.kind;
  if (!THREAD_KINDS.includes(kind)) {
    throw new ApiError(400, 'invalid_request', `kind must be one of ${THREAD_KINDS.join(', ')}.`);
  }
  return {
    kind,
    body: requiredBody(input.body, BODY_MAX_CHARS),
    replacement: replacementFor(input.replacement, kind),
    authorName: input.authorName === undefined ? null : input.authorName,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
  };
}

/** Validate a status patch body. */
export function normalizeStatusPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(400, 'invalid_request', 'A JSON object body is required.');
  }
  const input = /** @type {any} */ (raw);
  if (!THREAD_STATUSES.includes(input.status)) {
    throw new ApiError(400, 'invalid_status', `status must be one of ${THREAD_STATUSES.join(', ')}.`);
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(400, 'invalid_request', 'expectedVersion must be a positive integer.');
  }
  let addressedRevisionId = null;
  if (input.addressedRevisionId !== undefined && input.addressedRevisionId !== null) {
    addressedRevisionId = String(input.addressedRevisionId);
    if (!isRevisionId(addressedRevisionId)) {
      throw new ApiError(400, 'invalid_revision', 'addressedRevisionId must be a 64-char sha256 hex digest.');
    }
  }
  return { status: input.status, expectedVersion: input.expectedVersion, addressedRevisionId };
}

// ----------------------------------------------------------- rate limits ---

/** In-memory per-isolate write/read limiter (best effort abuse mitigation, not a boundary). */
const rateBuckets = new Map();
export function rateLimit(key, limit, windowMs = 60_000) {
  const now = Date.now();
  let entry = rateBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, entry);
  }
  entry.count += 1;
  if (rateBuckets.size > 2000) {
    for (const [bucketKey, bucket] of rateBuckets) if (now >= bucket.resetAt) rateBuckets.delete(bucketKey);
  }
  if (entry.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  return { ok: true };
}

export function resetRateLimits() {
  rateBuckets.clear();
}

// --------------------------------------------------------------- exports ---

/**
 * Escape user-provided text so it renders literally in the Markdown export: no HTML injection and no
 * Markdown structure injection (headings, links, rules, lists, emphasis, code, blockquotes). Inline
 * metacharacters are backslash-escaped; line-leading list/rule markers are escaped too. The JSON
 * export is unaffected (it carries the raw body).
 */
function mdText(value) {
  const inlineEscaped = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#!|~>])/g, '\\$1')
    .replace(/</g, '&lt;');
  return inlineEscaped
    .split('\n')
    .map((line) => {
      if (/^\s*([-+])\s/.test(line) || /^\s*-{3,}\s*$/.test(line)) return line.replace(/^(\s*)/, '$1\\');
      if (/^\s*\d+[.)]\s/.test(line)) return line.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
      if (/^\s*=+\s*$/.test(line)) return line.replace(/^(\s*)/, '$1\\');
      return line;
    })
    .join('\n');
}

/** Render a quote block: every line of the selection gets the Markdown quote prefix. */
function mdQuote(value) {
  return mdText(value)
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

/**
 * Build the Markdown export. `threads` are Thread JSON objects (API shape).
 * @param {{ artifact: object, revision: object|null, threads: object[], counts: object, exportedAt: string }} input
 */
export function formatFeedbackMarkdown({ artifact, revision, threads, counts, exportedAt }) {
  const lines = [];
  lines.push(`# Review feedback — ${artifact.project}/${artifact.file}`);
  lines.push('');
  lines.push(`- Artifact: \`${artifact.project}/${artifact.file}\` (${artifact.artifactId})`);
  if (revision) lines.push(`- Revision: v${revision.number} (\`${revision.revisionId}\`)`);
  lines.push(`- Exported: ${exportedAt}`);
  lines.push(`- Threads: ${counts.open || 0} open, ${counts.addressed || 0} addressed, ${counts.resolved || 0} resolved`);
  lines.push('');
  lines.push('---');
  lines.push('');

  threads.forEach((thread, index) => {
    const author = thread.author || {};
    lines.push(`## ${index + 1}. ${thread.status.toUpperCase()} — ${thread.kind} (${thread.threadId})`);
    lines.push('');
    if (thread.revisionNumber != null) lines.push(`Revision: v${thread.revisionNumber} (\`${thread.revisionId}\`)`);
    const anchor = thread.anchor || {};
    if (anchor.exact) {
      lines.push('');
      lines.push(mdQuote(anchor.exact));
      const context = [];
      if (anchor.heading) context.push(`section: ${anchor.heading}`);
      if (anchor.element?.tag) context.push(`element: ${anchor.element.tag}`);
      if (Number.isInteger(anchor.start)) context.push(`offsets: ${anchor.start}–${anchor.end}`);
      if (context.length) lines.push(`_${mdText(context.join(' · '))}_`);
    }
    if (thread.replacement) {
      lines.push('');
      lines.push(`Proposed replacement: ${mdQuote(thread.replacement)}`);
    }
    lines.push('');
    for (const message of thread.messages || []) {
      const who = message.author || {};
      const verified = who.unverified ? 'guest, unverified' : who.kind || 'unknown';
      lines.push(`**${mdText(who.name || 'Anonymous')}** (${verified}) — ${message.createdAt}`);
      lines.push('');
      lines.push(mdText(message.body));
      lines.push('');
    }
    if (thread.addressedRevisionId) lines.push(`Addressed in revision \`${thread.addressedRevisionId}\`.`);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Build the JSON export envelope.
 * @param {{ artifact: object, revision: object|null, threads: object[], counts: object, exportedAt: string }} input
 */
export function formatFeedbackJson({ artifact, revision, threads, counts, exportedAt }) {
  return {
    schemaVersion: 1,
    exportedAt,
    artifact,
    revision,
    counts,
    threads,
  };
}

/**
 * Absolute review URL for a grant token. The token must stay in the URL client-side only (it is
 * stored by the frontend and sent as a header on mutations).
 * @param {string} origin
 * @param {object} artifact
 * @param {string} token
 */
export function reviewUrlFor(origin, artifact, token) {
  // Dedicated redemption route: sets the artifact-scoped HttpOnly cookie and redirects to the
  // artifact, so the token never lands in the artifact URL, referrers, or JS storage.
  return `${origin}/r/${encodeURIComponent(token)}`;
}
