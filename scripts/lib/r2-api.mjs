// Cloudflare REST API helpers for R2 bucket inspection.
//
// The wrangler CLI (v4) can get/put/delete objects but has no "list objects" command, so the
// inventory/backfill script talks to the Cloudflare REST API directly. Auth resolution:
//   1. CLOUDFLARE_API_TOKEN env var, else
//   2. the OAuth token wrangler stores after `wrangler login`.
// The token is never printed or written anywhere.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API_BASE = 'https://api.cloudflare.com/client/v4';
export const DEFAULT_BUCKET = 'artifacts-content';

/** R2 object keys are path-ish; encode each segment so nested keys address one object. */
function encodeKey(key) {
  return String(key).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function wranglerConfigPaths() {
  const home = os.homedir();
  return [
    process.env.WRANGLER_CONFIG,
    path.join(home, 'Library/Preferences/.wrangler/config/default.toml'), // macOS
    path.join(home, '.config/.wrangler/config/default.toml'), // Linux
    path.join(home, '.wrangler/config/default.toml'),
  ].filter(Boolean);
}

function readWranglerOauthToken() {
  for (const configPath of wranglerConfigPaths()) {
    try {
      const config = fs.readFileSync(configPath, 'utf8');
      const match = config.match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    } catch {
      /* try the next location */
    }
  }
  return null;
}

/** @returns {string} */
export function getApiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN || readWranglerOauthToken();
  if (!token) {
    throw new Error(
      'No Cloudflare credentials: set CLOUDFLARE_API_TOKEN or run `npx wrangler login` first.',
    );
  }
  return token;
}

