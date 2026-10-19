// Immutable artifact revisions — shared pure helpers (runtime + CLI scripts).
//
// Layout (R2 bucket ARTIFACTS):
//   content/<project>/<file>                              mutable current bytes (legacy + compat path)
//   revisions/<artifactId>/<revisionId>/source.html|md    immutable snapshot bytes
//   meta/revisions/<artifactId>.json                      revision registry + latest pointer
//
// artifactId is stable per (project, file): sha256("artifact-v1\0"+project+"\0"+file)[0..32).
// revisionId is sha256(content bytes), so bytes are content-addressed and immutable.
//
// This module has no Cloudflare-only imports: Pages Functions use it with env.ARTIFACTS, and the
// publish/bootstrap CLI scripts (Node) use the pure helpers plus lib/r2-cli.mjs. Keep it that way.

export const REVISION_SCHEMA_VERSION = 1;
// Short cache: `?rev=` for a revision published moments ago can 404 for at most this window.
export const REVISION_CACHE_TTL_MS = 15_000;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const encoder = new TextEncoder();

/** @type {Map<string, { at: number, data: object | null, malformed: boolean }>} */
const registryCache = new Map();

/** Drop every cached registry. Used by tests and after intentional writes. */
export function resetRevisionCache() {
  registryCache.clear();
}

/**
 * Lowercase hex sha256 of a string or byte source.
 * @param {string | ArrayBuffer | Uint8Array} input
 * @returns {Promise<string>}
 */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * Stable artifact identity for a project-relative file path.
 * @param {string} project
 * @param {string} file file path including .html/.md
 */
export async function artifactIdFor(project, file) {
  return (await sha256Hex(`artifact-v1\u0000${project}\u0000${file}`)).slice(0, 32);
}

/** @param {string} value */
export function isRevisionId(value) {
  return typeof value === 'string' && HEX64.test(value);
}

/** @param {string} value */
export function isArtifactId(value) {
  return typeof value === 'string' && HEX32.test(value);
}

/** @param {string} project @param {string} file */
export function artifactTypeFor(project, file) {
  return String(file).toLowerCase().endsWith('.md') ? 'md' : 'html';
}

/** @param {string} artifactId */
export function registryKey(artifactId) {
  return `meta/revisions/${artifactId}.json`;
}

/**
 * @param {string} artifactId
 * @param {string} revisionId
 * @param {'html'|'md'} type
 */
export function revisionKey(artifactId, revisionId, type) {
  return `revisions/${artifactId}/${revisionId}/source.${type === 'md' ? 'md' : 'html'}`;
}

/** @param {'html'|'md'} type */
export function contentTypeFor(type) {
  return type === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
}

/**
 * Empty registry for an artifact.
 * @param {{ artifactId: string, project: string, file: string, type: 'html'|'md', createdAt?: string }} input
 */
export function createRegistry({ artifactId, project, file, type, createdAt }) {
  const now = createdAt || new Date().toISOString();
  return {
    schemaVersion: REVISION_SCHEMA_VERSION,
    artifactId,
    project,
    file,
    type,
    createdAt: now,
    updatedAt: now,
    generation: 0,
    publicationId: '',
    tombstone: false,
    tombstonedAt: '',
    latestRevisionId: '',
    latestRevisionNumber: 0,
    revisions: [],
  };
}

/**
 * Normalize a registry read from R2. Derives the latest pointer from the revision list (never
 * trusts a possibly-stale pointer), drops malformed entries, and sorts by number.
 * @param {unknown} raw
 * @returns {object | null}
 */
export function normalizeRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const registry = /** @type {any} */ (raw);
  if (typeof registry.artifactId !== 'string' || !isArtifactId(registry.artifactId)) return null;
  if (typeof registry.project !== 'string' || !registry.project) return null;
  if (typeof registry.file !== 'string' || !registry.file) return null;
  if (registry.type !== 'html' && registry.type !== 'md') return null;
  if (!Array.isArray(registry.revisions)) registry.revisions = [];

  const revisions = [];
  for (const item of registry.revisions) {
    if (!item || typeof item !== 'object') continue;
    if (!isRevisionId(item.revisionId) || !Number.isInteger(item.number) || item.number < 1) continue;
    revisions.push({
      revisionId: item.revisionId,
      number: item.number,
      size: Number.isInteger(item.size) && item.size >= 0 ? item.size : 0,
      contentType: typeof item.contentType === 'string' ? item.contentType : contentTypeFor(registry.type),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
      createdBy: typeof item.createdBy === 'string' ? item.createdBy : 'unknown',
      publicationId: typeof item.publicationId === 'string' ? item.publicationId : null,
    });
  }
  revisions.sort((a, b) => a.number - b.number);

  const latest = revisions.length ? revisions[revisions.length - 1] : null;
  const normalized = {
    schemaVersion: Number.isInteger(registry.schemaVersion) ? registry.schemaVersion : 1,
    artifactId: registry.artifactId,
    project: registry.project,
    file: registry.file,
    type: registry.type,
    createdAt: typeof registry.createdAt === 'string' ? registry.createdAt : '',
    updatedAt: typeof registry.updatedAt === 'string' ? registry.updatedAt : '',
    generation: Number.isInteger(registry.generation) && registry.generation >= 0 ? registry.generation : 0,
    publicationId: typeof registry.publicationId === 'string' ? registry.publicationId : '',
    // Tombstones are permanent markers written by unpublish BEFORE the bytes are deleted: serving
    // treats them as 404 immediately and the marker must never be deleted (no resurrection via the
    // legacy content/ fallback).
    tombstone: registry.tombstone === true,
    tombstonedAt: typeof registry.tombstonedAt === 'string' ? registry.tombstonedAt : '',
    latestRevisionId: latest ? latest.revisionId : '',
    latestRevisionNumber: latest ? latest.number : 0,
    revisions,
  };
  return normalized;
}

