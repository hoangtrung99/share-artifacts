// GET /s/:token — redeem a share link.
//
// Validates the share token (signature, expiry, password-version binding, ghost state), mints a
// FRESH session cookie with the TTL baked into the token (so a 24h share link grants 24h of
// access, not the full 180d login TTL), sets it, and 302-redirects to the clean artifact URL.
// The token never appears in the final page URL, browser history, Referer, or edge logs — only
// in the original link the sharer controls.
//
// Invalid/expired/rotated token → 410 Gone with a styled error page (not a bare 404 — the
// recipient should understand what happened).
//
// The /s first-segment is not a protected folder, so the middleware passes it through.

import {
  verifyShareToken,
  signToken,
  cookieName,
  authCookie,
  pwVersion,
  pwKey,
} from '../_auth.js';
import { loadRegistry } from '../_store.js';
import { redirectResponse, shellSecurity } from '../_http.js';
import { shellLayout, brandHeader } from '../_render.js';

export const onRequestGet = async ({ request, env, params }) => {
  const token = params.token;

  if (!env.COOKIE_SECRET || !token) return expiredPage();

  const decoded = await verifyShareToken(env.COOKIE_SECRET, token);
  if (!decoded) return expiredPage();

  // The link is only valid while the project still has the same password it was minted with.
  const expected = env[pwKey(decoded.project)];
  if (!expected) return expiredPage();
  const version = await pwVersion(env.COOKIE_SECRET, expected);
  if (version !== decoded.version) return expiredPage();

  // Ghost projects are never shareable (see share.js).
  const { ghost } = await loadRegistry(env);
  if (ghost.has(decoded.project)) return expiredPage();

  // Mint a fresh session cookie with the TTL from the share token.
  const cookieToken = await signToken(env.COOKIE_SECRET, decoded.project, decoded.ttl, version);
  const dest = new URL(decoded.next, new URL(request.url).origin).href;
  return redirectResponse(dest, 302, {
    'set-cookie': authCookie(cookieName(decoded.project), cookieToken, decoded.ttl),
  });
};

function expiredPage() {
  const body = `<a class="skip-link" href="#main-expired">Skip to content</a>
${brandHeader()}
<main class="login-wrap" id="main-expired" tabindex="-1">
  <section class="login-card" aria-labelledby="expired-title">
    <p class="login-kicker">Share link</p>
    <h1 id="expired-title">Link expired or invalid</h1>
    <p class="login-lede">This share link has expired or is no longer valid. Ask the person who shared it for a new link.</p>
    <p class="login-note"><a href="/">Back to the gallery</a></p>
  </section>
</main>`;
  const html = shellLayout({ title: 'Share link expired — Artifacts', body, noindex: true });
  return new Response(html, {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...shellSecurity(),
    },
  });
}
