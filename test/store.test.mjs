import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyCatalog,
  listProjectFiles,
  loadCatalog,
  loadRegistry,
  loadUploadTimes,
  normalizeDateTime,
  resetStoreCaches,
  resolveArtifactTime,
  safeDecode,
} from '../functions/_store.js';
import { catalogFixture, MemoryBucket, makeEnv } from './helpers/fakes.mjs';

function reset() {
  resetStoreCaches();
}

test('safeDecode never throws on malformed percent-encoding', () => {
  assert.equal(safeDecode('verups'), 'verups');
  assert.equal(safeDecode('a%20b'), 'a b');
  assert.equal(safeDecode('%zz'), '%zz');
  assert.equal(safeDecode('%E0%A4%A'), '%E0%A4%A');
  assert.equal(safeDecode(null), '');
});

test('loadCatalog caches within the TTL and falls back to an empty catalog', async () => {
  reset();
  const bucket = new MemoryBucket({ 'meta/catalog.json': catalogFixture() });
  const env = makeEnv({ ARTIFACTS: bucket });

  const first = await loadCatalog(env);
  const second = await loadCatalog(env);
  assert.equal(first.projects.guides.files.length, 2);
  assert.equal(second, first);
  assert.equal(bucket.gets, 1);

  const broken = new MemoryBucket({ 'meta/catalog.json': '{not json' });
  reset();
  assert.deepEqual(await loadCatalog(makeEnv({ ARTIFACTS: broken })), emptyCatalog());
  reset();
  assert.deepEqual(await loadCatalog(makeEnv({ ARTIFACTS: new MemoryBucket() })), emptyCatalog());
});

test('loadRegistry caches protected and ghost names', async () => {
  reset();
  const bucket = new MemoryBucket({
    'meta/protected.json': ['verups'],
    'meta/ghost.json': ['games'],
  });
  const env = makeEnv({ ARTIFACTS: bucket });
  const first = await loadRegistry(env);
  const second = await loadRegistry(env);
  assert.deepEqual([...first.protected], ['verups']);
  assert.deepEqual([...first.ghost], ['games']);
  assert.equal(second.protected, first.protected);
  assert.equal(bucket.gets, 2);
});

test('loadUploadTimes paginates R2 list and caches per project', async () => {
  reset();
  const bucket = new MemoryBucket();
  for (let index = 0; index < 1005; index++) {
    bucket.putRaw(
      'content/big/file-' + String(index).padStart(4, '0') + '.html',
      'x',
      new Date(Date.UTC(2026, 9, 1, 0, 0, index % 60)),
    );
  }
  const env = makeEnv({ ARTIFACTS: bucket });
  const map = await loadUploadTimes(env, 'big');
  assert.equal(map.size, 1005);
  assert.equal(bucket.lists, 2);
  await loadUploadTimes(env, 'big');
  assert.equal(bucket.lists, 2);
});

test('loadUploadTimes returns an empty map when list fails', async () => {
  reset();
  const bucket = new MemoryBucket();
  bucket.list = async () => {
    throw new Error('R2 unavailable');
  };
  const map = await loadUploadTimes(makeEnv({ ARTIFACTS: bucket }), 'broken');
  assert.equal(map.size, 0);
});

test('normalizeDateTime normalizes date-only and full ISO values', () => {
  assert.equal(normalizeDateTime('2026-09-17'), '2026-09-17T00:00:00.000Z');
  assert.equal(normalizeDateTime('2026-09-17T06:30:00.000Z'), '2026-09-17T06:30:00.000Z');
  assert.equal(normalizeDateTime(''), '');
  assert.equal(normalizeDateTime(null), '');
  assert.equal(normalizeDateTime('not a date'), '');
});

