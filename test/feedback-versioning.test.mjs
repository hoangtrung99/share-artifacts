import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest as contentRoute } from '../functions/[[path]].js';
import { onRequest as revisionsRoute } from '../functions/api/revisions.js';
import {
  addRevision,
  artifactIdFor,
  findRevision,
  normalizeRegistry,
  registryKey,
  resetRevisionCache,
  revisionKey,
  sha256Hex,
} from '../functions/_feedback-revisions.js';
import { normalizeAnchor } from '../functions/_feedback.js';
import { resetStoreCaches } from '../functions/_store.js';
import {
  assertCasEtag,
  assertConditionalPrecondition,
  r2PutTextConditional,
} from '../scripts/lib/r2-api.mjs';
import { assertSnapshotBytes, snapshotRevisionId } from '../scripts/lib/snapshot-bytes.mjs';
import {
  makeFeedbackEnv,
  projectCookie,
  revisionedArtifact,
} from './feedback-sqlite-helper.mjs';

const ORIGIN = 'https://artifacts.example.test';
const ADMIN = { 'x-feedback-admin': 'admin-secret' };
const HTML_V1 = '<!doctype html><title>Demo v1</title><p>old body alpha</p>';
const HTML_V2 = '<!doctype html><title>Demo v2</title><p>new body beta</p>';
const MD_V1 = '# Notes\n\nold markdown alpha\n';
const MD_V2 = '# Notes\n\nnew markdown beta\n';

async function versionEnv(overrides = {}) {
  const html = await revisionedArtifact({ project: 'demo', file: 'sample.html', versions: [HTML_V1, HTML_V2] });
  const md = await revisionedArtifact({ project: 'demo', file: 'notes.md', versions: [MD_V1, MD_V2] });
  const env = makeFeedbackEnv(
    {
      ...html.objects,
      ...md.objects,
      'content/demo/sample.html': HTML_V2,
      'content/demo/notes.md': MD_V2,
    },
    { FEEDBACK_ADMIN_TOKEN: 'admin-secret', ...overrides },
  );
  return { html, md, env };
}

function contentContext(path, { env, method = 'GET', headers = {} }) {
  return {
    request: new Request(`${ORIGIN}/${path}`, { method, headers }),
    env,
    params: { path: path.split('?')[0] },
    next: async () => new Response('next'),
    data: {},
  };
}

async function fetchContent(path, { env, method = 'GET', headers = {}, reset = true } = {}) {
  if (reset) {
    resetStoreCaches();
    resetRevisionCache();
  }
  const response = await contentRoute(contentContext(path, { env, method, headers }));
  return { response, text: await response.text() };
}

