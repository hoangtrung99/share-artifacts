import assert from 'node:assert/strict';
import test from 'node:test';
import { signToken, cookieName, pwVersion } from '../functions/_auth.js';
import { onRequest } from '../functions/api/reviews.js';

const ORIGIN = 'https://artifacts.example.test';
const SCOPE = '?project=verups&artifact=verup-dashboard-prototype-2026-10-08';
const SECRET = 'test-only-signing-secret';

class MemoryBucket {
  objects = new Map();
  async put(key, value, options) {
    this.objects.set(key, { value, options });
    return { key };
  }
  async get(key) {
    const object = this.objects.get(key);
    return object ? { text: async () => object.value } : null;
  }
  async list({ prefix, limit, cursor }) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort();
    const offset = Number(cursor || 0);
    const page = keys.slice(offset, offset + limit);
    const truncated = offset + page.length < keys.length;
    return { objects: page.map(key => ({ key })), truncated, cursor: truncated ? String(offset + page.length) : undefined };
  }
}

function payload(overrides = {}) {
  return {
    title: 'Verup dashboard design review', version: 2, designDate: '2026-10-08',
    dataMode: 'illustrative', reviewer: '',
    boards: [{ id: 'overview', title: 'Overview' }],
    notes: [{ widget: 'app-errors', title: 'Application errors', decision: 'change', comment: 'Keep the service breakdown.' }],
    ...overrides,
  };
}

const PASSWORD = 'test-only-project-password';

async function projectToken(password = PASSWORD, ttl) {
  const version = await pwVersion(SECRET, password);
  return version && signToken(SECRET, 'verups', ttl, version);
}

