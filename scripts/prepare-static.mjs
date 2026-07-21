#!/usr/bin/env node
// Prebuild step — runs BEFORE `astro build`.
//
// Thin-shell mode (R2 content):
//   1. Ensure public/assets exists (site.css / viewer.js from shell-assets/).
//   2. Clean any legacy artifact copies under public/.
//   3. Write thin _headers / _redirects (no per-file rewrites).
//   4. Do NOT copy src/artifacts into public/ — content lives on R2.
//   5. Auth registries live on R2 (meta/*.json); no local snapshot modules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

// Remove legacy raw artifact copies under public/ (project folders) so dist stays thin.
// Preserve: favicon.svg, assets/, _headers, _redirects if present.
const PRESERVE = new Set(['favicon.svg', 'assets', '_headers', '_redirects']);

function cleanLegacyArtifacts() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    return 0;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(PUBLIC_DIR)) {
    if (PRESERVE.has(entry)) continue;
    // Skip hidden
    if (entry.startsWith('.')) continue;
    const full = path.join(PUBLIC_DIR, entry);
    fs.rmSync(full, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

// Minimal _headers (no per-file .rawhtml rewrites — Functions serve raw content).
function writeHeaders() {
  // Short cache during active shell iteration; query-string ?v= also busts.
  // viewer.js changes more often than CSS during UX fixes.
  const body =
    '# Thin shell — content is served from R2 via Pages Functions.\n' +
    '/assets/viewer.js\n' +
    '  Cache-Control: public, max-age=300, must-revalidate\n' +
    '/assets/site.css\n' +
    '  Cache-Control: public, max-age=3600\n' +
    '/assets/*\n' +
    '  Cache-Control: public, max-age=300, must-revalidate\n';
  fs.writeFileSync(path.join(PUBLIC_DIR, '_headers'), body);
}

// Empty _redirects (legacy .html → .rawhtml rules no longer needed).
function writeRedirects() {
  fs.writeFileSync(
    path.join(PUBLIC_DIR, '_redirects'),
    '# No static artifact redirects — content routes are handled by functions/[[path]].js\n',
  );
}

const SHELL_ASSETS = path.join(ROOT, 'shell-assets');
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Copy tracked shell-assets/ → public/assets/ (non-hashed CSS/JS for Function HTML).
for (const name of ['site.css', 'viewer.js']) {
  const src = path.join(SHELL_ASSETS, name);
  const dest = path.join(ASSETS_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else if (!fs.existsSync(dest)) {
    console.warn(`prepare-static: missing shell-assets/${name} — Function pages need it`);
  }
}

const removed = cleanLegacyArtifacts();
writeHeaders();
writeRedirects();

console.log(`prepare-static: thin shell (removed ${removed} legacy public/ entries)`);