async function fetchRevisions(query, { env, headers = {} } = {}) {
  resetStoreCaches();
  resetRevisionCache();
  const request = new Request(`${ORIGIN}/api/revisions?${new URLSearchParams(query)}`, { headers });
  const response = await revisionsRoute({
    request,
    env,
    params: {},
    next: async () => new Response('next'),
    data: {},
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { response, payload, text };
}

test('anchor context is stored verbatim so duplicate contexts stay disambiguated', async () => {
  // Regression: trimming prefix/suffix removed meaningful boundary whitespace, shifting the
  // client's quote match and making duplicate-sentence anchors unanchored after reload.
  const prefix = 'a single control plane. ';
  const suffix = ' Vietnamese deployment notes.';
  const normalized = normalizeAnchor({
    version: 1,
    type: 'text',
    exact: 'Run one replica',
    prefix,
    suffix,
    start: 10,
    end: 25,
  });
  assert.equal(normalized.exact, 'Run one replica');
  assert.equal(normalized.prefix, prefix); // trailing space preserved
  assert.equal(normalized.suffix, suffix); // leading space preserved

  // Same duplicate sentence, two occurrences: the raw windows (not offsets) disambiguate them.
  const first = normalizeAnchor({
    version: 1,
    type: 'text',
    exact: 'Duplicate sentence.',
    prefix: 'a single control plane. ',
    suffix: ' Vietnamese',
    start: 0,
    end: 18,
  });
  const second = normalizeAnchor({
    version: 1,
    type: 'text',
    exact: 'Duplicate sentence.',
    prefix: 'end of section one',
    suffix: ' a single control plane.',
    start: 100,
    end: 118,
  });
  assert.ok(first && second);
  assert.equal(first.prefix, 'a single control plane. ');
  assert.equal(second.suffix, ' a single control plane.');
  assert.notEqual(`${first.prefix}\u0000${first.suffix}`, `${second.prefix}\u0000${second.suffix}`);

  // `exact` is verbatim too: selection edge whitespace is preserved (not trimmed).
  const spaced = normalizeAnchor({ version: 1, type: 'text', exact: '  Run one replica  ', prefix: '', suffix: '' });
  assert.equal(spaced.exact, '  Run one replica  ');

  // Bounds still enforced on the raw captured strings.
  assert.equal(normalizeAnchor({ version: 1, type: 'text', exact: 'x', prefix: 'p'.repeat(161), suffix: '' }), null);
  assert.equal(normalizeAnchor({ version: 1, type: 'text', exact: '   ', prefix: '', suffix: '' }), null);
});

test('snapshot identity is byte-exact: invalid UTF-8 0xFF is not EF BF BD', async () => {
  // Regression for the string round-trip hash bug: a lone 0xFF byte decodes to U+FFFD and
  // re-encodes as EF BF BD. Hashing the decoded string would accept the wrong object for the
  // revision id; hashing exact bytes keeps them distinct.
  const original = Buffer.from([0x41, 0xff, 0x42]); // A, invalid lone 0xFF, B
  const stringRoundTrip = Buffer.from(original.toString('utf8'), 'utf8'); // A, EF BF BD, B
  assert.ok(stringRoundTrip.includes(Buffer.from([0xef, 0xbf, 0xbd])));

  const originalId = await snapshotRevisionId(original);
  const roundTripId = await snapshotRevisionId(stringRoundTrip);
  assert.notEqual(roundTripId, originalId);

  await assert.rejects(assertSnapshotBytes(stringRoundTrip, originalId), /refusing to overwrite/);
  await assert.doesNotReject(assertSnapshotBytes(original, originalId));
  await assert.rejects(snapshotRevisionId('a decoded string'), /requires bytes/);
  assert.match(originalId, /^[0-9a-f]{64}$/);
});

test('conditional writes require a real precondition (no unconditional downgrade)', async () => {
  assert.throws(() => assertConditionalPrecondition({}), /requires an If-Match/);
  assert.throws(() => assertConditionalPrecondition({ ifMatch: null }), /requires an If-Match/);
  assert.throws(() => assertConditionalPrecondition({ ifMatch: '   ' }), /requires an If-Match/);
  assert.throws(() => assertConditionalPrecondition({ ifNoneMatch: 'not-a-star' }), /requires an If-Match/);
  assert.doesNotThrow(() => assertConditionalPrecondition({ ifMatch: '"etag-1"' }));
  assert.doesNotThrow(() => assertConditionalPrecondition({ ifNoneMatch: '*' }));
  // The REST helper validates before any credential/network access.
  await assert.rejects(r2PutTextConditional('meta/revisions/x.json', '{}'), /requires an If-Match/);
});

test('a manifest fetched for CAS must carry an ETag', async () => {
  assert.throws(
    () => assertCasEtag({ missing: false, etag: null }, 'meta/revisions/x.json'),
    /returned no ETag/,
  );
  assert.throws(
    () => assertCasEtag({ missing: false, etag: '' }, 'meta/revisions/x.json'),
    /returned no ETag/,
  );
  assert.doesNotThrow(() => assertCasEtag({ missing: false, etag: '"etag-1"' }, 'k'));
  assert.doesNotThrow(() => assertCasEtag({ missing: true, etag: null }, 'k')); // create path
});

test('registry helpers: ids, derived latest pointer, generation/publication fields, idempotent adds', async () => {
  const artifactId = await artifactIdFor('demo', 'sample.html');
  assert.equal(artifactId, await artifactIdFor('demo', 'sample.html'));
  assert.notEqual(artifactId, await artifactIdFor('demo', 'sample.md'));

  const revisionA = await sha256Hex(HTML_V1);
  const revisionB = await sha256Hex(HTML_V2);
  const base = {
    schemaVersion: 1,
    artifactId,
    project: 'demo',
    file: 'sample.html',
    type: 'html',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    generation: 3,
    publicationId: 'pub-3',
    latestRevisionId: revisionA,
    latestRevisionNumber: 1,
    revisions: [{ revisionId: revisionA, number: 1, size: 10, contentType: 'text/html', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'deliver', publicationId: 'pub-1' }],
  };
  const normalized = normalizeRegistry({
    ...base,
    latestRevisionId: revisionB,
    latestRevisionNumber: 9,
    tombstone: true,
    tombstonedAt: '2026-10-02T00:00:00.000Z',
  });
  assert.equal(normalized.latestRevisionId, revisionA);
  assert.equal(normalized.latestRevisionNumber, 1);
  assert.equal(normalized.generation, 3);
  assert.equal(normalized.tombstone, true);

  const first = addRevision(normalized, { revisionId: revisionB, size: 20, publicationId: 'pub-4' });
  assert.equal(first.added, true);
  assert.equal(first.revision.number, 2);
  assert.equal(first.revision.publicationId, 'pub-4');
  assert.equal(first.registry.latestRevisionId, revisionB);

  const again = addRevision(first.registry, { revisionId: revisionA, size: 10 });
  assert.equal(again.added, false);
  assert.equal(again.registry.revisions.length, 2);
  assert.equal(findRevision(again.registry, revisionB).number, 2);
  assert.equal(findRevision(again.registry, 'z'.repeat(64)), null);
});

test('default raw serving uses the latest immutable snapshot with bounded caching', async () => {
  const { html, env } = await versionEnv();
  const served = await fetchContent('demo/sample.html', { env });
  assert.equal(served.response.status, 200);
  assert.equal(served.text, HTML_V2);
  // Unpublish/revocation must take effect promptly: no `immutable` long cache.
  assert.match(served.response.headers.get('cache-control'), /public, max-age=300/);
  assert.doesNotMatch(served.response.headers.get('cache-control'), /immutable/);
  assert.equal(served.response.headers.get('etag'), `"r-${html.latest.revisionId}"`);
  assert.equal(served.response.headers.get('x-artifact-revision'), html.latest.revisionId);

  const revalidated = await fetchContent('demo/sample.html', {
    env,
    headers: { 'If-None-Match': `"r-${html.latest.revisionId}"` },
  });
  assert.equal(revalidated.response.status, 304);
});

test('?rev serves the pinned immutable snapshot', async () => {
  const { html, env } = await versionEnv();
  const old = html.revisions[0];
  const pinned = await fetchContent(`demo/sample.html?rev=${old.revisionId}`, { env });
  assert.equal(pinned.response.status, 200);
  assert.equal(pinned.text, HTML_V1);
  assert.equal(pinned.response.headers.get('etag'), `"r-${old.revisionId}"`);
  assert.match(pinned.response.headers.get('cache-control'), /public, max-age=300/);

  const latest = await fetchContent(`demo/sample.html?rev=${html.latest.revisionId}`, { env });
  assert.equal(latest.text, HTML_V2);
});

test('unknown or malformed revisions are 404 and never fall back to latest', async () => {
  const { env } = await versionEnv();
  for (const revision of ['f'.repeat(64), 'not-a-revision', '']) {
    const missing = await fetchContent(`demo/sample.html?rev=${revision}`, { env });
    assert.equal(missing.response.status, 404, `rev=${revision}`);
    assert.match(missing.response.headers.get('content-type'), /text\/html/);
  }
});

test('legacy artifacts without a manifest still serve mutable content', async () => {
  const env = makeFeedbackEnv();
  const raw = await fetchContent('demo/sample.html', { env });
  assert.equal(raw.response.status, 200);
  assert.match(raw.text, /Hello reviewers/);
  assert.match(raw.response.headers.get('cache-control'), /public, max-age=300/);
  assert.equal(raw.response.headers.get('x-artifact-revision'), null);

  const viewer = await fetchContent('demo/sample', { env });
  assert.equal(viewer.response.status, 200);
  assert.match(viewer.text, /src="\/demo\/sample\.html"/);
  assert.doesNotMatch(viewer.text, /src="\/demo\/sample\.html\?rev=/);
});

test('viewer pins the iframe/download to the latest revision (and to ?rev when given)', async () => {
  const { html, env } = await versionEnv();
  const old = html.revisions[0];

  // Default view: canonical URL, but every embedded view is pinned to the latest revision.
  const latestView = await fetchContent('demo/sample', { env });
  assert.equal(latestView.response.status, 200);
  assert.match(latestView.text, new RegExp(`src="/demo/sample\\.html\\?rev=${html.latest.revisionId}"`));

  const pinnedView = await fetchContent(`demo/sample?rev=${old.revisionId}`, { env });
  assert.equal(pinnedView.response.status, 200);
  assert.match(pinnedView.text, new RegExp(`src="/demo/sample\\.html\\?rev=${old.revisionId}"`));

  const unknownView = await fetchContent(`demo/sample?rev=${'f'.repeat(64)}`, { env });
  assert.equal(unknownView.response.status, 404);
});

test('markdown viewer renders the pinned snapshot bytes', async () => {
  const { md, env } = await versionEnv();
  const old = md.revisions[0];

  const defaultView = await fetchContent('demo/notes', { env });
  assert.match(defaultView.text, /new markdown beta/);
  assert.doesNotMatch(defaultView.text, /old markdown alpha/);

  const pinnedView = await fetchContent(`demo/notes?rev=${old.revisionId}`, { env });
  assert.equal(pinnedView.response.status, 200);
  assert.match(pinnedView.text, /old markdown alpha/);
  assert.doesNotMatch(pinnedView.text, /new markdown beta/);
  assert.match(pinnedView.text, new RegExp(`href="/demo/notes\\.md\\?rev=${old.revisionId}"`));

  const pinnedRaw = await fetchContent(`demo/notes.md?rev=${old.revisionId}`, { env });
  assert.equal(pinnedRaw.text, MD_V1);
});

test('tombstoned artifacts are 404 before any 304/cache evaluation', async () => {
  const { html, env } = await versionEnv();
  const tombstoned = { ...html.registry, tombstone: true, tombstonedAt: '2026-10-19T00:00:00.000Z' };
  env.ARTIFACTS.putRaw(registryKey(html.artifactId), tombstoned);

  const raw = await fetchContent('demo/sample.html', { env, headers: { 'If-None-Match': `"r-${html.latest.revisionId}"` } });
  assert.equal(raw.response.status, 404);
  const pinned = await fetchContent(`demo/sample.html?rev=${html.revisions[0].revisionId}`, { env });
  assert.equal(pinned.response.status, 404);
  const viewer = await fetchContent('demo/sample', { env });
  assert.equal(viewer.response.status, 404);

  const revisions = await fetchRevisions({ project: 'demo', file: 'sample.html' }, { env, headers: ADMIN });
  assert.equal(revisions.response.status, 404);
});

test('protected snapshots are never publicly cacheable', async () => {
  const { html, env } = await versionEnv({ PW_DEMO: 'secret' });
  const old = html.revisions[0];
  const raw = await fetchContent(`demo/sample.html?rev=${old.revisionId}`, { env });
  assert.equal(raw.response.status, 200);
  assert.match(raw.response.headers.get('cache-control'), /private, no-store/);
});

test('revisions API requires review access and exposes history', async () => {
  const { html, env } = await versionEnv();
  const anonymous = await fetchRevisions({ project: 'demo', file: 'sample.html' }, { env });
  assert.equal(anonymous.response.status, 403);
  assert.equal(anonymous.payload.code, 'forbidden');

  const listed = await fetchRevisions({ project: 'demo', file: 'sample.html' }, { env, headers: ADMIN });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.artifactId, html.artifactId);
  assert.equal(listed.payload.total, 2);
  assert.equal(listed.payload.artifact.revisioningEnabled, true);
  assert.equal(listed.payload.artifact.routePath, 'demo/sample');
  assert.equal(listed.payload.latest.revisionId, html.latest.revisionId);
  assert.deepEqual(
    listed.payload.revisions.map((revision) => [revision.number, revision.isLatest]),
    [[1, false], [2, true]],
  );
  assert.equal(listed.payload.revisions[1].size, Buffer.byteLength(HTML_V2, 'utf8'));
  assert.equal(listed.payload.current.source, 'registry');

  const byArtifact = await fetchRevisions({ artifact: html.artifactId }, { env, headers: ADMIN });
  assert.equal(byArtifact.payload.total, 2);

  const unknown = await fetchRevisions({ project: 'demo', file: 'missing.html' }, { env, headers: ADMIN });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.payload.code, 'artifact_unknown');

  const mismatched = await fetchRevisions({ artifact: 'f'.repeat(32), project: 'demo', file: 'sample.html' }, { env, headers: ADMIN });
  assert.equal(mismatched.response.status, 404);
});

test('revisions API: protected gate, project cookie read, legacy empty history', async () => {
  const { env } = await versionEnv({ PW_DEMO: 'secret' });
  const anonymous = await fetchRevisions({ project: 'demo', file: 'sample.html' }, { env });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.code, 'auth_required');

  const authorized = await fetchRevisions(
    { project: 'demo', file: 'sample.html' },
    { env, headers: { cookie: await projectCookie('demo', 'secret') } },
  );
  assert.equal(authorized.response.status, 200);
  assert.equal(authorized.payload.total, 2);

  // Legacy artifact (no manifest): empty history + content-hash "current", reads need access.
  const legacyEnv = makeFeedbackEnv({}, { FEEDBACK_ADMIN_TOKEN: 'admin-secret' });
  const legacy = await fetchRevisions({ project: 'demo', file: 'sample.html' }, { env: legacyEnv, headers: ADMIN });
  assert.equal(legacy.response.status, 200);
  assert.equal(legacy.payload.total, 0);
  assert.equal(legacy.payload.latest, null);
  assert.equal(legacy.payload.artifact.revisioningEnabled, false);
  assert.equal(legacy.payload.current.source, 'content');
  assert.equal(
    legacy.payload.current.revisionId,
    await sha256Hex('<!doctype html><title>Demo</title><p>Hello reviewers.</p>'),
  );
});

