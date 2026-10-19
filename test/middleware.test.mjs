import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest, resetRedirectCache } from '../functions/_middleware.js';
import { resetStoreCaches } from '../functions/_store.js';
import {
  authCookie,
  cookieName,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
  signToken,
  pwVersion,
} from '../functions/_auth.js';
import { MemoryBucket, makeContext } from './helpers/fakes.mjs';

const SECRET = 'test-cookie-secret';

async function setup({ protectedProjects = [], ghostProjects = [], redirects = null, env = {} } = {}) {
  const objects = {
    'meta/protected.json': protectedProjects,
    'meta/ghost.json': ghostProjects,
  };
  if (redirects) objects['meta/redirect-map.json'] = redirects;
  const bucket = new MemoryBucket(objects);
  return {
    bucket,
    env: {
      ARTIFACTS: bucket,
      COOKIE_SECRET: SECRET,
      PW_VERUPS: 'verup-password',
      PW_BOTH: 'both-password',
      GHOST_MASTER_PW: 'ghost-password',
      ...env,
    },
  };
}

async function projectCookie(project, password, { ttl = 3600 } = {}) {
  const version = await pwVersion(SECRET, password);
  return authCookie(cookieName(project), await signToken(SECRET, project, ttl, version), ttl);
}

async function ghostCookie(password = 'ghost-password', { ttl = 3600 } = {}) {
  const version = await pwVersion(SECRET, password);
  return authCookie(GHOST_COOKIE_NAME, await signToken(SECRET, GHOST_PROJECT, ttl, version), ttl);
}

function run(url, options = {}) {
  resetStoreCaches();
  resetRedirectCache();
  const { env } = options;
  const context = makeContext({
    url: 'https://artifacts.example.test' + url,
    method: options.method || 'GET',
    headers: options.headers || {},
    env,
  });
  return onRequest(context).then((response) => ({ response, context }));
}

test('public and shell routes pass through to next()', async () => {
  const { env } = await setup();
  for (const url of ['/', '/api/catalog', '/login', '/assets/site.css', '/ghost/']) {
    const { response, context } = await run(url, { env });
    assert.equal(response.status, 200, url);
    assert.equal(context.nextCalls.length, 1, url);
  }
});

test('protected project redirects document requests to /login with next+project', async () => {
  const { env } = await setup({ protectedProjects: ['verups'] });
  const { response, context } = await run('/verups/report?q=1', {
    env,
    headers: { Accept: 'text/html' },
  });
  assert.equal(context.nextCalls.length, 0);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('project'), 'verups');
  assert.equal(location.searchParams.get('next'), '/verups/report?q=1');
});

test('protected project returns 401 for non-document requests', async () => {
  const { env } = await setup({ protectedProjects: ['verups'] });
  const { response } = await run('/verups/report.html', {
    env,
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('valid project cookie passes through; stale version does not', async () => {
  const { env } = await setup({ protectedProjects: ['verups'] });
  const cookie = await projectCookie('verups', 'verup-password');
  const valid = await run('/verups/report', {
    env,
    headers: { Accept: 'text/html', Cookie: cookie.split(';')[0] },
  });
  assert.equal(valid.context.nextCalls.length, 1);
  assert.equal(valid.response.status, 200);

  const oldVersionCookie = authCookie(
    cookieName('verups'),
    await signToken(SECRET, 'verups', 3600, await pwVersion(SECRET, 'old-password')),
    3600,
  );
  const stale = await run('/verups/report', {
    env,
    headers: { Accept: 'text/html', Cookie: oldVersionCookie.split(';')[0] },
  });
  assert.equal(stale.context.nextCalls.length, 0);
  assert.equal(stale.response.status, 302);

  const wrongProject = authCookie(
    cookieName('other'),
    await signToken(SECRET, 'other', 3600, await pwVersion(SECRET, 'x')),
    3600,
  );
  const wrong = await run('/verups/report', {
    env,
    headers: { Accept: 'text/html', Cookie: wrongProject.split(';')[0] },
  });
  assert.equal(wrong.context.nextCalls.length, 0);
  assert.equal(wrong.response.status, 302);
});

test('ghost projects require the master cookie and redirect documents to /ghost', async () => {
  const { env } = await setup({ ghostProjects: ['games'] });
  const denied = await run('/games/', { env, headers: { Accept: 'text/html' } });
  assert.equal(denied.response.status, 302);
  assert.equal(new URL(denied.response.headers.get('location')).pathname, '/ghost/');

  const cookie = await ghostCookie();
  const allowed = await run('/games/', {
    env,
    headers: { Accept: 'text/html', Cookie: cookie.split(';')[0] },
  });
  assert.equal(allowed.context.nextCalls.length, 1);
});

test('ghost + protected requires both cookies, in order', async () => {
  const { env } = await setup({ ghostProjects: ['both'], protectedProjects: ['both'] });
  const ghostOnly = await run('/both/', {
    env,
    headers: { Accept: 'text/html', Cookie: (await ghostCookie()).split(';')[0] },
  });
  assert.equal(ghostOnly.response.status, 302);
  assert.equal(new URL(ghostOnly.response.headers.get('location')).pathname, '/login');
  assert.equal(new URL(ghostOnly.response.headers.get('location')).searchParams.get('project'), 'both');

  const both = await run('/both/', {
    env,
    headers: {
      Accept: 'text/html',
      Cookie: [
        (await ghostCookie()).split(';')[0],
        (await projectCookie('both', 'both-password')).split(';')[0],
      ].join('; '),
    },
  });
  assert.equal(both.context.nextCalls.length, 1);
});

test('a protected project with a missing password fails closed (403)', async () => {
  const { env } = await setup({ protectedProjects: ['locked'] });
  const { response, context } = await run('/locked/report', { env, headers: { Accept: 'text/html' } });
  assert.equal(context.nextCalls.length, 0);
  assert.equal(response.status, 403);
});

test('malformed percent-encoding never throws (no 500)', async () => {
  const { env } = await setup();
  for (const url of ['/%zz/a', '/%E0%A4%A/report', '/%']) {
    const { response, context } = await run(url, { env, headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200, url);
    assert.equal(context.nextCalls.length, 1, url);
  }
});

test('redirect map returns a 301 for old paths before auth', async () => {
  const { env } = await setup({
    redirects: { 'old/report': 'verups/new-report' },
    protectedProjects: ['verups'],
  });
  const { response, context } = await run('/old/report', { env, headers: { Accept: 'text/html' } });
  assert.equal(context.nextCalls.length, 0);
  assert.equal(response.status, 301);
  assert.equal(new URL(response.headers.get('location')).pathname, '/verups/new-report');
});

test('?ghost=1 redirects GET/HEAD to the ghost unlock page, not POST', async () => {
  const { env } = await setup();
  const get = await run('/guides/?ghost=1', { env });
  assert.equal(get.response.status, 302);
  assert.equal(new URL(get.response.headers.get('location')).pathname, '/ghost/');

  const post = await run('/share?ghost=1', { env, method: 'POST', headers: { Accept: 'text/html' } });
  assert.equal(post.response.status, 200);
});