/**
 * Add a revision to a registry unless the content hash is already registered (idempotent).
 * The latest pointer is written in the same object, i.e. updated last by callers.
 * @param {object} registry normalized registry (not mutated)
 * @param {{ revisionId: string, size: number, createdBy?: string, createdAt?: string, contentType?: string, publicationId?: string }} input
 * @returns {{ registry: object, revision: object, added: boolean }}
 */
export function addRevision(registry, input) {
  const existing = registry.revisions.find((item) => item.revisionId === input.revisionId);
  if (existing) return { registry, revision: existing, added: false };
  const revision = {
    revisionId: input.revisionId,
    number: registry.latestRevisionNumber + 1,
    size: input.size,
    contentType: input.contentType || contentTypeFor(registry.type),
    createdAt: input.createdAt || new Date().toISOString(),
    createdBy: input.createdBy || 'deliver',
    publicationId: input.publicationId || null,
  };
  const next = {
    ...registry,
    updatedAt: revision.createdAt,
    revisions: [...registry.revisions, revision],
    latestRevisionId: revision.revisionId,
    latestRevisionNumber: revision.number,
  };
  return { registry: next, revision, added: true };
}

/** @param {object | null} registry @param {string} revisionId */
export function findRevision(registry, revisionId) {
  if (!registry || !isRevisionId(revisionId)) return null;
  return registry.revisions.find((item) => item.revisionId === revisionId) || null;
}

/** @param {object | null} registry */
export function latestRevision(registry) {
  if (!registry || !registry.revisions.length) return null;
  return registry.revisions[registry.revisions.length - 1];
}

/** True when the artifact was unpublished (permanent marker; serving must 404). */
export function isTombstoned(registry) {
  return Boolean(registry && registry.tombstone === true);
}

/**
 * Registry read with a short isolate cache.
 * Returns { registry, malformed }: `malformed` tells security-sensitive callers (feedback routes)
 * to fail closed instead of treating an unreadable manifest as "no manifest".
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {string} artifactId
 * @param {{ fresh?: boolean }} [options]
 */
export async function loadRevisionRegistryState(env, artifactId, options = {}) {
  if (!env.ARTIFACTS || !isArtifactId(artifactId)) return { registry: null, malformed: false };
  const now = Date.now();
  if (!options.fresh) {
    const hit = registryCache.get(artifactId);
    if (hit && now - hit.at < REVISION_CACHE_TTL_MS) {
      return { registry: hit.data, malformed: hit.malformed };
    }
  }
  /** @type {object | null} */
  let data = null;
  let malformed = false;
  try {
    const object = await env.ARTIFACTS.get(registryKey(artifactId));
    if (object) {
      try {
        data = normalizeRegistry(JSON.parse(await object.text()));
      } catch (error) {
        malformed = true;
        console.error('[revisions] registry parse failed:', error.message);
      }
    }
  } catch (error) {
    console.error('[revisions] registry read failed:', error.message);
    malformed = true;
  }
  registryCache.set(artifactId, { at: now, data, malformed });
  if (registryCache.size > 500) registryCache.delete(registryCache.keys().next().value);
  return { registry: data, malformed };
}

/**
 * Registry read (lenient: null when missing/unreadable/malformed).
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {string} artifactId
 * @param {{ fresh?: boolean }} [options]
 */
export async function loadRevisionRegistry(env, artifactId, options = {}) {
  return (await loadRevisionRegistryState(env, artifactId, options)).registry;
}

/** Drop one cached registry (or all). */
export function invalidateRevisionRegistry(artifactId) {
  if (artifactId) registryCache.delete(artifactId);
  else registryCache.clear();
}

/** A registry only describes the artifact it was stored for. */
export function registryMatches(registry, project, file, type) {
  return Boolean(
    registry
    && registry.project === project
    && registry.file === file
    && registry.type === (type || artifactTypeFor(project, file)),
  );
}

/**
 * Read immutable snapshot text bytes. Returns null when missing.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 */
export async function readSnapshotText(env, artifactId, revisionId, type) {
  if (!env.ARTIFACTS || !isRevisionId(revisionId)) return null;
  try {
    const object = await env.ARTIFACTS.get(revisionKey(artifactId, revisionId, type));
    return object ? await object.text() : null;
  } catch (error) {
    console.error('[revisions] snapshot read failed:', error.message);
    return null;
  }
}

/**
 * Read the bytes of the mutable content/ object and hash them. Legacy fallback for artifacts
 * published before revisioning existed: the "current revision" is the content hash.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 */
export async function currentContentRevision(env, project, file) {
  if (!env.ARTIFACTS) return null;
  try {
    const object = await env.ARTIFACTS.get(`content/${project}/${String(file).replace(/^\/+/, '')}`);
    if (!object) return null;
    const bytes = typeof object.arrayBuffer === 'function'
      ? new Uint8Array(await object.arrayBuffer())
      : encoder.encode(await object.text());
    return { revisionId: await sha256Hex(bytes), size: bytes.byteLength };
  } catch (error) {
    console.error('[revisions] content hash failed:', error.message);
    return null;
  }
}
