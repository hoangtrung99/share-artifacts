// Cloudflare Pages Functions middleware — runs at the edge on EVERY request.
//
// Two auth layers, checked in order:
//
// 1. GHOST LAYER — hidden projects (meta/ghost.json on R2, cached ~45s).
//    A ghost project requires a valid cf_ghost cookie (HMAC-signed, master password unlock
//    via /ghost). Fail-closed: a ghost project with no GHOST_MASTER_PW or no COOKIE_SECRET
//    is never served. ?ghost=true / ?ghost=1 on ANY page → 302 to /ghost.
//
// 2. PER-PROJECT LAYER — password-protected projects (meta/protected.json on R2
//    or PW_<SNAKE(X)> env secret). A project "X" requires a valid cf_auth_<SNAKE(X)> cookie.
//    Fail-closed: listed-protected but missing PW_<X> or COOKIE_SECRET → 403.
//
// A project can be BOTH ghost AND protected — the user must clear both layers.
//
// /ghost, /login, /logout, /api/*, /assets/*, /_astro/*, favicon, sitemap, robots all have a
// non-project first segment, so they pass through next() without auth (no explicit allowlist
// needed — just don't name a project "ghost", "login", or "api").

import { loadRegistry, SHELL_SEGMENTS } from './_store.js';
import {
  pwKey,
  cookieName,
  verifyToken,
  readCookie,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
} from './_auth.js';

const baseHeaders = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

function misconfigured() {
  // Listed protected/ghost but a required secret is missing -> hard lock.
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

  // ?ghost=true / ?ghost=1 on any page → redirect to /ghost (master password unlock).
  if (url.searchParams.get('ghost') === 'true' || url.searchParams.get('ghost') === '1') {
    return Response.redirect(new URL('/ghost/', url).href, 302);
  }

  const seg = url.pathname.split('/').filter(Boolean)[0];
  if (!seg) return next(); // home page: public
  if (SHELL_SEGMENTS.has(seg) || SHELL_SEGMENTS.has(decodeURIComponent(seg))) {
    return next(); // shell / API / static first segments — no project auth
  }

  const project = decodeURIComponent(seg);
  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);

  // --- Layer 1: Ghost gate ---
  if (ghostFolders.has(project)) {
    // Fail-closed: ghost project with no master password or no signing key.
    if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) return misconfigured();
    const ghostToken = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
    if (!(await verifyToken(env.COOKIE_SECRET, ghostToken, GHOST_PROJECT))) {
      if (isDocumentRequest(request)) {
        return Response.redirect(new URL('/ghost/', url).href, 302);
      }
      return new Response('🔒 Ghost access required.', { status: 401, headers: baseHeaders });
    }
    // cf_ghost valid — fall through to per-project auth below.
  }

  // --- Layer 2: Per-project password gate ---
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
