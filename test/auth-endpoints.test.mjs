import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost as loginPost } from '../functions/login.js';
import { onRequestGet as ghostGet, onRequestPost as ghostPost } from '../functions/ghost.js';
import { onRequestGet as logoutGet } from '../functions/logout.js';
import {
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
  cookieName,
  pwVersion,
  readCookie,
  verifyToken,
} from '../functions/_auth.js';
import { MemoryBucket } from './helpers/fakes.mjs';

const SECRET = 'endpoints-test-secret';
const ORIGIN = 'https://artifacts.example.test';

function formRequest(path, fields) {
  return new Request(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

function getRequest(path, headers = {}) {
  return new Request(ORIGIN + path, { headers });
}

test('login issues a password-versioned cookie and redirects to next', async () => {
  const env = { COOKIE_SECRET: SECRET, PW_VERUPS: 'verup-password' };
  const response = await loginPost({
    request: formRequest('/login', { project: 'verups', password: 'verup-password', next: '/verups/report' }),
    env,
  });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')).pathname, '/verups/report');
  const setCookie = response.headers.get('set-cookie');
  const session = readCookie(setCookie, cookieName('verups'));
  assert.ok(session);
  const version = await pwVersion(SECRET, 'verup-password');
  assert.equal(await verifyToken(SECRET, session, 'verups', version), true);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Max-Age=15552000/);
});

test('login failures redirect back to /login without a cookie', async () => {
  const env = { COOKIE_SECRET: SECRET, PW_VERUPS: 'verup-password' };
  for (const [fields, extraEnv] of [
    [{ project: 'verups', password: 'wrong', next: '/verups' }, {}],
    [{ project: 'verups', password: 'verup-password' }, { COOKIE_SECRET: undefined }],
    [{ project: 'unknown', password: 'x' }, {}],
  ]) {
    const response = await loginPost({ request: formRequest('/login', fields), env: { ...env, ...extraEnv } });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/login');
    assert.equal(location.searchParams.get('error'), '1');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('login sanitizes open-redirect next targets', async () => {
  const env = { COOKIE_SECRET: SECRET, PW_VERUPS: 'verup-password' };
  const response = await loginPost({
    request: formRequest('/login', { project: 'verups', password: 'verup-password', next: '//evil.test' }),
    env,
  });
  assert.equal(new URL(response.headers.get('location')).origin, new URL(ORIGIN).origin);
});

test('ghost unlock form and master-password POST set the ghost cookie', async () => {
  const env = { COOKIE_SECRET: SECRET, GHOST_MASTER_PW: 'ghost-password' };

  const form = await ghostGet({ request: getRequest('/ghost', { Accept: 'text/html' }), env });
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Ghost mode/);
  assert.match(form.headers.get('cache-control'), /no-store/);

  const wrong = await ghostPost({
    request: formRequest('/ghost', { password: 'nope', next: '/ghost/' }),
    env,
  });
  assert.equal(wrong.status, 302);
  assert.equal(new URL(wrong.headers.get('location')).searchParams.get('error'), '1');

  const ok = await ghostPost({
    request: formRequest('/ghost', { password: 'ghost-password', next: '/ghost/' }),
    env,
  });
  assert.equal(ok.status, 302);
  const setCookie = ok.headers.get('set-cookie');
  const token = readCookie(setCookie, GHOST_COOKIE_NAME);
  assert.ok(token);
  assert.equal(
    await verifyToken(SECRET, token, GHOST_PROJECT, await pwVersion(SECRET, 'ghost-password')),
    true,
  );
});

test('ghost page redirects authenticated users to the canonical gallery URL', async () => {
  const env = { COOKIE_SECRET: SECRET, GHOST_MASTER_PW: 'ghost-password' };
  const token = await (await import('../functions/_auth.js')).signToken(
    SECRET,
    GHOST_PROJECT,
    3600,
    await pwVersion(SECRET, 'ghost-password'),
  );
  const cookie = GHOST_COOKIE_NAME + '=' + token;

  const bare = await ghostGet({ request: getRequest('/ghost', { Cookie: cookie }), env, next: async () => new Response('next') });
  assert.equal(bare.status, 302);
  assert.equal(new URL(bare.headers.get('location')).pathname, '/ghost/');

  let nextCalled = 0;
  const canonical = await ghostGet({
    request: getRequest('/ghost/', { Cookie: cookie }),
    env,
    next: async () => {
      nextCalled++;
      return new Response('next');
    },
  });
  assert.equal(canonical.status, 200);
  assert.equal(nextCalled, 1);
});

test('logout clears project and ghost cookies in one response', async () => {
  const response = await logoutGet({
    request: getRequest('/logout?project=verups&ghost=1&next=/verups/'),
    env: {},
  });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')).pathname, '/verups/');
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.some((cookie) => cookie.startsWith(cookieName('verups') + '=') && /Max-Age=0/.test(cookie)));
  assert.ok(cookies.some((cookie) => cookie.startsWith(GHOST_COOKIE_NAME + '=') && /Max-Age=0/.test(cookie)));
});

test('logout sanitizes the next target', async () => {
  const response = await logoutGet({ request: getRequest('/logout?next=https://evil.test'), env: {} });
  assert.equal(new URL(response.headers.get('location')).origin, new URL(ORIGIN).origin);
});
