import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('public/assets is a byte-for-byte copy of shell-assets', () => {
  for (const name of ['site.css', 'viewer.js']) {
    assert.equal(
      read('public/assets/' + name),
      read('shell-assets/' + name),
      name + ' is stale — run pnpm build (prepare-static copies shell-assets into public/assets)',
    );
  }
});

test('ASSET_V matches the hash of the shipped shell assets', () => {
  const hash = crypto
    .createHash('sha256')
    .update(read('shell-assets/site.css'))
    .update(read('shell-assets/viewer.js'))
    .digest('hex')
    .slice(0, 8);
  const render = read('functions/_render.js');
  const match = render.match(/export const ASSET_V = '([^']+)'/);
  assert.ok(match, 'ASSET_V must be exported from functions/_render.js');
  assert.equal(
    match[1],
    hash,
    'ASSET_V is stale: update it to ' + hash + ' so browsers fetch the new viewer.js/site.css',
  );
});

test('viewer.js contains the post-render helpers it advertises', () => {
  const viewer = read('shell-assets/viewer.js');
  assert.match(viewer, /highlightAll/);
  assert.match(viewer, /dataset\.artifactDate/);
  assert.match(viewer, /cmpRecentEntries/);
});

test('site.css styles the upload badge used by the viewer bar', () => {
  assert.match(read('shell-assets/site.css'), /\.vb-uploaded\s*\{/);
});

test('Astro shell versions viewer.js with the same ASSET_V as Functions', () => {
  const render = read('functions/_render.js');
  const match = render.match(/export const ASSET_V = '([^']+)'/);
  assert.ok(match, 'ASSET_V must be exported from functions/_render.js');
  const base = read('src/layouts/Base.astro');
  assert.match(
    base,
    new RegExp('/assets/viewer\.js\?v=' + match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'Base.astro must load viewer.js with ?v=ASSET_V so browsers never mix shell versions',
  );
});
