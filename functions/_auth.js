// Shared auth helpers for the signed-cookie scheme.
//
// Leading underscore = NOT routed (same convention as _middleware.js), so importing this
// never creates a public /_auth endpoint. Imported by _middleware.js and login.js so the
// SNAKE() key derivation, the HMAC token format, and the constant-time password compare can
// never drift between "issue a cookie" (login) and "trust a cookie" (middleware).
//
// Token format (cookie value cf_auth_<project>):
//   base64url(payloadJson) "." base64url(hmacSha256(COOKIE_SECRET, payloadJson))
// payload = { p: <project>, exp: <epoch-seconds> }
// On verify: recompute HMAC over the payload segment, constant-time compare to the supplied
// signature, then check exp > now AND payload.p === the path's project. Forged/expired/
// mismatched -> reject. No COOKIE_SECRET -> cannot verify -> reject (fail-closed at call site).

export const COOKIE_PREFIX = 'cf_auth_';
export const TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

// Share-link TTL options (seconds). The chosen TTL controls BOTH how long the share link
// stays valid AND how long the recipient's session cookie lasts after redemption — so "24h"
// means 24h of access, not 24h to open the link then 180d of access.
export const SHARE_TTL_OPTIONS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,   // default
  '180d': 180 * 24 * 60 * 60,
};
export const SHARE_TTL_DEFAULT = '30d';
export function shareTtl(key) {
  return SHARE_TTL_OPTIONS[key] ?? SHARE_TTL_OPTIONS[SHARE_TTL_DEFAULT];
}

// Env-var key for a project's password. MUST match protect.sh:
//   tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g'  ->  uppercase, non-[A-Z0-9] -> '_'.
export function snake(name) {
  return String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
export function pwKey(name) {
  return 'PW_' + snake(name);
}
// Cookie name per the URL contract: cf_auth_<project>. snake() only enforces char-safety
// (non-[A-Z0-9] -> '_'); we lowercase it back so the name reads cf_auth_verups (matching the
// literal contract), not cf_auth_VERUPS. Both set (login) and read (middleware) go through this
// one helper, so case can never drift between issuing and trusting a cookie.
export function cookieName(project) {
  return COOKIE_PREFIX + snake(project).toLowerCase();
}

// Constant-time string compare (used for the password). crypto.subtle.verify covers the
// signature path; this covers the user-supplied password vs the env secret.
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (ab.length !== bb.length) return false;
  let r = 0;
  for (let i = 0; i < ab.length; i++) r |= ab[i] ^ bb[i];
  return r === 0;
}

// --- base64url (no padding) over bytes, URL/cookie safe ---
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();

async function importKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Sign a token binding `project` for TTL seconds. Returns the cookie value string. */
export async function signToken(secret, project, ttl = TOKEN_TTL_SECONDS) {
  const payload = JSON.stringify({ p: project, exp: Math.floor(Date.now() / 1000) + ttl });
  const payloadB64 = bytesToB64url(enc.encode(payload));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return payloadB64 + '.' + bytesToB64url(sig);
}

/**
 * Sign a share link token binding `project` → `next` path for `ttl` seconds.
 * Payload adds `n` (next redirect target) and `t` (session TTL to grant on redemption) so the
 * redeem endpoint can mint a session cookie whose duration matches the chosen share duration —
 * a 24h share link gives 24h of access, not the full login TTL.
 * Reuses the same HMAC-SHA256 + base64url format as signToken, so no new crypto path.
 */
export async function signShareToken(secret, project, next, ttl) {
  const payload = JSON.stringify({
    p: project,
    exp: Math.floor(Date.now() / 1000) + ttl,
    n: next,
    t: ttl,
  });
  const payloadB64 = bytesToB64url(enc.encode(payload));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return payloadB64 + '.' + bytesToB64url(sig);
}

/**
 * Verify a share link token. Returns { project, next, ttl } on success, null otherwise.
 * Checks: signature valid, not expired. Does NOT check project match (the redeem endpoint
 * doesn't have an "expected project" — it derives everything from the token).
 */
export async function verifyShareToken(secret, token) {
  if (!secret || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let sigBytes;
  try {
    sigBytes = b64urlToBytes(sigB64);
  } catch {
    return null;
  }
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (typeof payload?.p !== 'string' || !payload.p) return null;
  if (typeof payload?.t !== 'number' || payload.t <= 0) return null;
  return {
    project: payload.p,
    next: typeof payload.n === 'string' ? payload.n : '/' + payload.p + '/',
    ttl: payload.t,
  };
}

/**
 * Verify a cookie token. Returns true only if: signature valid (constant-time via
 * crypto.subtle.verify), not expired, and payload project === expected project.
 */
export async function verifyToken(secret, token, expectedProject) {
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let sigBytes;
  try {
    sigBytes = b64urlToBytes(sigB64);
  } catch {
    return false;
  }
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
  if (!ok) return false;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return false;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return false;
  if (payload.p !== expectedProject) return false;
  return true;
}

/** Read a named cookie from a Cookie header. Returns '' if absent. */
export function readCookie(header, name) {
  if (!header) return '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/**
 * Sanitize a `next` redirect target against open-redirect. Only same-origin absolute paths
 * are allowed: must start with a single '/' and not '//' (protocol-relative) or '/\'.
 * Anything else falls back to `fallback`.
 */
export function safeNext(next, fallback = '/') {
  if (typeof next !== 'string' || next.length === 0) return fallback;
  if (next[0] !== '/') return fallback;
  if (next[1] === '/' || next[1] === '\\') return fallback;
  return next;
}