async function apiFetch(pathname, token) {
  const response = await fetch(API_BASE + pathname, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare API ${pathname} returned non-JSON (HTTP ${response.status}).`);
  }
  if (!payload.success) {
    const reason = (payload.errors || []).map((e) => e.message).join('; ') || 'unknown error';
    throw new Error(`Cloudflare API ${pathname} failed: ${reason}`);
  }
  return payload;
}

/** @returns {Promise<string>} account id (env override or the first account on the token) */
export async function getAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  const payload = await apiFetch('/accounts', getApiToken());
  const account = Array.isArray(payload.result) ? payload.result[0] : null;
  if (!account?.id) throw new Error('No Cloudflare account found for these credentials.');
  return account.id;
}

/**
 * List every object under a prefix.
 * @param {{ bucket?: string, prefix?: string, token?: string, accountId?: string }} [options]
 * @returns {Promise<Array<{ key: string, size: number, etag: string, uploaded: string }>>}
 */
export async function listR2Objects(options = {}) {
  const bucket = options.bucket || DEFAULT_BUCKET;
  const prefix = options.prefix || '';
  const token = options.token || getApiToken();
  const accountId = options.accountId || (await getAccountId());

  const objects = [];
  let cursor;
  let pages = 0;
  do {
    const query = new URLSearchParams({ prefix, per_page: '1000' });
    if (cursor) query.set('cursor', cursor);
    const payload = await apiFetch(
      `/accounts/${accountId}/r2/buckets/${bucket}/objects?${query.toString()}`,
      token,
    );
    for (const object of payload.result || []) {
      // Normalize to the same ISO-8601-with-milliseconds format the Workers binding produces
      // (R2Bucket list returns a Date; the REST API may return second precision).
      const uploaded = new Date(object.last_modified);
      objects.push({
        key: object.key,
        size: object.size,
        etag: object.etag,
        uploaded: Number.isNaN(uploaded.getTime()) ? object.last_modified : uploaded.toISOString(),
      });
    }
    const info = payload.result_info || {};
    cursor = info.is_truncated ? info.cursor : undefined;
    pages++;
    if (pages > 50) throw new Error('R2 listing exceeded 50 pages; aborting.');
  } while (cursor);
  return objects;
}

// ---------------------------------------------------------------------------
// Conditional (CAS) object reads/writes for JSON manifests (e.g. revision registries).
// R2 supports If-Match / If-None-Match: "*" on the REST object endpoint; the wrangler CLI does not
// expose them. Credentials are the same as the rest of this module (API token or wrangler login).
// ---------------------------------------------------------------------------

/**
 * True when the Cloudflare REST API credentials needed for CAS writes are available.
 *
 * Only an explicit CLOUDFLARE_API_TOKEN counts: wrangler's stored OAuth token is refreshed by the
 * CLI and is not guaranteed to be accepted by the R2 REST object endpoint (it returned 401s and
 * eventually tripped Cloudflare auth-failure throttling during a bulk bootstrap). Without the env
 * token the revision CLI falls back to CLI writes + read-back verification and says so.
 */
export function hasConditionalCredentials() {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_API_TOKEN.trim());
}

/**
 * Read an object with its ETag via the REST API.
 * @param {string} key
 * @param {{ bucket?: string, token?: string, accountId?: string }} [options]
 * @returns {Promise<{ missing: boolean, text: string|null, etag: string|null }>}
 */
export async function r2GetObjectWithEtag(key, options = {}) {
  const bucket = options.bucket || DEFAULT_BUCKET;
  const token = options.token || getApiToken();
  const accountId = options.accountId || (await getAccountId());
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeKey(key)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404) return { missing: true, text: null, etag: null };
  if (!response.ok) throw new Error(`R2 GET ${key} failed: HTTP ${response.status}`);
  return { missing: false, text: await response.text(), etag: response.headers.get('etag') };
}

/**
 * A conditional write must carry a REAL precondition. Throws otherwise so a missing/empty ETag can
 * never degrade into an unconditional PUT.
 * @param {{ ifMatch?: string|null, ifNoneMatch?: string|null }} [options]
 */
export function assertConditionalPrecondition(options = {}) {
  if (options.ifNoneMatch === '*' && !options.ifMatch) return;
  if (typeof options.ifMatch === 'string' && options.ifMatch.trim()) return;
  throw new Error('R2 conditional write requires an If-Match ETag or If-None-Match: "*"');
}

/**
 * A CAS baseline fetched with credentials must carry an ETag; otherwise the update would be
 * unconditional. Missing objects are fine (they use If-None-Match: "*" on create).
 * @param {{ missing?: boolean, etag?: string|null } | null} result
 * @param {string} key
 */
export function assertCasEtag(result, key) {
  if (!result || result.missing) return;
  if (typeof result.etag !== 'string' || !result.etag.trim()) {
    throw new Error(`R2 GET ${key} returned no ETag; refusing an unconditional write`);
  }
}

/**
 * Conditional put of a text object.
 *  - `ifMatch`: only write when the stored ETag still equals this value (CAS update).
 *  - `ifNoneMatch: '*'`: only create when the object does not exist (CAS create).
 * Returns { ok:false, conflict:true } on HTTP 412 so the caller can retry after re-reading.
 * @param {string} key
 * @param {string} text
 * @param {{ ifMatch?: string|null, ifNoneMatch?: string|null, contentType?: string, bucket?: string, token?: string, accountId?: string }} [options]
 */
export async function r2PutTextConditional(key, text, options = {}) {
  assertConditionalPrecondition(options);
  const bucket = options.bucket || DEFAULT_BUCKET;
  const token = options.token || getApiToken();
  const accountId = options.accountId || (await getAccountId());
  const headers = {
    Authorization: `Bearer ${token}`,
    'content-type': options.contentType || 'application/json; charset=utf-8',
  };
  if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeKey(key)}`,
    { method: 'PUT', headers, body: text },
  );
  if (response.status === 412) return { ok: false, conflict: true, status: 412 };
  if (!response.ok) throw new Error(`R2 conditional PUT ${key} failed: HTTP ${response.status}`);
  return { ok: true, conflict: false, status: response.status, etag: response.headers.get('etag') };
}
