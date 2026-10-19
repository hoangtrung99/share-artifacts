import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-fake-bin-'));
fs.symlinkSync(path.join(repoRoot, 'test/helpers/fake-npx.cjs'), path.join(fakeBin, 'npx'));

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
      ...env,
    },
  });
}

function runGet(mode) {
  return runNode(
    [
      '--input-type=module',
      '-e',
      "import { r2GetText } from './scripts/lib/r2-cli.mjs'; try { const value = r2GetText('meta/catalog.json'); console.log(JSON.stringify(value)); } catch (error) { console.error(error.message); process.exit(1); }",
    ],
    { FAKE_WRANGLER_MODE: mode },
  );
}

function createMetaFile(directory, meta = {}) {
  const metaPath = path.join(directory, 'meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      project: 'guides',
      file: 'new.html',
      routePath: 'guides/new',
      type: 'html',
      title: 'New',
      description: '',
      tags: [],
      date: null,
      sortDate: null,
      ...meta,
    }),
  );
  return metaPath;
}

function callsFrom(callLog) {
  if (!fs.existsSync(callLog)) return [];
  return fs
    .readFileSync(callLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('r2GetText returns null only when Wrangler reports a missing object', () => {
  const result = runGet('missing');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'null');
});

test('r2GetText throws when Wrangler reports 401 with exit status 1', () => {
  const result = runGet('unauthorized');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /401: Unauthorized/);
});

test('r2GetText throws on an unclassified exit status 1 failure', () => {
  const result = runGet('generic-error');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected Wrangler failure/);
});

test('r2GetText throws when a generic 404 is not a confirmed missing key', () => {
  const result = runGet('generic-404');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /404 Object Not Found/);
});

test('normal catalog upsert aborts when catalog object is missing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-missing-'));
  const callLog = path.join(directory, 'calls.log');
  const putCapture = path.join(directory, 'put.json');
  const result = runNode(
    ['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'new.html', '--meta-file', createMetaFile(directory)],
    {
      FAKE_WRANGLER_MODE: 'missing',
      FAKE_WRANGLER_CALL_LOG: callLog,
      FAKE_R2_PUT_CAPTURE: putCapture,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog.*missing/i);
  assert.equal(fs.existsSync(putCapture), false, 'normal upsert must not write a replacement catalog');
  const calls = callsFrom(callLog);
  assert.equal(calls.length, 5, 'the existing retry policy should retry reads only');
  assert.ok(calls.every((call) => call[3] === 'get'));
});

test('normal catalog upsert aborts when catalog JSON is malformed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-malformed-'));
  const putCapture = path.join(directory, 'put.json');
  const result = runNode(
    ['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'new.html', '--meta-file', createMetaFile(directory)],
    {
      FAKE_WRANGLER_MODE: 'malformed',
      FAKE_R2_PUT_CAPTURE: putCapture,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /catalog.*invalid json/i);
  assert.equal(fs.existsSync(putCapture), false);
});

