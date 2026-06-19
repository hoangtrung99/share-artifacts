// GET /s/:token — redeem a share link.
//
// Validates the share token, mints a FRESH session cookie with the TTL baked into the token
// (so a 24h share link grants 24h of access, not the full 180d login TTL), sets it, and
// 302-redirects to the clean artifact URL. The token never appears in the final page URL,
// browser history, Referer, or edge logs — only in the original link the sharer controls.
//
// Invalid/expired token → 410 Gone with a styled error page (not a bare 404 — the recipient
// should understand what happened).
//
// The /s first-segment is not a protected folder, so the middleware passes it through.

import { verifyShareToken, signToken, cookieName } from '../_auth.js';

export const onRequestGet = async ({ request, env, params }) => {
  const token = params.token;

  if (!env.COOKIE_SECRET || !token) return expiredPage();

  const decoded = await verifyShareToken(env.COOKIE_SECRET, token);
  if (!decoded) return expiredPage();

  // Mint a fresh session cookie with the TTL from the share token.
  const cookieToken = await signToken(env.COOKIE_SECRET, decoded.project, decoded.ttl);
  const cookie =
    `${cookieName(decoded.project)}=${cookieToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${decoded.ttl}`;

  const dest = new URL(decoded.next, new URL(request.url).origin).href;
  return new Response(null, {
    status: 302,
    headers: { Location: dest, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
  });
};

function expiredPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share link expired — Artifacts</title><style>
:root{--bg:#fff;--surface:#fff;--border:#e4e7ec;--text:#1a1d23;--muted:#5b6472;--accent:#2563eb;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--surface:#161b22;--border:#2a313c;--text:#e6e9ee;--muted:#9aa4b2;--accent:#6ea8fe}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:2rem}
.card{max-width:420px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.75rem;text-align:center}
.kicker{font-size:.72rem;font-weight:600;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:.2rem .6rem;display:inline-block;margin:0 0 .9rem}
h1{font-size:1.4rem;margin:0 0 .5rem}
p{color:var(--muted);font-size:.95rem;margin:0 0 1.25rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
</style></head><body><div class="card"><span class="kicker">⏳ Share link</span><h1>Link expired or invalid</h1><p>This share link has expired or is no longer valid. Ask the person who shared it for a new link.</p><a href="/">Go to gallery →</a></div></body></html>`;
  return new Response(html, {
    status: 410,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
