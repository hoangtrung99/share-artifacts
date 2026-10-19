// POST /share — mint a share link for a protected project.
//
// SECURITY: the caller MUST already be authenticated for the target project. We verify their
// cf_auth_<project> cookie (including the password-version binding) before minting. Without
// this, anyone who knows a project name could mint share links = privilege escalation.
//
// Body (JSON): { project, path, ttl }
//   - project: protected project name (must match the cookie's project binding)
//   - path:    artifact path to redirect to on redemption (e.g. "/verups/report"); sanitized
//   - ttl:     one of "24h" | "7d" | "30d" | "180d" (default "30d")
// Success: 200 { url: "https://<origin>/s/<token>" }
// Failure: 400 (bad request / ghost project), 401 (not authenticated), 403 (cross-origin),
//          503 (not configured)
//
// Ghost projects cannot be shared: a share link would bypass the master-password gate or
// silently fail at redemption, so it is rejected explicitly instead.
//
// CSRF: session cookies are SameSite=Lax and this endpoint additionally requires a same-origin
// Origin header, so a cross-site POST cannot mint links.
//
// STATELESS LIMITATION: there is no KV/D1, so share tokens are signed with COOKIE_SECRET.
// Individual revocation is NOT possible — rotating COOKIE_SECRET (or changing the project
// password) revokes all outstanding links. This is a known tradeoff.

import {
  cookieName,
  verifyToken,
  signShareToken,
  shareTtl,
  safeNext,
  readCookie,
  pwVersion,
  pwKey,
} from './_auth.js';
import { loadRegistry } from './_store.js';
import { jsonResponse } from './_http.js';

const MAX_BODY_BYTES = 16 * 1024;

/** Read at most `max` bytes of a request body and decode it as UTF-8 text. */
async function readLimitedText(request, max) {
  if (Number(request.headers.get('content-length')) > max) throw new RangeError('too large');
  if (!request.body) throw new SyntaxError('empty body');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new RangeError('too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

export const onRequestPost = async ({ request, env }) => {
  if (!env.COOKIE_SECRET) {
    return jsonResponse({ error: 'Server not configured for sharing.' }, 503);
  }

  const url = new URL(request.url);
  // Some clients omit Origin on same-origin POSTs; Sec-Fetch-Site is the fallback signal.
  const origin = request.headers.get('origin');
  const sameOrigin = origin
    ? origin === url.origin
    : request.headers.get('sec-fetch-site') === 'same-origin';
  if (!sameOrigin) {
    return jsonResponse({ error: 'Same-origin submission is required.' }, 403);
  }

  let body;
  try {
    body = JSON.parse(await readLimitedText(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonResponse({ error: 'Request body is too large.' }, 413);
    }
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const project = String(body?.project || '').trim();
  const rawPath = String(body?.path || '');
  const ttlKey = String(body?.ttl || '');

  if (!project) return jsonResponse({ error: 'Missing project.' }, 400);

  const expected = env[pwKey(project)];
  if (!expected) {
    return jsonResponse(
      { error: 'You must be signed in to this project to create a share link.' },
      401,
    );
  }

  // Verify the caller is authenticated for THIS project (not just any project).
  const version = await pwVersion(env.COOKIE_SECRET, expected);
  const cookie = readCookie(request.headers.get('Cookie'), cookieName(project));
  if (!(await verifyToken(env.COOKIE_SECRET, cookie, project, version))) {
    return jsonResponse(
      { error: 'You must be signed in to this project to create a share link.' },
      401,
    );
  }

  const { ghost } = await loadRegistry(env);
  if (ghost.has(project)) {
    return jsonResponse(
      { error: 'Ghost projects cannot be shared. Un-ghost the project first or share the raw file.' },
      400,
    );
  }

  const ttl = shareTtl(ttlKey);
  const next = safeNext(rawPath, '/' + encodeURIComponent(project) + '/');
  const token = await signShareToken(env.COOKIE_SECRET, project, next, ttl, version);
  return jsonResponse({ url: `${url.origin}/s/${token}` });
};
