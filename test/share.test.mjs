import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/share.js';
import { onRequestGet } from '../functions/s/[token].js';
import {
  authCookie,
  cookieName,
  pwVersion,
  signShareToken,
  signToken,
  verifyShareToken,
  verifyToken,
  readCookie,
} from '../functions/_auth.js';
import { MemoryBucket } from './helpers/fakes.mjs';

const SECRET = 'share-test-secret';
const ORIGIN = 'https://artifacts.example.test';

function envFor({ password = 'verup-password' } = {}) {
  const bucket = new MemoryBucket({
    'meta/catalog.json': { version: 1, updatedAt: null, projects: {} },
    'meta/protected.json': ['verups', 'ghosty'],
    'meta/ghost.json': ['ghosty'],
  });
  return {
    bucket,
    env: {
      ARTIFACTS: bucket,
      COOKIE_SECRET: SECRET,
      PW_VERUPS: password,
      PW_GHOSTY: 'ghost-password',
    },
  };
}

async function projectCookie(project, password) {
  const version = await pwVersion(SECRET, password);
  return authCookie(cookieName(project), await signToken(SECRET, project, 3600, version), 3600);
}

function shareRequest(body, headers = {}) {
  return new Request(ORIGIN + '/share', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('share mints a versioned link for an authenticated project', async () => {
  const { env } = envFor();
  const cookie = (await projectCookie('verups', 'verup-password')).split(';')[0];
  const response = await onRequestPost({
    request: shareRequest({ project: 'verups', path: '/verups/report', ttl: '24h' }, { Cookie: cookie }),
    env,
  });
  assert.equal(response.status, 200);
  const { url } = await response.json();
  const token = url.split('/s/')[1];
  const decoded = await verifyShareToken(SECRET, token);
  assert.equal(decoded.project, 'verups');
  assert.equal(decoded.next, '/verups/report');
  assert.equal(decoded.ttl, 24 * 60 * 60);
  assert.equal(decoded.version, await pwVersion(SECRET, 'verup-password'));
});

test('share rejects cross-origin, unauthenticated and invalid requests', async () => {
  const { env } = envFor();
  const body = { project: 'verups', path: '/verups', ttl: '30d' };

  const crossOrigin = await onRequestPost({
    request: shareRequest(body, { Origin: 'https://evil.example.test' }),
    env,
  });
  assert.equal(crossOrigin.status, 403);

  const unauthenticated = await onRequestPost({ request: shareRequest(body), env });
  assert.equal(unauthenticated.status, 401);

  const invalidJson = await onRequestPost({
    request: shareRequest('{nope', {
      Origin: ORIGIN,
      Cookie: (await projectCookie('verups', 'verup-password')).split(';')[0],
    }),
    env,
  });
  assert.equal(invalidJson.status, 400);

  const missingProject = await onRequestPost({ request: shareRequest({ project: '' }, { Origin: ORIGIN }), env });
  assert.equal(missingProject.status, 400);
});

test('share accepts same-origin requests when Origin is omitted but Sec-Fetch-Site is same-origin', async () => {
  const { env } = envFor();
  const request = shareRequest(
    { project: 'verups', path: '/verups', ttl: '24h' },
    {
      Cookie: (await projectCookie('verups', 'verup-password')).split(';')[0],
      'Sec-Fetch-Site': 'same-origin',
    },
  );
  request.headers.delete('origin');
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 200);
});

test('ghost projects cannot be share-linked', async () => {
  const { env } = envFor();
  const request = shareRequest(
    { project: 'ghosty', path: '/ghosty', ttl: '24h' },
    {
      Cookie: (await projectCookie('ghosty', 'ghost-password')).split(';')[0],
      'Sec-Fetch-Site': 'same-origin',
    },
  );
  request.headers.delete('origin');
  const response = await onRequestPost({ request, env });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Ghost projects cannot be shared/);
});

test('redeeming a share link mints a session cookie with the link TTL', async () => {
  const { env } = envFor();
  const cookie = (await projectCookie('verups', 'verup-password')).split(';')[0];
  const minted = await onRequestPost({
    request: shareRequest({ project: 'verups', path: '/verups/report', ttl: '7d' }, { Cookie: cookie }),
    env,
  });
  const token = (await minted.json()).url.split('/s/')[1];

  const response = await onRequestGet({
    request: new Request(ORIGIN + '/s/' + token),
    env,
    params: { token },
  });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')).pathname, '/verups/report');
  const setCookie = response.headers.get('set-cookie');
  const session = readCookie(setCookie, cookieName('verups'));
  assert.ok(session);
  assert.equal(await verifyToken(SECRET, session, 'verups', await pwVersion(SECRET, 'verup-password')), true);
  assert.match(setCookie, /Max-Age=604800/);
});

test('share links stop working after a password rotation or for ghost projects', async () => {
  const { env } = envFor();
  const token = await signShareToken(
    SECRET,
    'verups',
    '/verups/report',
    3600,
    await pwVersion(SECRET, 'verup-password'),
  );
  const rotated = { ...env, PW_VERUPS: 'new-password' };
  const rotatedResponse = await onRequestGet({
    request: new Request(ORIGIN + '/s/' + token),
    env: rotated,
    params: { token },
  });
  assert.equal(rotatedResponse.status, 410);

  const ghostToken = await signShareToken(
    SECRET,
    'ghosty',
    '/ghosty',
    3600,
    await pwVersion(SECRET, 'ghost-password'),
  );
  const ghostResponse = await onRequestGet({
    request: new Request(ORIGIN + '/s/' + ghostToken),
    env,
    params: { token: ghostToken },
  });
  assert.equal(ghostResponse.status, 410);
});

test('share rejects oversized request bodies', async () => {
  const { env } = envFor();
  const cookie = (await projectCookie('verups', 'verup-password')).split(';')[0];
  const response = await onRequestPost({
    request: shareRequest('x'.repeat(20 * 1024), { Cookie: cookie, 'Content-Type': 'application/json' }),
    env,
  });
  assert.equal(response.status, 413);
});

test('invalid share tokens return the 410 page', async () => {
  const { env } = envFor();
  for (const token of ['garbage', 'a.b']) {
    const response = await onRequestGet({
      request: new Request(ORIGIN + '/s/' + token),
      env,
      params: { token },
    });
    assert.equal(response.status, 410);
    assert.match(await response.text(), /Link expired or invalid/);
  }
});
