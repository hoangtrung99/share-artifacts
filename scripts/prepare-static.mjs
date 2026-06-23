#!/usr/bin/env node
// Prebuild step — runs BEFORE `astro build`.
//
// Three jobs, all idempotent:
//   1. Copy every raw artifact from src/artifacts/<project>/<path>.(html|md) into
//      Astro's static passthrough dir (./public) so each file is served verbatim:
//        - .md  -> public/<project>/<path>.md      (verbatim, served at /<project>/<path>.md)
//        - .html-> public/<project>/<path>.rawhtml (raw bytes, NOT a .html FILE — see below)
//      This satisfies the URL contract: existing shared links keep resolving to the raw file.
//   2. Regenerate functions/protected-folders.js from protected.list — the
//      fail-closed registry the middleware imports.
//   3. Generate public/_redirects + public/_headers so each /<project>/<path>.html request
//      200-rewrites (URL unchanged) to its .rawhtml twin with content-type text/html.
//
// WHY .rawhtml instead of a real .html file:
//   Cloudflare Pages' built-in HTML handling 308-redirects /a/b.html -> /a/b (drops the
//   extension). That collides head-on with our extensionless VIEWER route /<project>/<file>:
//   a real <file>.html asset would squat the stripped path and shadow the viewer (and the
//   raw link would never serve verbatim — it'd 308 to the viewer). By storing raw HTML under
//   a non-.html extension there is no .html asset to trigger that auto-redirect, so:
//     - /<project>/<file>      cleanly resolves to the Astro viewer (like the .md case), and
//     - /<project>/<file>.html is served verbatim via an explicit _redirects 200-rewrite.
//   The .rawhtml twin stays under the SAME project first-segment, so the auth middleware
//   (which gates by first path segment) still fail-closed-guards protected raw bytes even on
//   a direct /<project>/<file>.rawhtml request — no new auth surface.
//
// public/ is treated as derived output: it is wiped on every run (favicon.svg is the
// only tracked file we preserve), so deleting a source artifact also drops its raw copy
// instead of leaving a stale route behind.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const ARTIFACTS_DIR = path.join(ROOT, 'src', 'artifacts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROTECTED_LIST = path.join(ROOT, 'protected.list');
const PROTECTED_OUT = path.join(ROOT, 'functions', 'protected-folders.js');
const GHOST_LIST = path.join(ROOT, 'ghost.list');
const GHOST_OUT = path.join(ROOT, 'functions', 'ghost-folders.js');
const REDIRECTS_OUT = path.join(PUBLIC_DIR, '_redirects');
const HEADERS_OUT = path.join(PUBLIC_DIR, '_headers');

// Files in public/ that are NOT derived from artifacts and must survive the wipe.
const PRESERVE = new Set(['favicon.svg']);

const ARTIFACT_EXT = new Set(['.html', '.md']);

// Extension used to store raw HTML artifacts so they don't collide with the extensionless
// viewer route under Cloudflare Pages' .html-stripping (see header comment).
const RAW_HTML_EXT = '.rawhtml';

// Convert a backslash path (Windows) to forward slashes for URL/route use.
const toUrlPath = (p) => p.split(path.sep).join('/');

/** Recursively collect every artifact file path under src/artifacts. */
function collectArtifacts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectArtifacts(full));
    } else if (entry.isFile() && ARTIFACT_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/** Remove everything in public/ except the preserved entries. */
function cleanPublic() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(PUBLIC_DIR)) {
    if (PRESERVE.has(entry)) continue;
    fs.rmSync(path.join(PUBLIC_DIR, entry), { recursive: true, force: true });
  }
}

