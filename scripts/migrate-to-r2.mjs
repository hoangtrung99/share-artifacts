#!/usr/bin/env node
// One-shot migration: walk src/artifacts, upload every .html|.md to R2,
// build catalog, seed protected/ghost registries from local lists.
//
// Prerequisite: R2 enabled on the Cloudflare account + bucket `artifacts-content` created.
//
//   node scripts/migrate-to-r2.mjs
//   node scripts/migrate-to-r2.mjs --dry-run

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMeta } from './lib/meta.mjs';
import { r2PutFile, r2PutText, BUCKET } from './lib/r2-cli.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const ARTIFACTS = path.join(ROOT, 'src', 'artifacts');
const dryRun = process.argv.includes('--dry-run');

function collect(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.isFile() && /\.(html|md)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function contentType(filePath) {
  return filePath.toLowerCase().endsWith('.md')
    ? 'text/markdown; charset=utf-8'
    : 'text/html; charset=utf-8';
}

function main() {
  const files = collect(ARTIFACTS);
  console.log(`migrate-to-r2: found ${files.length} artifact(s) under src/artifacts`);
  if (!files.length) {
    console.error('No artifacts to migrate.');
    process.exit(1);
  }

  const catalog = { version: 1, updatedAt: new Date().toISOString(), projects: {} };
  let uploaded = 0;

  for (const abs of files) {
    const rel = path.relative(ARTIFACTS, abs).split(path.sep).join('/'); // project/path.ext
    const project = rel.split('/')[0];
    const filePath = rel.slice(project.length + 1); // path.ext within project
    const raw = fs.readFileSync(abs, 'utf8');
    const meta = extractMeta(raw, project, filePath);
    const key = `content/${project}/${filePath}`;

    if (!catalog.projects[project]) catalog.projects[project] = { files: [] };
    // De-dupe by routePath: prefer first (md wins if listed first — we process in walk order)
    const existing = catalog.projects[project].files.find((f) => f.routePath === meta.routePath);
    if (!existing) catalog.projects[project].files.push(meta);
    else if (meta.type === 'md' && existing.type === 'html') {
      // Prefer md for viewer metadata when both exist
      Object.assign(existing, meta);
    }

    if (dryRun) {
      console.log(`  [dry-run] ${key}  (${meta.title})`);
    } else {
      r2PutFile(key, abs, contentType(filePath));
      uploaded++;
      if (uploaded % 25 === 0) console.log(`  … uploaded ${uploaded}/${files.length}`);
    }
  }

  // protected / ghost lists
  const readList = (name) => {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  };
  const protectedNames = [...new Set(readList('protected.list'))].sort();
  const ghostNames = [...new Set(readList('ghost.list'))].sort();

  if (dryRun) {
    console.log(`  [dry-run] catalog projects: ${Object.keys(catalog.projects).length}`);
    console.log(`  [dry-run] protected: [${protectedNames.join(', ')}]`);
    console.log(`  [dry-run] ghost: [${ghostNames.join(', ')}]`);
    console.log('migrate-to-r2: dry-run complete (nothing uploaded)');
    return;
  }

  r2PutText('meta/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
  r2PutText('meta/protected.json', JSON.stringify(protectedNames, null, 2) + '\n');
  r2PutText('meta/ghost.json', JSON.stringify(ghostNames, null, 2) + '\n');

  console.log(`migrate-to-r2: uploaded ${uploaded} object(s) to ${BUCKET}`);
  console.log(`migrate-to-r2: catalog projects: ${Object.keys(catalog.projects).length}`);
  console.log(`migrate-to-r2: protected: [${protectedNames.join(', ')}]`);
  console.log(`migrate-to-r2: ghost: [${ghostNames.join(', ')}]`);
  console.log('Done. Deploy the thin shell next: ./deploy.sh');
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  console.error(
    '\nIf you see error 10042, enable R2 in the Cloudflare dashboard first, then:\n' +
      '  npx wrangler r2 bucket create artifacts-content\n' +
      '  node scripts/migrate-to-r2.mjs',
  );
  process.exit(1);
}
