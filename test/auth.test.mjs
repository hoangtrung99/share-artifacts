import assert from 'node:assert/strict';
import test from 'node:test';
import {
  signToken,
  verifyToken,
  signShareToken,
  verifyShareToken,
  pwVersion,
  passwordMatches,
  safeNext,
  readCookie,
  authCookie,
  clearAuthCookie,
  snake,
  pwKey,
  cookieName,
  shareTtl,
  TOKEN_TTL_SECONDS,
} from '../functions/_auth.js';

const SECRET = 'unit-test-signing-secret';
const PASSWORD = 'correct horse battery staple';
const enc = new TextEncoder();

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** Forge an HMAC-signed token with an arbitrary payload (for legacy/tamper tests). */
async function forgeToken(secret, payload) {
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return payloadB64 + '.' + b64url(signature);
}

test('cookie names and env keys follow the documented contract', () => {
  assert.equal(snake('my-project 2'), 'MY_PROJECT_2');
  assert.equal(pwKey('my-project'), 'PW_MY_PROJECT');
  assert.equal(cookieName('My-Project'), 'cf_auth_my_project');
  assert.equal(shareTtl('24h'), 24 * 60 * 60);
  assert.equal(shareTtl('bogus'), shareTtl('30d'));
});

test('pwVersion is stable, password-specific and secret-specific', async () => {
  const a = await pwVersion(SECRET, PASSWORD);
  const b = await pwVersion(SECRET, PASSWORD);
  const otherPassword = await pwVersion(SECRET, PASSWORD + 'x');
  const otherSecret = await pwVersion('another-secret', PASSWORD);
  assert.equal(a, b);
  assert.equal(a.length, 22);
  assert.notEqual(a, otherPassword);
  assert.notEqual(a, otherSecret);
});

test('passwordMatches hashes both sides and rejects missing/incorrect values', async () => {
  assert.equal(await passwordMatches(SECRET, PASSWORD, PASSWORD), true);
  assert.equal(await passwordMatches(SECRET, 'wrong', PASSWORD), false);
  assert.equal(await passwordMatches(SECRET, PASSWORD, undefined), false);
  assert.equal(await passwordMatches(SECRET, PASSWORD, ''), false);
  // Different lengths must not throw or leak via short-circuit comparison.
  assert.equal(await passwordMatches(SECRET, 'a'.repeat(4096), PASSWORD), false);
});

test('session tokens verify only for the bound project and password version', async () => {
  const version = await pwVersion(SECRET, PASSWORD);
  const token = await signToken(SECRET, 'verups', 60, version);

  assert.equal(await verifyToken(SECRET, token, 'verups', version), true);
  assert.equal(await verifyToken(SECRET, token, 'other', version), false);
  assert.equal(await verifyToken(SECRET, token, 'verups', 'stale-version'), false);
  assert.equal(await verifyToken(SECRET, token, 'verups', ''), false);
});

test('expired and tampered session tokens are rejected', async () => {
  const version = await pwVersion(SECRET, PASSWORD);
  const expired = await signToken(SECRET, 'verups', -1, version);
  assert.equal(await verifyToken(SECRET, expired, 'verups', version), false);

  const token = await signToken(SECRET, 'verups', 60, version);
  const [payload, signature] = token.split('.');
  const tampered = payload + '.' + signature.slice(0, -2) + (signature.endsWith('A') ? 'BB' : 'AA');
  assert.equal(await verifyToken(SECRET, tampered, 'verups', version), false);
  assert.equal(await verifyToken(SECRET, 'not-a-token', 'verups', version), false);
});

test('legacy tokens without a password version are rejected (one-time re-login)', async () => {
  const payload = { p: 'verups', exp: Math.floor(Date.now() / 1000) + 60 };
  const legacy = await forgeToken(SECRET, payload);
  const version = await pwVersion(SECRET, PASSWORD);
  assert.equal(await verifyToken(SECRET, legacy, 'verups', version), false);
});

test('changing the password invalidates previously issued sessions', async () => {
  const oldVersion = await pwVersion(SECRET, 'old-password');
  const newVersion = await pwVersion(SECRET, 'new-password');
  const token = await signToken(SECRET, 'verups', 60, oldVersion);
  assert.equal(await verifyToken(SECRET, token, 'verups', oldVersion), true);
  assert.equal(await verifyToken(SECRET, token, 'verups', newVersion), false);
});

test('signToken refuses to sign without a version (fail closed)', async () => {
  await assert.rejects(() => signToken(SECRET, 'verups', 60, ''), /password version/);
});

test('share tokens round-trip with project, next path, ttl and version', async () => {
  const version = await pwVersion(SECRET, PASSWORD);
  const token = await signShareToken(SECRET, 'verups', '/verups/report', 3600, version);
  const decoded = await verifyShareToken(SECRET, token);
  assert.deepEqual(decoded, { project: 'verups', next: '/verups/report', ttl: 3600, version });

  assert.equal(await verifyShareToken('other-secret', token), null);
  assert.equal(await verifyShareToken(SECRET, token + 'x'), null);

  const expired = await signShareToken(SECRET, 'verups', '/verups', -1, version);
  assert.equal(await verifyShareToken(SECRET, expired), null);

  const versionless = await forgeToken(SECRET, {
    p: 'verups',
    exp: Math.floor(Date.now() / 1000) + 60,
    n: '/verups',
    t: 60,
  });
  assert.equal(await verifyShareToken(SECRET, versionless), null);
});

test('safeNext blocks open redirects and keeps same-origin paths', () => {
  assert.equal(safeNext('/verups/a', '/'), '/verups/a');
  assert.equal(safeNext('//evil.test', '/fallback'), '/fallback');
  assert.equal(safeNext('/\\evil.test', '/fallback'), '/fallback');
  assert.equal(safeNext('https://evil.test', '/fallback'), '/fallback');
  assert.equal(safeNext('', '/fallback'), '/fallback');
  assert.equal(safeNext(null, '/fallback'), '/fallback');
});

test('cookie helpers and readCookie round-trip', () => {
  const header = 'a=1; ' + cookieName('verups') + '=abc.def; b=2';
  assert.equal(readCookie(header, cookieName('verups')), 'abc.def');
  assert.equal(readCookie(header, 'missing'), '');
  assert.equal(readCookie('', 'x'), '');

  const set = authCookie('cf_auth_x', 'token', 3600);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Max-Age=3600/);
  assert.match(clearAuthCookie('cf_auth_x'), /Max-Age=0/);
});

test('documented TTL default is 180 days', () => {
  assert.equal(TOKEN_TTL_SECONDS, 180 * 24 * 60 * 60);
});
