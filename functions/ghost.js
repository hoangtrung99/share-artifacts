// GET  /ghost      — master password unlock for hidden (ghost) projects.
//                    Without a valid cf_ghost cookie → render the login form (inline HTML).
//                    With a valid cf_ghost cookie → next() (falls through to static ghost.astro gallery).
// POST /ghost      — verify master password, issue cf_ghost signed cookie, 302 to /ghost.
//
// The cookie cf_ghost is HMAC-signed with COOKIE_SECRET (same crypto path as per-project auth),
// using GHOST_PROJECT ('__ghost__') as the payload's project binding. verifyToken's project-match
// check is reused — a token forged for a real project won't pass the __ghost__ binding.
//
// Master password lives ONLY as the env secret GHOST_MASTER_PW (never in client code, never in
// git). Verified constant-time via safeEqual. Fail-closed: no GHOST_MASTER_PW or no COOKIE_SECRET
// → the POST returns 503 (cannot authenticate) and GET returns the form with a config error note.

import {
  signToken,
  verifyToken,
  readCookie,
  safeEqual,
  safeNext,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
  GHOST_TOKEN_TTL,
} from './_auth.js';

// --- HTML: login form (inline CSS matching site design tokens) ---
function loginPage(origin, hasError) {
  const errHtml = hasError
    ? `<p class="error show">Incorrect password. Please try again.</p>`
    : `<p class="error"></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>Ghost mode — Artifacts</title><style>
:root{--bg:#fff;--surface:#fff;--border:#e4e7ec;--text:#1a1d23;--muted:#5b6472;--accent:#2563eb;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--surface:#161b22;--border:#2a313c;--text:#e6e9ee;--muted:#9aa4b2;--accent:#6ea8fe}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:2rem}
.card{max-width:400px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.75rem}
.kicker{font-size:.72rem;font-weight:600;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:.2rem .6rem;display:inline-block;margin:0 0 .9rem}
h1{font-size:1.4rem;margin:0 0 .35rem;letter-spacing:-0.01em}
.lede{color:var(--muted);font-size:.95rem;margin:0 0 1.25rem}
.error{color:#e5484d;font-size:.88rem;margin:0 0 1rem;display:none}.error.show{display:block}
@media(prefers-color-scheme:dark){.error{color:#ff9b8f}}
form{display:flex;flex-direction:column;gap:.55rem}
label{font-size:.82rem;font-weight:600}
input{padding:.6rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:1rem;background:var(--bg);color:var(--text)}input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
button{padding:.65rem 1rem;font-size:.95rem;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;margin-top:.4rem}button:hover{filter:brightness(1.1)}
.note{color:var(--muted);font-size:.82rem;margin:1rem 0 0}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
</style></head><body><div class="card"><span class="kicker">👻 Ghost mode</span><h1>Hidden projects</h1><p class="lede">Enter the master password to reveal hidden projects.</p>${errHtml}<form method="POST" action="/ghost" autocomplete="off"><label for="pw">Master password</label><input id="pw" name="password" type="password" required autofocus autocomplete="current-password"><button type="submit">Unlock</button></form><p class="note"><a href="/">← Back to gallery</a></p></div></body></html>`;
}

// --- HTML: config error (GHOST_MASTER_PW or COOKIE_SECRET missing) ---
function configErrorPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ghost — Not configured</title><style>
body{margin:0;font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:2rem;color:#1a1d23}
@media(prefers-color-scheme:dark){body{background:#0e1116;color:#e6e9ee}}
.card{max-width:400px;text-align:center}.card h1{font-size:1.3rem}
.card p{opacity:.7;font-size:.9rem}
</style></head><body><div class="card"><h1>👻 Ghost mode not configured</h1><p>Ghost projects exist but the master password is not set. Contact the site owner.</p></div></body></html>`;
}

export const onRequestGet = async ({ request, env, next }) => {
  const url = new URL(request.url);

  // ?logout → clear cf_ghost cookie, redirect to home.
  if (url.searchParams.get('logout') === '1') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': `${GHOST_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Already authenticated?
  if (env.COOKIE_SECRET && env.GHOST_MASTER_PW) {
    const token = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
    if (await verifyToken(env.COOKIE_SECRET, token, GHOST_PROJECT)) {
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
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // Not authenticated → render login form.
  const hasError = url.searchParams.get('error') === '1';
  return new Response(loginPage(url.origin, hasError), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const onRequestPost = async ({ request, env }) => {
  const url = new URL(request.url);

  // Fail-closed: cannot authenticate without signing key or master password.
  if (!env.COOKIE_SECRET || !env.GHOST_MASTER_PW) {
    return Response.redirect(new URL('/ghost/', url).href, 302);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.redirect(new URL('/ghost/?error=1', url).href, 302);
  }

  const password = String(form.get('password') || '');
  const nextPath = safeNext(String(form.get('next') || ''), '/ghost/');

  if (!safeEqual(password, env.GHOST_MASTER_PW)) {
    return Response.redirect(new URL('/ghost/?error=1', url).href, 302);
  }

  const token = await signToken(env.COOKIE_SECRET, GHOST_PROJECT, GHOST_TOKEN_TTL);
  const cookie =
    `${GHOST_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${GHOST_TOKEN_TTL}`;

  const dest = new URL(nextPath, url).href;
  return new Response(null, {
    status: 302,
    headers: { Location: dest, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
  });
};
