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
