// Shared auth helpers for the signed-cookie scheme.
//
// Leading underscore = NOT routed (same convention as _middleware.js), so importing this
// never creates a public /_auth endpoint. Imported by _middleware.js and login.js so the
// SNAKE() key derivation, the HMAC token format, and the constant-time password compare can
// never drift between "issue a cookie" (login) and "trust a cookie" (middleware).
//
// Token format (cookie value cf_auth_<project>):
//   base64url(payloadJson) "." base64url(hmacSha256(COOKIE_SECRET, payloadJson))
// payload = { p: <project>, exp: <epoch-seconds>, v: <password-version> }
//
// v binds the cookie to the CURRENT project password. Rotating PW_<PROJECT> changes its
// fingerprint, so every previously issued cookie (and share link) stops verifying — a password
// change now revokes old sessions instead of leaving them valid for the full 180-day TTL.
// A token without v is rejected (fail-closed); the migration is a one-time re-login.

export const COOKIE_PREFIX = 'cf_auth_';
export const TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days
// Ghost mode: a single master password (env GHOST_MASTER_PW) unlocks all ghost (hidden)
// projects. The cookie cf_ghost is signed with the same COOKIE_SECRET, using GHOST_PROJECT
// as the payload's project binding so verifyToken's project-match check is reused —
// a forged token signed for a real project won't pass the __ghost__ binding check.
export const GHOST_COOKIE_NAME = 'cf_ghost';
export const GHOST_PROJECT = '__ghost__';
export const GHOST_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days — shorter than per-project (180d)

// Share-link TTL options (seconds). The chosen TTL controls BOTH how long the share link
// stays valid AND how long the recipient's session cookie lasts after redemption — so "24h"
// means 24h of access, not 24h to open the link then 180d of access.
export const SHARE_TTL_OPTIONS = {
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60, // default
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

// --- password versions -------------------------------------------------------
// Short, stable fingerprint of (COOKIE_SECRET, password). It is stored in signed tokens so a
// password rotation invalidates every token bound to the previous password. Cached per isolate
// because the same two or three secrets are read on every request.
const VERSION_CACHE_LIMIT = 64;
const versionCache = new Map();

/**
 * @param {string} secret
 * @param {string} password
 * @returns {Promise<string>} 22-char base64url fingerprint
 */
export async function pwVersion(secret, password) {
  const key = secret + '\u0000' + String(password);
  const cached = versionCache.get(key);
  if (cached) return cached;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    enc.encode('artifacts-auth-version-v1\u0000' + key),
  );
  const version = bytesToB64url(new Uint8Array(digest)).slice(0, 22);
  versionCache.set(key, version);
  if (versionCache.size > VERSION_CACHE_LIMIT) {
    versionCache.delete(versionCache.keys().next().value);
  }
  return version;
}

/**
 * Constant-time-ish password comparison. Both inputs are hashed first so the compare never
 * short-circuits on length (which used to leak password length through timing).
 * @param {string} secret
 * @param {string} given
 * @param {string | undefined} expected
 */
export async function passwordMatches(secret, given, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([
    pwVersion(secret, String(given).slice(0, 4096)),
    pwVersion(secret, String(expected)),
  ]);
  return timingSafeEqual(a, b);
}

/**
 * @param {string} a
 * @param {string} b
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
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

/**
 * Sign a token binding `project` (and the current password version) for TTL seconds.
 * @param {string} secret
 * @param {string} project
 * @param {number} [ttl]
 * @param {string} version - output of pwVersion(); required, fail-closed
 * @returns {Promise<string>} cookie value
 */
export async function signToken(secret, project, ttl = TOKEN_TTL_SECONDS, version = '') {
  if (!secret || !version) throw new Error('signToken requires a secret and password version');
  const payload = JSON.stringify({
    p: project,
    exp: Math.floor(Date.now() / 1000) + ttl,
    v: version,
  });
  const payloadB64 = bytesToB64url(enc.encode(payload));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return payloadB64 + '.' + bytesToB64url(sig);
}

/**
 * Sign a share link token binding `project` → `next` path for `ttl` seconds.
 * Payload adds `n` (next redirect target), `t` (session TTL to grant on redemption) and
 * `v` (password version at mint time; redemption rejects a link if the password has rotated).
 * @param {string} secret
 * @param {string} project
 * @param {string} next
 * @param {number} ttl
 * @param {string} version
 */
export async function signShareToken(secret, project, next, ttl, version = '') {
  if (!secret || !version) throw new Error('signShareToken requires a secret and password version');
  const payload = JSON.stringify({
    p: project,
    exp: Math.floor(Date.now() / 1000) + ttl,
    n: next,
    t: ttl,
    v: version,
  });
  const payloadB64 = bytesToB64url(enc.encode(payload));
  const key = await importKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return payloadB64 + '.' + bytesToB64url(sig);
}

/**
 * Verify a share link token. Returns { project, next, ttl, version } on success, null otherwise.
 * Checks: signature valid, not expired, required fields present. Does NOT check the password
 * version — the redeem endpoint compares it with the project's current password.
 * @param {string} secret
 * @param {string} token
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
  if (typeof payload?.v !== 'string' || !payload.v) return null;
  return {
    project: payload.p,
    next: typeof payload.n === 'string' ? payload.n : '/' + payload.p + '/',
    ttl: payload.t,
    version: payload.v,
  };
}

/**
 * Verify a cookie token. Returns true only if: signature valid (constant-time via
 * crypto.subtle.verify), not expired, payload project === expected project, and the password
 * version matches the current password. Missing expected version → fail-closed.
 * @param {string} secret
 * @param {string} token
 * @param {string} expectedProject
 * @param {string} expectedVersion
 */
export async function verifyToken(secret, token, expectedProject, expectedVersion) {
  if (!secret || !token || !expectedVersion) return false;
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
  return payload.v === expectedVersion;
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

/** Serialize an HttpOnly session cookie. */
export function authCookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** Serialize a cookie-clearing header for the given cookie name. */
export function clearAuthCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
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
