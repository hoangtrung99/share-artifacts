import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/catalog.js';
import { resetStoreCaches } from '../functions/_store.js';
import {
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
  authCookie,
  cookieName,
  pwVersion,
  signToken,
} from '../functions/_auth.js';
import { MemoryBucket } from './helpers/fakes.mjs';

const SECRET = 'catalog-test-secret';
const ORIGIN = 'https://artifacts.example.test';

function fixture(overrides = {}) {
  const bucket = new MemoryBucket({
    'meta/catalog.json': {
      version: 1,
      updatedAt: '2026-10-18T00:00:00.000Z',
      projects: {
        guides: {
          files: [
            { file: 'a.html', routePath: 'guides/a', type: 'html', title: 'A', uploadedAt: '2026-10-18T04:00:00.000Z', uploadedAtReliable: true, artifactDate: null },
            { file: 'b.md', routePath: 'guides/b', type: 'md', title: 'B', uploadedAt: '2026-10-17T04:00:00.000Z', uploadedAtReliable: true, artifactDate: null },
          ],
        },
        verups: {
          files: [{ file: 'secret.html', routePath: 'verups/secret', type: 'html', title: 'Secret', uploadedAt: '2026-10-16T04:00:00.000Z', uploadedAtReliable: true, artifactDate: null, tags: [] }],
        },
        games: {
          files: [{ file: 'poker.html', routePath: 'games/poker', type: 'html', title: 'Poker', tags: [] }],
        },
      },
    },
    'meta/protected.json': ['verups'],
    'meta/ghost.json': ['games'],
  });
  return {
    bucket,
    env: {
      ARTIFACTS: bucket,
      COOKIE_SECRET: SECRET,
      PW_VERUPS: 'verup-password',
      GHOST_MASTER_PW: 'ghost-password',
      ...overrides,
    },
  };
}

async function get(query, { env, headers = {} } = {}) {
  resetStoreCaches();
  return onRequestGet({
    request: new Request(ORIGIN + '/api/catalog' + query, { headers }),
    env,
  });
}

test('public catalog lists public projects only, without protected file counts', async () => {
  const { env } = fixture();
  const response = await get('', { env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const data = await response.json();
  const names = data.projects.map((project) => project.name);
  assert.deepEqual(names.sort(), ['guides', 'verups']);
  const guides = data.projects.find((project) => project.name === 'guides');
  assert.equal(guides.count, 2);
  assert.equal(guides.protected, false);
  const verups = data.projects.find((project) => project.name === 'verups');
  assert.equal(verups.protected, true);
  assert.equal(verups.count, null);
});

test('a valid ghost cookie reveals ghost projects', async () => {
  const { env } = fixture();
  const version = await pwVersion(SECRET, 'ghost-password');
  const token = await signToken(SECRET, GHOST_PROJECT, 3600, version);
  const cookie = authCookie(GHOST_COOKIE_NAME, token, 3600).split(';')[0];
  const response = await get('', { env, headers: { Cookie: cookie } });
  const data = await response.json();
  assert.ok(data.projects.some((project) => project.name === 'games' && project.ghost === true));
});

test('project detail is fail-closed for protected and ghost projects', async () => {
  const { env } = fixture();
  assert.equal((await get('?project=verups', { env })).status, 401);
  assert.equal((await get('?project=games', { env })).status, 401);

  const missingSecret = fixture({ PW_VERUPS: undefined });
  assert.equal((await get('?project=verups', { env: missingSecret.env })).status, 403);
});

test('authenticated project detail returns upload-time fields', async () => {
  const { env } = fixture();
  const version = await pwVersion(SECRET, 'verup-password');
  const token = await signToken(SECRET, 'verups', 3600, version);
  const cookie = authCookie(cookieName('verups'), token, 3600).split(';')[0];
  const response = await get('?project=verups', { env, headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.protected, true);
  assert.equal(data.files.length, 1);
  assert.match(data.files[0].uploadedAt, /T/);
});

test('a rotated password rejects previously issued catalog sessions', async () => {
  const { env } = fixture();
  const oldVersion = await pwVersion(SECRET, 'old-password');
  const token = await signToken(SECRET, 'verups', 3600, oldVersion);
  const cookie = authCookie(cookieName('verups'), token, 3600).split(';')[0];
  assert.equal((await get('?project=verups', { env, headers: { Cookie: cookie } })).status, 401);
});