for (const [name, catalog] of [
  ['null project', { version: 1, projects: { guides: null } }],
  ['non-array files', { version: 1, projects: { guides: { files: null } } }],
  ['invalid unrelated project', { version: 1, projects: { reports: { files: 'bad' } } }],
]) {
  test(`normal catalog upsert aborts on structurally invalid catalog: ${name}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-invalid-'));
    const source = path.join(directory, 'catalog.json');
    const putCapture = path.join(directory, 'put.json');
    fs.writeFileSync(source, JSON.stringify(catalog));

    const result = runNode(
      ['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'new.html', '--meta-file', createMetaFile(directory)],
      {
        FAKE_WRANGLER_MODE: 'valid',
        FAKE_R2_GET_SOURCE: source,
        FAKE_R2_PUT_CAPTURE: putCapture,
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /catalog.*invalid/i);
    assert.equal(fs.existsSync(putCapture), false);
  });
}

test('--seed can explicitly create the catalog without a prior object', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-seed-'));
  const seedPath = path.join(directory, 'seed.json');
  const putCapture = path.join(directory, 'put.json');
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(seedPath, JSON.stringify({ version: 1, updatedAt: null, projects: {} }));

  const result = runNode(['scripts/catalog-upsert.mjs', '--seed', seedPath], {
    FAKE_WRANGLER_MODE: 'missing',
    FAKE_WRANGLER_CALL_LOG: callLog,
    FAKE_R2_PUT_CAPTURE: putCapture,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(putCapture), true);
  const calls = callsFrom(callLog);
  assert.equal(calls.length, 2, 'seed reads for an optional backup, then writes the catalog');
  assert.equal(calls[0][3], 'get');
  assert.equal(calls[1][3], 'put');
  const written = JSON.parse(fs.readFileSync(putCapture, 'utf8'));
  assert.deepEqual(written.projects, {});
  assert.match(written.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('--seed aborts when the existing catalog cannot be read (no silent overwrite)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-seed-unreadable-'));
  const seedPath = path.join(directory, 'seed.json');
  const putCapture = path.join(directory, 'put.json');
  fs.writeFileSync(seedPath, JSON.stringify({ version: 1, updatedAt: null, projects: {} }));

  const result = runNode(['scripts/catalog-upsert.mjs', '--seed', seedPath], {
    FAKE_WRANGLER_MODE: 'unauthorized',
    FAKE_R2_PUT_CAPTURE: putCapture,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unauthorized|catalog/i);
  assert.equal(fs.existsSync(putCapture), false, 'seed must not overwrite a catalog it could not read');
});

test('registry-write rejects reserved project names before touching R2', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-registry-invalid-'));
  const callLog = path.join(directory, 'calls.log');
  const putCapture = path.join(directory, 'put.json');
  const result = runNode(['scripts/registry-write.mjs', '--protected', '--names', 'api'], {
    FAKE_WRANGLER_MODE: 'valid',
    FAKE_R2_GET_SOURCE: path.join(directory, 'missing.json'),
    FAKE_R2_PUT_CAPTURE: putCapture,
    FAKE_WRANGLER_CALL_LOG: callLog,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reserved/i);
  assert.equal(callsFrom(callLog).length, 0);
  assert.equal(fs.existsSync(putCapture), false);
});

test('a normal upsert records uploadedAt/artifactDate flags, preserves createdAt and backs up', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-time-'));
  const source = path.join(directory, 'catalog.json');
  const putCapture = path.join(directory, 'put.json');
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(
    source,
    JSON.stringify({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      projects: {
        guides: {
          files: [
            {
              project: 'guides',
              file: 'new.html',
              routePath: 'guides/new',
              type: 'html',
              title: 'Old title',
              description: '',
              tags: [],
              date: null,
              sortDate: '2026-09-09',
              createdAt: '2026-09-09T10:00:00.000Z',
              uploadedAt: '2026-09-09T10:00:00.000Z',
              uploadedAtReliable: true,
              uploadSource: 'deliver',
            },
          ],
        },
      },
    }),
  );

  const result = runNode(
    ['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'new.html', '--meta-file', createMetaFile(directory, { date: '2026-09-09', sortDate: '2026-09-09' })],
    {
      FAKE_WRANGLER_MODE: 'valid',
      FAKE_R2_GET_SOURCE: source,
      FAKE_R2_PUT_CAPTURE: putCapture,
      FAKE_WRANGLER_CALL_LOG: callLog,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const calls = callsFrom(callLog);
  assert.deepEqual(calls.map((call) => call[3]), ['get', 'put', 'put']);
  assert.match(calls[1][4], /meta\/backups\/catalog-/);

  const written = JSON.parse(fs.readFileSync(putCapture, 'utf8'));
  const entry = written.projects.guides.files[0];
  assert.match(entry.uploadedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.uploadedAtReliable, true);
  assert.equal(entry.uploadSource, 'deliver');
  assert.equal(entry.createdAt, '2026-09-09T10:00:00.000Z');
  assert.equal(entry.artifactDate, '2026-09-09');
});

test('--source extracts metadata in-process and --date overrides the artifact date', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-source-'));
  const sourceCatalog = path.join(directory, 'catalog.json');
  const artifact = path.join(directory, 'artifact.html');
  const putCapture = path.join(directory, 'put.json');
  fs.writeFileSync(sourceCatalog, JSON.stringify({ version: 1, updatedAt: null, projects: {} }));
  fs.writeFileSync(
    artifact,
    '<!doctype html><html><head><title>Source title</title><meta name="description" content="From source"><meta name="date" content="2026-03-04"></head><body>x</body></html>',
  );

  const result = runNode(
    ['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'from-source.html', '--source', artifact, '--date', '2026-03-05'],
    {
      FAKE_WRANGLER_MODE: 'valid',
      FAKE_R2_GET_SOURCE: sourceCatalog,
      FAKE_R2_PUT_CAPTURE: putCapture,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const entry = JSON.parse(fs.readFileSync(putCapture, 'utf8')).projects.guides.files[0];
  assert.equal(entry.title, 'Source title');
  assert.equal(entry.description, 'From source');
  assert.equal(entry.date, '2026-03-05');
  assert.equal(entry.artifactDate, '2026-03-05');
  assert.equal(entry.artifactDateSource, 'manual');
  assert.equal(entry.routePath, 'guides/from-source');
});

test('invalid project names and file paths are rejected before touching R2', () => {
  for (const args of [
    ['--project', 'Bad Name', '--file', 'x.html'],
    ['--project', 'api', '--file', 'x.html'],
    ['--project', 'guides', '--file', '../x.html'],
    ['--project', 'guides', '--file', 'x.txt'],
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-name-'));
    const callLog = path.join(directory, 'calls.log');
    const putCapture = path.join(directory, 'put.json');
    const result = runNode(
      ['scripts/catalog-upsert.mjs', ...args, '--meta-file', createMetaFile(directory)],
      {
        FAKE_WRANGLER_MODE: 'valid',
        FAKE_R2_GET_SOURCE: path.join(directory, 'missing.json'),
        FAKE_R2_PUT_CAPTURE: putCapture,
        FAKE_WRANGLER_CALL_LOG: callLog,
      },
    );
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(fs.existsSync(putCapture), false, args.join(' '));
    assert.equal(callsFrom(callLog).length, 0, args.join(' '));
  }
});

test('--remove deletes the entry, drops empty projects and backs up first', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-remove-'));
  const source = path.join(directory, 'catalog.json');
  const putCapture = path.join(directory, 'put.json');
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(
    source,
    JSON.stringify({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      projects: { guides: { files: [{ project: 'guides', file: 'gone.html', routePath: 'guides/gone', type: 'html', title: 'Gone', tags: [] }] } },
    }),
  );

  const result = runNode(['scripts/catalog-upsert.mjs', '--project', 'guides', '--file', 'gone.html', '--remove'], {
    FAKE_WRANGLER_MODE: 'valid',
    FAKE_R2_GET_SOURCE: source,
    FAKE_R2_PUT_CAPTURE: putCapture,
    FAKE_WRANGLER_CALL_LOG: callLog,
  });

  assert.equal(result.status, 0, result.stderr);
  const calls = callsFrom(callLog);
  assert.deepEqual(calls.map((call) => call[3]), ['get', 'put', 'put']);
  const written = JSON.parse(fs.readFileSync(putCapture, 'utf8'));
  assert.equal(written.projects.guides, undefined);
});

test('set-artifact-date corrects a legacy date without touching recency metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-set-date-'));
  const source = path.join(directory, 'catalog.json');
  const putCapture = path.join(directory, 'put.json');
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(
    source,
    JSON.stringify({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      projects: {
        guides: {
          files: [
            {
              project: 'guides',
              file: 'old/report.html',
              routePath: 'guides/old/report',
              type: 'html',
              title: 'Old report',
              tags: [],
              artifactDate: null,
              uploadedAt: '2026-07-21T04:30:00.000Z',
              uploadedAtReliable: false,
              uploadSource: 'bulk-migration',
            },
          ],
        },
      },
    }),
  );

  const result = runNode(
    ['scripts/set-artifact-date.mjs', '--project', 'guides', '--file', 'old/report.html', '--date', '2026-05-01'],
    {
      FAKE_WRANGLER_MODE: 'valid',
      FAKE_R2_GET_SOURCE: source,
      FAKE_R2_PUT_CAPTURE: putCapture,
      FAKE_WRANGLER_CALL_LOG: callLog,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(callsFrom(callLog).map((call) => call[3]), ['get', 'put', 'put']);
  const entry = JSON.parse(fs.readFileSync(putCapture, 'utf8')).projects.guides.files[0];
  assert.equal(entry.artifactDate, '2026-05-01');
  assert.equal(entry.artifactDateSource, 'manual');
  // Recency metadata is deliberately untouched: the artifact is still a bulk/moved item.
  assert.equal(entry.uploadedAt, '2026-07-21T04:30:00.000Z');
  assert.equal(entry.uploadedAtReliable, false);
  assert.equal(entry.uploadSource, 'bulk-migration');
});

test('set-artifact-date validates input before touching R2', () => {
  for (const args of [
    ['--project', 'guides', '--file', 'old/report.html', '--date', '01-05-2026'],
    ['--project', 'guides', '--file', 'missing.html', '--date', '2026-05-01'],
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-set-date-invalid-'));
    const callLog = path.join(directory, 'calls.log');
    const putCapture = path.join(directory, 'put.json');
    const result = runNode(['scripts/set-artifact-date.mjs', ...args], {
      FAKE_WRANGLER_MODE: 'valid',
      FAKE_R2_GET_SOURCE: path.join(directory, 'missing.json'),
      FAKE_R2_PUT_CAPTURE: putCapture,
      FAKE_WRANGLER_CALL_LOG: callLog,
    });
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(fs.existsSync(putCapture), false, args.join(' '));
  }
});