test('cached manifest misses are refreshed before answering 404/legacy', async () => {
  const env = makeFeedbackEnv({}, { FEEDBACK_ADMIN_TOKEN: 'admin-secret' });
  // First request caches "no manifest" for this artifact.
  const before = await fetchContent('demo/sample.html', { env });
  assert.match(before.text, /Hello reviewers/);

  const fixture = await revisionedArtifact({ project: 'demo', file: 'sample.html', versions: [HTML_V1, HTML_V2] });
  env.ARTIFACTS.putRaw(registryKey(fixture.artifactId), fixture.registry);
  env.ARTIFACTS.putRaw(revisionKey(fixture.artifactId, fixture.latest.revisionId, 'html'), HTML_V2);

  // Same isolate cache (no reset): the miss must be refreshed, not served as legacy content.
  const after = await fetchContent('demo/sample.html', { env, reset: false });
  assert.equal(after.text, HTML_V2);
});

test('content serving is unaffected when FEEDBACK_DB is not bound', async () => {
  const { html, env } = await versionEnv();
  delete env.FEEDBACK_DB;
  const raw = await fetchContent(`demo/sample.html?rev=${html.revisions[0].revisionId}`, { env });
  assert.equal(raw.response.status, 200);
  assert.equal(raw.text, HTML_V1);
});