test('resolveArtifactTime prefers reliable uploads, then artifact date, then legacy upload', () => {
  const reliable = resolveArtifactTime(
    { uploadedAt: '2026-10-01T00:00:00.000Z', uploadedAtReliable: true, artifactDate: '2026-01-01' },
    null,
  );
  assert.equal(reliable.sortDate, '2026-10-01T00:00:00.000Z');
  assert.equal(reliable.displayDate, '2026-10-01');
  assert.equal(reliable.displaySource, 'upload');

  const legacy = resolveArtifactTime(
    { uploadedAt: '2026-07-21T00:00:00.000Z', uploadedAtReliable: false, artifactDate: '2026-02-13' },
    null,
  );
  assert.equal(legacy.sortDate, '2026-02-13T00:00:00.000Z');
  assert.equal(legacy.displayDate, '2026-02-13');
  assert.equal(legacy.displaySource, 'artifact');

  const unknown = resolveArtifactTime(
    { uploadedAt: '2026-07-21T00:00:00.000Z', uploadedAtReliable: false },
    null,
  );
  assert.equal(unknown.displaySource, 'legacy-upload');
  assert.equal(unknown.displayDate, '2026-07-21');

  const missing = resolveArtifactTime({}, null);
  assert.equal(missing.sortDate, '');
  assert.equal(missing.displayDate, '');
  assert.equal(missing.displaySource, 'missing');

  const reuploaded = resolveArtifactTime(
    { uploadedAt: '2026-07-21T00:00:00.000Z', uploadedAtReliable: false, artifactDate: '2026-02-13' },
    '2026-10-01T00:00:00.000Z',
  );
  assert.equal(reuploaded.displaySource, 'upload');
  assert.equal(reuploaded.uploadedAt, '2026-10-01T00:00:00.000Z');

  // The same instant serialized with different precision must NOT be treated as a re-upload,
  // otherwise backfilled bulk/move entries would flip back to "reliable" at runtime.
  const sameInstant = resolveArtifactTime(
    { uploadedAt: '2026-07-21T04:30:00.000Z', uploadedAtReliable: false, artifactDate: '2026-05-01' },
    '2026-07-21T04:30:00Z',
  );
  assert.equal(sameInstant.displaySource, 'artifact');
  assert.equal(sameInstant.uploadedAtReliable, false);
});

test('listProjectFiles merges R2 upload times, flags and unknown objects', () => {
  const catalog = catalogFixture();
  const uploads = new Map([
    ['reports/new.html', '2026-10-18T04:00:00.000Z'],
    ['old/report.html', '2026-07-21T04:30:00.000Z'],
    ['orphan/lost.html', '2026-09-09T09:09:09.000Z'],
  ]);
  const files = listProjectFiles(catalog, 'guides', uploads);
  assert.equal(files.length, 3);

  const fresh = files.find((file) => file.file === 'reports/new.html');
  assert.equal(fresh.displaySource, 'upload');
  assert.equal(fresh.sortDate, '2026-10-18T04:00:00.000Z');
  assert.equal(fresh.artifactDate, '2026-10-18T00:00:00.000Z');

  const legacy = files.find((file) => file.file === 'old/report.html');
  assert.equal(legacy.displaySource, 'artifact');
  assert.equal(legacy.sortDate, '2026-05-01T00:00:00.000Z');

  const orphan = files.find((file) => file.file === 'orphan/lost.html');
  assert.equal(orphan.title, 'lost');
  assert.equal(orphan.routePath, 'guides/orphan/lost');
  assert.equal(orphan.uploadedAtReliable, false);
  assert.equal(orphan.displaySource, 'legacy-upload');
});

test('listProjectFiles without uploads uses stored uploadedAtReliable flags', () => {
  const files = listProjectFiles(catalogFixture(), 'guides');
  const fresh = files.find((file) => file.file === 'reports/new.html');
  assert.equal(fresh.displaySource, 'upload');
  const legacy = files.find((file) => file.file === 'old/report.html');
  assert.equal(legacy.displaySource, 'artifact');
});

test('listProjectFiles ignores malformed catalog entries', () => {
  const catalog = { projects: { guides: { files: [null, 'nope', { routePath: 'guides/ok' }] } } };
  const files = listProjectFiles(catalog, 'guides');
  assert.equal(files.length, 1);
  assert.equal(files[0].routePath, 'guides/ok');
  assert.equal(files[0].displayDate, '');
});
