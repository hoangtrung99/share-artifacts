// Cloudflare Pages Functions middleware — runs at the edge on EVERY request.
//
// Two auth layers, checked in order:
//
// 1. GHOST LAYER — hidden projects (meta/ghost.json on R2, cached ~45s).
//    A ghost project requires a valid cf_ghost cookie (HMAC-signed, master password unlock
//    via /ghost). Fail-closed: a ghost project with no GHOST_MASTER_PW or no COOKIE_SECRET
//    is never served. ?ghost=true / ?ghost=1 on any GET page → 302 to /ghost.
//
// 2. PER-PROJECT LAYER — password-protected projects (meta/protected.json on R2
//    or PW_<SNAKE(X)> env secret). A project "X" requires a valid cf_auth_<SNAKE(X)> cookie.
//    Fail-closed: listed-protected but missing PW_<X> or COOKIE_SECRET → 403.
//
// Tokens embed a fingerprint of the current password (see _auth.js), so rotating a password
// revokes every previously issued cookie for that project.
//
// A project can be BOTH ghost AND protected — the user must clear both layers.
//
// /ghost, /login, /logout, /api/*, /assets/*, /_astro/*, favicon, sitemap, robots all have a
// non-project first segment, so they pass through next() without auth (no explicit allowlist
// needed — just don't name a project "ghost", "login", or "api").

import { loadRegistry, getText, SHELL_SEGMENTS, safeDecode } from './_store.js';
import { redirectResponse } from './_http.js';
import {
  pwKey,
  cookieName,
  verifyToken,
  readCookie,
  pwVersion,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
} from './_auth.js';

// ---- Redirect layer (reorg support) -----------------------------------------
// meta/redirect-map.json on R2 maps an extensionless path ("project/a/b") to its
// new extensionless location. Checked BEFORE auth so old public links get a
// stable 301 and reach the new URL (which then enforces whatever gates apply).
const REDIRECT_KEY = 'meta/redirect-map.json';
const REDIRECT_TTL_MS = 60_000;
let redirectCache = null;

async function loadRedirectMap(env) {
  const now = Date.now();
  if (redirectCache && now - redirectCache.at < REDIRECT_TTL_MS) return redirectCache.map;
  let map = {};
  try {
    const raw = await getText(env.ARTIFACTS, REDIRECT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed;
    }
  } catch {
    map = {}; // fail-open: a broken map must never block content
  }
  redirectCache = { at: now, map };
  return map;
}

/** Drop the in-memory redirect map (tests; the TTL handles normal invalidation). */
export function resetRedirectCache() {
  redirectCache = null;
}

/** Resolve a request path against the redirect map. Returns the target path (+suffix +search) or null. */
export async function resolveRedirect(env, url) {
  const map = await loadRedirectMap(env);
  if (!Object.keys(map).length) return null;
  let p = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const extMatch = p.match(/^(.*)\.(html|md)$/i);
  const base = extMatch ? extMatch[1] : p;
  const suffix = extMatch ? `.${extMatch[2].toLowerCase()}` : '';
  const target = map[safeDecode(base)];
  if (!target || target === base) return null;
  return `/${target}${suffix}${url.search || ''}`;
}

const baseHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

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

  // ?ghost=true / ?ghost=1 on any GET page → redirect to /ghost (master password unlock).
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (url.searchParams.get('ghost') === 'true' || url.searchParams.get('ghost') === '1') {
      return redirectResponse(new URL('/ghost/', url).href, 302);
    }
  }

  const seg = url.pathname.split('/').filter(Boolean)[0];
  if (!seg) return next(); // home page: public
  const firstSegment = safeDecode(seg);
  if (SHELL_SEGMENTS.has(firstSegment) || SHELL_SEGMENTS.has(seg)) {
    return next(); // shell / API / static first segments — no project auth
  }

  const project = firstSegment;

  // --- Redirect layer (before auth: old links 301 to their new home) ---
  const redirectTarget = await resolveRedirect(env, url);
  if (redirectTarget) {
    return redirectResponse(new URL(redirectTarget, url).href, 301);
  }

  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);

  // --- Layer 1: Ghost gate ---
  if (ghostFolders.has(project)) {
    // Fail-closed: ghost project with no master password or no signing key.
    if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) return misconfigured();
    const ghostVersion = await pwVersion(env.COOKIE_SECRET, env.GHOST_MASTER_PW);
    const ghostToken = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
    if (!(await verifyToken(env.COOKIE_SECRET, ghostToken, GHOST_PROJECT, ghostVersion))) {
      if (isDocumentRequest(request)) {
        return redirectResponse(new URL('/ghost/', url).href, 302);
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

  const version = await pwVersion(env.COOKIE_SECRET, expected);
  const token = readCookie(request.headers.get('Cookie'), cookieName(project));
  if (await verifyToken(env.COOKIE_SECRET, token, project, version)) return next();

  // Not authenticated.
  if (isDocumentRequest(request)) {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('next', url.pathname + url.search);
    loginUrl.searchParams.set('project', project);
    return redirectResponse(loginUrl.href, 302);
  }
  return new Response('🔒 Authentication required.', { status: 401, headers: baseHeaders });
};
