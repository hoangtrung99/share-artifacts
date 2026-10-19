#!/usr/bin/env node
// Prebuild step — runs BEFORE `astro build`.
//
// Thin-shell mode (R2 content):
//   1. Fail closed if public/ holds anything that is not a known shell entry.
//   2. Ensure public/assets exists (site.css / viewer.js from shell-assets/).
//   3. Write thin _headers / _redirects (no per-file rewrites).
//   4. Write robots.txt (auth routes disallowed, sitemap advertised).
//   5. Do NOT copy src/artifacts into public/ — content lives on R2.
//   6. Auth registries live on R2 (meta/*.json); no local snapshot modules.
//
// public/ is copied verbatim into dist/ by Astro, so stale artifact copies left there would
// ship to the live site. Unknown entries are a build error, never a silent `rm -rf`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const SITE_URL = 'https://artifacts.hoangtrung.dev';

// Every entry public/ may contain. assets/_headers/_redirects/robots.txt are generated here;
// favicon.svg is the only tracked source file.
const PUBLIC_ALLOWLIST = new Set([
  'favicon.svg',
  'assets',
  '_headers',
  '_redirects',
  'robots.txt',
]);

// Stale artifact copies (project folders, exported HTML, …) must be removed by hand. Failing
// here keeps them out of dist/ instead of silently deleting something that may not be ours.
function assertPublicDirClean() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    return;
  }
  const unknown = fs
    .readdirSync(PUBLIC_DIR)
    .filter((entry) => !PUBLIC_ALLOWLIST.has(entry))
    .sort();
  if (unknown.length === 0) return;

  const listing = unknown.map((entry) => `  - public/${entry}`).join('\n');
  console.error(
    `prepare-static: refusing to build — unexpected entries in public/:\n${listing}\n` +
      `public/ is copied verbatim into dist/, so these would ship to the live site.\n` +
      `Remove or move them (they are stale artifact copies, not shell assets).\n` +
      `Allowed entries: ${[...PUBLIC_ALLOWLIST].join(', ')}.`,
  );
  process.exit(1);
}

// Minimal _headers (no per-file .rawhtml rewrites — Functions serve raw content).
// Security headers apply to every route; /_astro/* is content-hashed and safe to cache forever.
function writeHeaders() {
  // Short cache during active shell iteration; query-string ?v= also busts.
  // viewer.js changes more often than CSS during UX fixes.
  const body =
    '# Thin shell — content is served from R2 via Pages Functions.\n' +
    '/*\n' +
    '  X-Content-Type-Options: nosniff\n' +
    '  Referrer-Policy: strict-origin-when-cross-origin\n' +
    '/_astro/*\n' +
    '  Cache-Control: public, max-age=31536000, immutable\n' +
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

// robots.txt: keep crawlers out of auth-only routes, point them at the generated sitemap.
function writeRobots() {
  const body =
    '# Thin shell — content is served from R2 via Pages Functions.\n' +
    'User-agent: *\n' +
    'Disallow: /login\n' +
    'Disallow: /ghost\n' +
    '\n' +
    `Sitemap: ${SITE_URL}/sitemap-index.xml\n`;
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), body);
}

assertPublicDirClean();

fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Copy tracked shell-assets/ → public/assets/ (non-hashed CSS/JS for Function HTML).
const SHELL_ASSETS = path.join(ROOT, 'shell-assets');
for (const name of ['site.css', 'viewer.js']) {
  const src = path.join(SHELL_ASSETS, name);
  const dest = path.join(ASSETS_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  } else if (!fs.existsSync(dest)) {
    console.warn(`prepare-static: missing shell-assets/${name} — Function pages need it`);
  }
}

writeHeaders();
writeRedirects();
writeRobots();

console.log('prepare-static: thin shell ready (assets copied, headers/redirects/robots written)');
