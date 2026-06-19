// POST /share — mint a share link for a protected project.
//
// SECURITY: the caller MUST already be authenticated for the target project. We verify their
// cf_auth_<project> cookie with verifyToken (same check the middleware does) before minting.
// Without this, anyone who knows a project name could mint share links = privilege escalation.
//
// Body (JSON): { project, path, ttl }
//   - project: protected project name (must match the cookie's project binding)
//   - path:    artifact path to redirect to on redemption (e.g. "/verups/report"); sanitized
//   - ttl:     one of "24h" | "7d" | "30d" | "180d" (default "30d")
// Success: 200 { url: "https://<origin>/s/<token>" }
// Failure: 401 (not authenticated), 400 (bad request)
//
// CSRF: session cookies are SameSite=Lax, so a cross-site POST won't carry the auth cookie.
//
// STATELESS LIMITATION: there is no KV/D1, so share tokens are signed with COOKIE_SECRET (same
// as session cookies). Individual revocation is NOT possible — only rotating COOKIE_SECRET
// revokes all share links (and all active sessions) at once. This is a known tradeoff.

import {
  cookieName,
  verifyToken,
  signShareToken,
  shareTtl,
  safeNext,
  readCookie,
} from './_auth.js';

export const onRequestPost = async ({ request, env }) => {
  if (!env.COOKIE_SECRET) {
    return json({ error: 'Server not configured for sharing.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const project = String(body?.project || '').trim();
  const rawPath = String(body?.path || '');
  const ttlKey = String(body?.ttl || '');

  if (!project) return json({ error: 'Missing project.' }, 400);

  // Verify the caller is authenticated for THIS project (not just any project).
  const cookie = readCookie(request.headers.get('Cookie'), cookieName(project));
  const authed = await verifyToken(env.COOKIE_SECRET, cookie, project);
  if (!authed) {
    return json({ error: 'You must be signed in to this project to create a share link.' }, 401);
  }

  const ttl = shareTtl(ttlKey);
  const next = safeNext(rawPath, '/' + encodeURIComponent(project) + '/');

  const token = await signShareToken(env.COOKIE_SECRET, project, next, ttl);

  const origin = new URL(request.url).origin;
  return json({ url: `${origin}/s/${token}` });
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
