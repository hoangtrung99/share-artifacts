#!/usr/bin/env node
// Upsert one (or more) catalog file entries in R2 meta/catalog.json.
//
// Usage:
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --source <artifact file>
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --meta <meta.json>
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --meta-file <path>
//   node scripts/catalog-upsert.mjs --project <p> --file <relpath> --remove
//   node scripts/catalog-upsert.mjs --seed <catalog.json>   # replace whole catalog
//
// Every upsert records the real upload time (uploadedAt/updatedAt) and preserves the first
// publish time (createdAt) when the entry already exists. That is what the "Recent" sort uses.
// A dated backup of the previous catalog is written to meta/backups/ before each mutation (a
// failed backup aborts the mutation).
//
// The retry loop re-reads and merges the catalog; it cannot detect a lost update caused by two
// writers racing (R2 JSON put has no conditional write here), so avoid concurrent deliveries.

import fs from 'node:fs';
import { r2BackupText, r2GetText, r2PutText } from './lib/r2-cli.mjs';
import { extractMeta } from './lib/meta.mjs';
import { assertFilePath, assertProjectName } from './lib/names.mjs';

const CATALOG_KEY = 'meta/catalog.json';
const MAX_RETRIES = 5;

function parseArgs(argv) {
  const out = { remove: false, seed: null, project: null, file: null, meta: null, metaFile: null, source: null, date: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remove') out.remove = true;
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--meta') out.meta = argv[++i];
    else if (a === '--meta-file') out.metaFile = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--date') out.date = argv[++i];
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

function entryFromArgs(args, project, file) {
  if (args.source) {
    const raw = fs.readFileSync(args.source, 'utf8');
    const meta = extractMeta(raw, project, file);
    return { ...meta, file, routePath: `${project}/${file.replace(/\.(html|md)$/i, '')}` };
  }
  if (args.metaFile) return JSON.parse(fs.readFileSync(args.metaFile, 'utf8'));
  if (args.meta) return JSON.parse(args.meta);
  throw new Error('--source, --meta or --meta-file required unless --remove');
}

/**
 * Best-effort artifact creation date: explicit date/meta date first, then the heuristics stored
 * as sortDate (path/content date). Null when nothing usable is found.
 * @param {object} entry
 */
function artifactDateFromEntry(entry) {
  const explicit = entry.artifactDate || entry.date;
  const match = String(explicit || entry.sortDate || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.seed) {
    const body = fs.readFileSync(args.seed, 'utf8');
    const data = JSON.parse(body);
    data.updatedAt = new Date().toISOString();
    // Only a confirmed-missing catalog (null) may be seeded silently. Auth/network/transient
    // errors must abort: overwriting a catalog we failed to read would destroy it without backup.
    const previous = r2GetText(CATALOG_KEY);
    r2BackupText(CATALOG_KEY, previous);
    r2PutText(CATALOG_KEY, JSON.stringify(data, null, 2) + '\n');
    console.log(`catalog-upsert: seeded catalog (${Object.keys(data.projects || {}).length} projects)`);
    return;
  }

  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('--date must be YYYY-MM-DD');
  }

  const project = assertProjectName(args.project);
  assertFilePath(args.file || '');
  const file = args.file;

  let entry = null;
  if (!args.remove) {
    entry = entryFromArgs(args, project, file);
    if (args.date) {
      entry = { ...entry, date: args.date, artifactDate: args.date, artifactDateSource: 'manual' };
    } else {
      entry = { ...entry, artifactDate: artifactDateFromEntry(entry) };
    }
  }

  const nowIso = new Date().toISOString();
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = r2GetText(CATALOG_KEY);
      const catalog = loadCatalogText(raw);
      if (!catalog.projects[project]) catalog.projects[project] = { files: [] };
      const files = catalog.projects[project].files || [];

      if (args.remove) {
        const idx = files.findIndex((f) => f.file === file);
        if (idx >= 0) files.splice(idx, 1);
        // Drop empty project
        if (files.length === 0) delete catalog.projects[project];
        else catalog.projects[project].files = files;
      } else {
        const existing = files.find((f) => f.file === file || f.routePath === entry.routePath);
        const merged = {
          ...entry,
          artifactDate: entry.artifactDate || artifactDateFromEntry(entry),
          artifactDateSource: entry.artifactDateSource || (entry.date ? 'explicit' : 'heuristic'),
          createdAt: existing?.createdAt || existing?.uploadedAt || nowIso,
          // A delivery is a real publish event: it wins the "Recent" sort.
          uploadedAt: nowIso,
          uploadedAtReliable: true,
          uploadSource: 'deliver',
          updatedAt: nowIso,
        };
        // Drop any sibling with same routePath but different extension
        const filtered = files.filter(
          (f) => f.routePath !== merged.routePath || f.file === merged.file,
        );
        const i2 = filtered.findIndex((f) => f.file === merged.file);
        if (i2 >= 0) filtered[i2] = merged;
        else filtered.push(merged);
        catalog.projects[project] = { files: filtered };
      }

      catalog.updatedAt = nowIso;
      r2BackupText(CATALOG_KEY, raw);
      r2PutText(CATALOG_KEY, JSON.stringify(catalog, null, 2) + '\n');
      console.log(
        args.remove
          ? `catalog-upsert: removed ${project}/${file}`
          : `catalog-upsert: upserted ${entry.routePath} (${entry.type}) uploadedAt=${nowIso}`,
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