async function fixture() {
  const env = { ARTIFACTS: new MemoryBucket(), COOKIE_SECRET: SECRET, PW_VERUPS: PASSWORD };
  const token = await projectToken();
  const headers = { Cookie: `${cookieName('verups')}=${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' };
  const call = (method = 'GET', body, extra = {}) => {
    const { scope = SCOPE, headers: extraHeaders = {}, ...options } = extra;
    const request = new Request(ORIGIN + '/api/reviews' + scope, {
      method, headers: { ...headers, ...extraHeaders },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      ...options,
    });
    return onRequest({ request, env });
  };
  return { env, headers, call };
}

test('GET and POST require the existing signed project cookie', async () => {
  const { call } = await fixture();
  for (const method of ['GET', 'POST']) {
    assert.equal((await call(method, method === 'POST' ? payload() : undefined, { headers: { Cookie: '' } })).status, 401);
    const version = await pwVersion(SECRET, PASSWORD);
    for (const token of [
      await signToken(SECRET, 'other', undefined, version),
      await signToken(SECRET, 'verups', -1, version),
      await signToken(SECRET, 'verups', undefined, await pwVersion(SECRET, 'old-password')),
      'forged.signature',
    ]) {
      assert.equal((await call(method, method === 'POST' ? payload() : undefined, { headers: { Cookie: `${cookieName('verups')}=${token}` } })).status, 401);
    }
  }
});

test('missing auth or storage configuration fails closed', async () => {
  for (const key of ['ARTIFACTS', 'COOKIE_SECRET', 'PW_VERUPS']) {
    const { env, call } = await fixture();
    delete env[key];
    assert.equal((await call('POST', payload())).status, 503);
  }
});

test('POST requires same-origin JSON and bounds the actual request stream', async () => {
  const { call } = await fixture();
  for (const Origin of ['', 'https://other.example.test', 'null']) {
    assert.equal((await call('POST', payload(), { headers: { Origin } })).status, 403);
  }
  assert.equal((await call('POST', payload(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('POST', '{')).status, 400);
  assert.equal((await call('POST', payload(), { headers: { 'Content-Length': '524289' } })).status, 413);
  assert.equal((await call('POST', 'x'.repeat(524289))).status, 413);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('x'.repeat(300000)));
    controller.enqueue(encoder.encode('x'.repeat(224289)));
    controller.close();
  } });
  assert.equal((await call('POST', undefined, { body: stream, duplex: 'half' })).status, 413);
});

test('scope and payload validation reject traversal and malformed feedback', async () => {
  const { call, env } = await fixture();
  for (const scope of ['', '?project=other&artifact=verup-dashboard-prototype-2026-10-08', '?project=verups&artifact=../other']) {
    assert.equal((await call('POST', payload(), { scope })).status, 400);
  }
  const invalid = [
    null, [], payload({ reviewer: 'a'.repeat(81) }), payload({ test: 'true' }),
    payload({ notes: [] }), payload({ notes: Array.from({ length: 51 }, (_, index) => ({ ...payload().notes[0], widget: `widget-${index}` })) }),
    payload({ notes: [{ ...payload().notes[0], comment: 'a'.repeat(8001) }] }),
    payload({ notes: [{ ...payload().notes[0], decision: 'approve' }] }),
    payload({ notes: [{ ...payload().notes[0], widget: '../other' }] }),
    payload({ notes: [payload().notes[0], payload().notes[0]] }),
    payload({ boards: [{ id: 'overview', title: 'Overview' }, { id: 'overview', title: 'Duplicate' }] }),
  ];
  for (const body of invalid) assert.equal((await call('POST', body)).status, 400);
  assert.equal(env.ARTIFACTS.objects.size, 0);
});

test('rotating PW_VERUPS revokes reviewer sessions (password-version binding)', async () => {
  const { call } = await fixture();
  const oldVersion = await pwVersion(SECRET, 'previously-used-password');
  const staleToken = await signToken(SECRET, 'verups', undefined, oldVersion);
  const response = await call('GET', undefined, {
    headers: { Cookie: `${cookieName('verups')}=${staleToken}` },
  });
  assert.equal(response.status, 401);
});

test('a revised review preserves original notes alongside replacement and added panels', async () => {
  const { call } = await fixture();
  const notes = [
    ...Array.from({ length: 47 }, (_, index) => ({
      widget: `original-${index}`, title: `Original panel ${index}`, decision: 'keep', comment: '',
    })),
    ...['edge-customer', 'edge-admin', 'redshift-maintenance'].map(widget => ({
      widget, title: widget, decision: 'change', comment: 'Review the revised panel.',
    })),
  ];
  assert.equal((await call('POST', payload({ notes }))).status, 201);
  const submitted = await (await call()).json();
  assert.deepEqual(submitted.reviews[0].notes, notes);
});

test('feedback is append-only, returns a receipt and preserves notes on authenticated GET', async () => {
  const { call, env } = await fixture();
  const body = payload({ reviewer: 'Shuku', ignored: 'not stored', notes: [{ ...payload().notes[0], comment: 'Góp ý: thêm độ trễ p95.' }] });
  const first = await call('POST', body);
  const second = await call('POST', body);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const firstReceipt = await first.json();
  const secondReceipt = await second.json();
  assert.notEqual(firstReceipt.id, secondReceipt.id);
  assert.ok(Number.isFinite(Date.parse(firstReceipt.receivedAt)));
  assert.equal(env.ARTIFACTS.objects.size, 2);
  const list = await (await call()).json();
  assert.equal(list.reviews.length, 2);
  assert.deepEqual(list.reviews[0].notes, body.notes);
  assert.equal(list.reviews[0].ignored, undefined);
  assert.equal(list.reviews[0].project, 'verups');
  assert.equal(list.cursor, null);
  assert.ok([...env.ARTIFACTS.objects.keys()].every(key => key.startsWith('reviews/verups/verup-dashboard-prototype-2026-10-08/')));
});

test('QA submissions use a separate prefix and are excluded from ordinary retrieval', async () => {
  const { call, env } = await fixture();
  await call('POST', payload({ test: true, reviewer: 'QA' }));
  await call('POST', payload({ test: false, reviewer: 'Shuku' }));
  const normal = await (await call()).json();
  const qa = await (await call('GET', undefined, { scope: SCOPE + '&test=1' })).json();
  assert.deepEqual(normal.reviews.map(review => review.reviewer), ['Shuku']);
  assert.deepEqual(qa.reviews.map(review => review.reviewer), ['QA']);
  assert.ok([...env.ARTIFACTS.objects.keys()].some(key => key.startsWith('reviews/_tests/verups/')));
});

test('GET bounds the page size and follows R2 cursors', async () => {
  const { call } = await fixture();
  for (let index = 0; index < 3; index++) await call('POST', payload({ reviewer: `Reviewer ${index}` }));
  const first = await (await call('GET', undefined, { scope: SCOPE + '&limit=2' })).json();
  assert.equal(first.reviews.length, 2);
  assert.ok(first.cursor);
  const next = await (await call('GET', undefined, { scope: SCOPE + '&limit=2&cursor=' + encodeURIComponent(first.cursor) })).json();
  assert.equal(next.reviews.length, 1);
  assert.equal(next.cursor, null);
  for (const limit of ['0', '101', 'abc', '1.5']) {
    assert.equal((await call('GET', undefined, { scope: SCOPE + '&limit=' + limit })).status, 400);
  }
});

test('storage failures return a generic error and unsupported methods cannot mutate', async () => {
  const { call, env } = await fixture();
  env.ARTIFACTS.put = async () => { throw new Error('sensitive storage details'); };
  const response = await call('POST', payload());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('sensitive'));
  env.ARTIFACTS.list = async () => { throw new Error('sensitive storage details'); };
  assert.equal((await call()).status, 503);
  const unsupported = await call('DELETE');
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, POST');
});
