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

function createMetaFile(directory) {
  const metaPath = path.join(directory, 'meta.json');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      project: 'guides',
      file: 'new.html',
      routePath: '/guides/new',
      type: 'html',
      title: 'New',
      description: '',
      tags: [],
      date: null,
      sortDate: null,
    }),
  );
  return metaPath;
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
  const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(calls.length, 5, 'the existing retry policy should retry reads only');
  assert.ok(calls.every((line) => JSON.parse(line)[3] === 'get'));
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
  assert.equal(fs.existsSync(putCapture), false, 'normal upsert must not overwrite malformed catalog data');
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
    assert.equal(fs.existsSync(putCapture), false, 'normal upsert must not normalize invalid catalog data');
  });
}

test('--seed can explicitly create or replace the whole catalog', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-upsert-seed-'));
  const seedPath = path.join(directory, 'seed.json');
  const putCapture = path.join(directory, 'put.json');
  const callLog = path.join(directory, 'calls.log');
  fs.writeFileSync(seedPath, JSON.stringify({ version: 1, updatedAt: null, projects: {} }));

  const result = runNode(['scripts/catalog-upsert.mjs', '--seed', seedPath], {
    FAKE_WRANGLER_MODE: 'generic-error',
    FAKE_WRANGLER_CALL_LOG: callLog,
    FAKE_R2_PUT_CAPTURE: putCapture,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(putCapture), true);
  const calls = fs.readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], 'put');
  const written = JSON.parse(fs.readFileSync(putCapture, 'utf8'));
  assert.deepEqual(written.projects, {});
  assert.match(written.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
