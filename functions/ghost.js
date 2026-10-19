// GET  /ghost      — master password unlock for hidden (ghost) projects.
//                    Without a valid cf_ghost cookie → render the unlock form on the shared shell.
//                    With a valid cf_ghost cookie → next() (falls through to static ghost.astro gallery).
// POST /ghost      — verify master password, issue cf_ghost signed cookie, 302 to /ghost.
//
// The cookie cf_ghost is HMAC-signed with COOKIE_SECRET (same crypto path as per-project auth),
// using GHOST_PROJECT ('__ghost__') as the payload's project binding. Tokens also embed a
// fingerprint of the current master password, so changing GHOST_MASTER_PW revokes old cookies.
//
// Master password lives ONLY as the env secret GHOST_MASTER_PW (never in client code, never in
// git). Fail-closed: no GHOST_MASTER_PW or no COOKIE_SECRET → the POST returns 503-like redirect
// and GET returns the form with a config error note.

import {
  signToken,
  verifyToken,
  readCookie,
  passwordMatches,
  safeNext,
  pwVersion,
  authCookie,
  clearAuthCookie,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
  GHOST_TOKEN_TTL,
} from './_auth.js';
import { htmlResponse, redirectResponse } from './_http.js';
import { shellLayout, brandHeader, ghostModePill } from './_render.js';
import { icon } from './_ui.js';

// --- HTML: ghost unlock form on the shared shell (login-card vocabulary) ---
function loginPage(hasError) {
  const inputAttrs = hasError
    ? ' aria-invalid="true" aria-describedby="ghost-unlock-error"'
    : '';
  const body = `<a class="skip-link" href="#main-ghostauth">Skip to content</a>
${brandHeader(undefined, ghostModePill())}
<main class="login-wrap" id="main-ghostauth" tabindex="-1">
  <section class="login-card" aria-labelledby="ghost-unlock-title">
    <h1 id="ghost-unlock-title">Unlock <em>ghost mode</em></h1>
    <p class="login-lede">Enter the master password to see hidden projects on this device.</p>

    <p class="form-error" id="ghost-unlock-error" role="alert"${hasError ? '' : ' hidden'}>
      ${icon('alert')}
      <span>That password doesn’t match. Try again.</span>
    </p>

    <form class="login-form" method="POST" action="/ghost" autocomplete="off">
      <div class="field">
        <label class="field-label" for="ghost-password">Master password</label>
        <div class="input-wrap">
          <input class="text-input" id="ghost-password" name="password" type="password" required autofocus autocomplete="current-password"${inputAttrs}>
          <button class="pw-toggle" type="button" data-ghost-pw-toggle aria-label="Show password" aria-pressed="false">
            ${icon('eye', 'icon icon-on')}
            ${icon('eye-off', 'icon icon-off')}
          </button>
        </div>
      </div>
      <button class="btn btn--primary btn--block login-submit" type="submit">Unlock</button>
    </form>

    <p class="login-note">
      Ghost access lasts 7 days on this device. <a href="/">Back to gallery</a>
    </p>
  </section>
</main>`;
  return shellLayout({ title: 'Ghost mode — Artifacts', body, noindex: true });
}

// --- HTML: config error (GHOST_MASTER_PW or COOKIE_SECRET missing) ---
function configErrorPage() {
  const body = `<a class="skip-link" href="#main-ghost-config">Skip to content</a>
${brandHeader(undefined, ghostModePill())}
<main class="login-wrap" id="main-ghost-config" tabindex="-1">
  <section class="login-card" aria-labelledby="ghost-config-title">
    <p class="login-kicker">${icon('alert')} Configuration</p>
    <h1 id="ghost-config-title">Ghost mode not configured</h1>
    <p class="login-lede">Ghost projects exist, but the master password is not set. Contact the site owner.</p>
  </section>
</main>`;
  return shellLayout({ title: 'Ghost — Not configured', body, noindex: true });
}

export const onRequestGet = async ({ request, env, next }) => {
  const url = new URL(request.url);

  // ?logout → clear cf_ghost cookie, redirect to home.
  if (url.searchParams.get('logout') === '1') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': clearAuthCookie(GHOST_COOKIE_NAME),
        'Cache-Control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // Already authenticated?
  if (env.COOKIE_SECRET && env.GHOST_MASTER_PW) {
    const version = await pwVersion(env.COOKIE_SECRET, env.GHOST_MASTER_PW);
    const token = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
    if (await verifyToken(env.COOKIE_SECRET, token, GHOST_PROJECT, version)) {
      // Avoid the Pages static-asset 308 redirect from /ghost → /ghost/ by canonicalizing
      // the URL ourselves when the request comes in without a trailing slash.
      if (url.pathname === '/ghost') {
        return Response.redirect(new URL('/ghost/', url).href, 302);
      }
      return next(); // fall through to static ghost.astro gallery at /ghost/
    }
  }

  // Ghost projects exist but not configured → config error.
  if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) {
    return new Response(configErrorPage(), {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  // Not authenticated → render login form.
  const hasError = url.searchParams.get('error') === '1';
  return htmlResponse(loginPage(hasError), { cache: 'no-store' });
};

export const onRequestPost = async ({ request, env }) => {
  const url = new URL(request.url);

  // Fail-closed: cannot authenticate without signing key or master password.
  if (!env.COOKIE_SECRET || !env.GHOST_MASTER_PW) {
    return redirectResponse(new URL('/ghost/', url).href, 302);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return redirectResponse(new URL('/ghost/?error=1', url).href, 302);
  }

  const password = String(form.get('password') || '').slice(0, 4096);
  const nextPath = safeNext(String(form.get('next') || ''), '/ghost/');

  if (!(await passwordMatches(env.COOKIE_SECRET, password, env.GHOST_MASTER_PW))) {
    return redirectResponse(new URL('/ghost/?error=1', url).href, 302);
  }

  const version = await pwVersion(env.COOKIE_SECRET, env.GHOST_MASTER_PW);
  const token = await signToken(env.COOKIE_SECRET, GHOST_PROJECT, GHOST_TOKEN_TTL, version);
  const dest = new URL(nextPath, url).href;
  return redirectResponse(dest, 302, {
    'set-cookie': authCookie(GHOST_COOKIE_NAME, token, GHOST_TOKEN_TTL),
  });
};