function copyArtifacts() {
  const files = collectArtifacts(ARTIFACTS_DIR);
  // Route bases (project-relative, extension-stripped, forward-slash) for every HTML artifact.
  // Used to generate the explicit _redirects 200-rewrite rules.
  const htmlBases = [];
  for (const src of files) {
    const rel = path.relative(ARTIFACTS_DIR, src); // <project>/<path>.(html|md)
    const isHtml = path.extname(rel).toLowerCase() === '.html';
    // HTML artifacts are stored under .rawhtml (no real .html asset -> no auto 308 collision
    // with the extensionless viewer). MD is copied verbatim.
    const destRel = isHtml ? rel.slice(0, -'.html'.length) + RAW_HTML_EXT : rel;
    const dest = path.join(PUBLIC_DIR, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (isHtml) htmlBases.push(toUrlPath(rel.slice(0, -'.html'.length)));
  }
  return { count: files.length, htmlBases };
}

// Emit public/_redirects: for each HTML artifact, 200-rewrite /<base>.html -> /<base>.rawhtml
// (URL stays /<base>.html; bytes come from the .rawhtml twin). 200 = proxy/rewrite, not a 3xx,
// so the shared link's URL is unchanged. One explicit rule per file (precise; no broad splat
// that could accidentally catch unrelated .html requests).
function generateRedirects(htmlBases) {
  const lines = [
    '# AUTO-GENERATED by scripts/prepare-static.mjs — do not edit by hand.',
    '# Serve raw HTML artifacts verbatim at /<project>/<path>.html via a 200-rewrite to the',
    '# .rawhtml twin, so the URL contract holds without colliding with the extensionless viewer.',
  ];
  for (const base of htmlBases.sort()) {
    lines.push(`/${base}.html /${base}${RAW_HTML_EXT} 200`);
  }
  fs.writeFileSync(REDIRECTS_OUT, lines.join('\n') + '\n');
  return htmlBases.length;
}

// Emit public/_headers: force a proper HTML content-type for raw artifact requests.
//
// Two rules, because _headers matches the REQUEST path while content-type is otherwise
// inferred from the SERVED file extension:
//   /*.html    — the shared raw link /<project>/<file>.html 200-rewrites to a .rawhtml file;
//                the request path is still .html, and the served .rawhtml extension would
//                otherwise infer application/octet-stream (+ nosniff -> iframe/raw view fails).
//                This rule keys on the .html request path and overrides that. The viewer routes
//                are extensionless (/<project>/<file>/), so this never touches them.
//   /*.rawhtml — covers a direct /<project>/<file>.rawhtml request (request path is .rawhtml).
function generateHeaders() {
  const body =
    '# AUTO-GENERATED by scripts/prepare-static.mjs — do not edit by hand.\n' +
    '# Force text/html for raw artifact links. /*.html is the canonical raw URL (200-rewritten\n' +
    '# to a .rawhtml file); /*.rawhtml covers a direct request to the stored twin.\n' +
    '/*.html\n' +
    '  Content-Type: text/html; charset=utf-8\n' +
    '/*.rawhtml\n' +
    '  Content-Type: text/html; charset=utf-8\n';
  fs.writeFileSync(HEADERS_OUT, body);
}

function generateProtectedFolders() {
  const names = fs.existsSync(PROTECTED_LIST)
    ? fs
        .readFileSync(PROTECTED_LIST, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const body =
    '// AUTO-GENERATED from protected.list by scripts/prepare-static.mjs — do not edit by hand.\n' +
    '// Fail-closed registry of protected project names imported by functions/_middleware.js.\n' +
    `export default ${JSON.stringify(names)};\n`;
  fs.mkdirSync(path.dirname(PROTECTED_OUT), { recursive: true });
  fs.writeFileSync(PROTECTED_OUT, body);
  return names;
}
function generateGhostFolders() {
  const names = fs.existsSync(GHOST_LIST)
    ? fs
        .readFileSync(GHOST_LIST, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const body =
    '// AUTO-GENERATED from ghost.list by scripts/prepare-static.mjs — do not edit by hand.\n' +
    '// Fail-closed registry of ghost (hidden) project names imported by functions/_middleware.js\n' +
    '// and functions/ghost.js.\n' +
    `export default ${JSON.stringify(names)};\n`;
  fs.mkdirSync(path.dirname(GHOST_OUT), { recursive: true });
  fs.writeFileSync(GHOST_OUT, body);
  return names;
}

if (!fs.existsSync(ARTIFACTS_DIR)) {
  console.error(`prepare-static: missing artifacts dir ${ARTIFACTS_DIR}`);
  process.exit(1);
}

cleanPublic();
const { count: copied, htmlBases } = copyArtifacts();
const redirectCount = generateRedirects(htmlBases);
generateHeaders();
const protectedNames = generateProtectedFolders();
const ghostNames = generateGhostFolders();

console.log(`prepare-static: copied ${copied} raw artifact(s) into public/ (${htmlBases.length} html as .rawhtml)`);
console.log(`prepare-static: wrote ${redirectCount} _redirects rule(s) + _headers`);
console.log(`prepare-static: protected projects -> [${protectedNames.join(', ')}]`);
console.log(`prepare-static: ghost projects -> [${ghostNames.join(', ')}]`);
