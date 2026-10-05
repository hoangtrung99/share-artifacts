#!/usr/bin/env node
// Upsert one (or more) catalog file entries in R2 meta/catalog.json.
//
// Usage:
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --meta <meta.json>
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --remove
//   node scripts/catalog-upsert.mjs --seed <catalog.json>   # replace whole catalog
//
// Retries on concurrent writers (get → merge → put loop).

import fs from 'node:fs';
import { r2GetText, r2PutText } from './lib/r2-cli.mjs';

const CATALOG_KEY = 'meta/catalog.json';
const MAX_RETRIES = 5;

function parseArgs(argv) {
  const out = { remove: false, seed: null, project: null, file: null, meta: null, metaFile: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remove') out.remove = true;
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--meta') out.meta = argv[++i];
    else if (a === '--meta-file') out.metaFile = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function loadCatalogText(raw) {
  if (raw === null) {
    throw new Error(`catalog is missing at ${CATALOG_KEY}; use --seed to create or replace it`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`catalog contains invalid JSON at ${CATALOG_KEY}: ${error.message}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`catalog is invalid at ${CATALOG_KEY}: expected a JSON object`);
  }
  if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) {
    throw new Error(`catalog is invalid at ${CATALOG_KEY}: projects must be an object`);
  }
  for (const [projectName, project] of Object.entries(data.projects)) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new Error(`catalog is invalid at ${CATALOG_KEY}: project ${projectName} must be an object`);
    }
    if (!Array.isArray(project.files)) {
      throw new Error(`catalog is invalid at ${CATALOG_KEY}: project ${projectName}.files must be an array`);
    }
  }

  return data;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.seed) {
    const body = fs.readFileSync(args.seed, 'utf8');
    // Validate JSON
    const data = JSON.parse(body);
    data.updatedAt = new Date().toISOString();
    r2PutText(CATALOG_KEY, JSON.stringify(data, null, 2) + '\n');
    console.log(`catalog-upsert: seeded catalog (${Object.keys(data.projects || {}).length} projects)`);
    return;
  }

  if (!args.project) throw new Error('--project is required');

  let entry = null;
  if (!args.remove) {
    if (args.metaFile) {
      entry = JSON.parse(fs.readFileSync(args.metaFile, 'utf8'));
    } else if (args.meta) {
      entry = JSON.parse(args.meta);
    } else {
      throw new Error('--meta or --meta-file required unless --remove');
    }
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = r2GetText(CATALOG_KEY);
      const catalog = loadCatalogText(raw);
      if (!catalog.projects[args.project]) {
        catalog.projects[args.project] = { files: [] };
      }
      const files = catalog.projects[args.project].files || [];
      const fileKey = args.file || entry?.file;
      if (!fileKey) throw new Error('file path missing');

      const idx = files.findIndex(
        (f) => f.file === fileKey || f.routePath === entry?.routePath,
      );

      if (args.remove) {
        if (idx >= 0) files.splice(idx, 1);
        // Drop empty project
        if (files.length === 0) delete catalog.projects[args.project];
        else catalog.projects[args.project].files = files;
      } else {
        // Also drop any sibling with same routePath but different extension
        const filtered = files.filter(
          (f) => f.routePath !== entry.routePath || f.file === entry.file,
        );
        const i2 = filtered.findIndex((f) => f.file === entry.file);
        if (i2 >= 0) filtered[i2] = entry;
        else filtered.push(entry);
        catalog.projects[args.project] = { files: filtered };
      }

      catalog.updatedAt = new Date().toISOString();
      r2PutText(CATALOG_KEY, JSON.stringify(catalog, null, 2) + '\n');
      console.log(
        args.remove
          ? `catalog-upsert: removed ${args.project}/${fileKey}`
          : `catalog-upsert: upserted ${entry.routePath} (${entry.type})`,
      );
      return;
    } catch (err) {
      lastErr = err;
      console.error(`catalog-upsert: attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      // Brief backoff
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw lastErr || new Error('catalog-upsert failed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
