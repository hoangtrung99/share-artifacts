// Cloudflare Pages Functions middleware — runs at the edge on EVERY request.
// Guards the first path segment (the project folder) with a styled-login + signed-cookie scheme
// (replaces the old HTTP Basic Auth popup).
//
// A project "X" requires auth when:
//   - X is in protected-folders.js (generated from protected.list), OR
//   - a secret env "PW_<SNAKE(X)>" exists
//   where SNAKE(X) = X uppercased, every char outside [A-Z0-9] -> "_"
//   (e.g. /reports/.. -> PW_REPORTS ; /project-a/.. -> PW_PROJECT_A). Matches protect.sh.
//
// To pass, the request must carry a valid signed cookie cf_auth_<SNAKE(X)> — verified with
// HMAC-SHA256 over COOKIE_SECRET (crypto.subtle), checking expiry AND that the token's project
// matches the path. Missing/invalid on a navigation request -> 302 to the styled /login page.
//
// FAIL-CLOSED. A project is denied (never served) if it is listed-protected but EITHER its
// PW_<X> secret OR the COOKIE_SECRET signing key is missing — a misconfigured lock must not
// silently become public.
//
// /login, /logout, /pagefind/*, /_astro/*, favicon, sitemap, robots all have a non-project
// first segment, so they pass through next() without auth (no explicit allowlist needed —
// just don't name a protected project "login" or "pagefind").

import PROTECTED from './protected-folders.js';
import { pwKey, cookieName, verifyToken, readCookie } from './_auth.js';

const protectedFolders = new Set(PROTECTED);

const baseHeaders = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

function misconfigured() {
  // Listed protected but a required secret (PW_<X> or COOKIE_SECRET) is missing -> hard lock.
  return new Response(
    '🔒 This folder is protected but is not fully configured. Please contact the site owner.',
    { status: 403, headers: baseHeaders },
  );
}

// Treat as a navigation/document request (worth redirecting to a login page) when the client
// asks for HTML, or it's a top-level navigation. Non-document asset requests get a plain 401.
function isDocumentRequest(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest) return dest === 'document' || dest === 'iframe' || dest === 'empty';
  const accept = request.headers.get('Accept') || '';
  return accept.includes('text/html');
}

export const onRequest = async ({ request, env, next }) => {
  const url = new URL(request.url);
  const seg = url.pathname.split('/').filter(Boolean)[0];
  if (!seg) return next(); // home page: public

  const project = decodeURIComponent(seg);
  const expected = env[pwKey(project)];
  const mustAuth = protectedFolders.has(project) || !!expected;
  if (!mustAuth) return next(); // unprotected folder

  // Fail-closed: a listed/protected project with no password or no signing key is never served.
  if (!expected || !env.COOKIE_SECRET) return misconfigured();

  const token = readCookie(request.headers.get('Cookie'), cookieName(project));
  if (await verifyToken(env.COOKIE_SECRET, token, project)) return next();

  // Not authenticated.
  if (isDocumentRequest(request)) {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('next', url.pathname + url.search);
    loginUrl.searchParams.set('project', project);
    return Response.redirect(loginUrl.href, 302);
  }
  return new Response('🔒 Authentication required.', { status: 401, headers: baseHeaders });
};
