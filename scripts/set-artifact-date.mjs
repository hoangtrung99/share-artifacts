#!/usr/bin/env node
// Set (or clear) the artifact date for one catalog entry WITHOUT re-uploading the file and
// WITHOUT changing its upload/recency metadata. Use this to repair the 61 legacy files whose
// content has no parseable date but where you know the real creation date.
//
// Usage:
//   node scripts/set-artifact-date.mjs --project <p> --file <rel> --date YYYY-MM-DD
//   node scripts/set-artifact-date.mjs --project <p> --file <rel> --clear
//
// The catalog is backed up under meta/backups/ before the write; a failed backup aborts.

import { r2BackupText, r2GetText, r2PutText } from './lib/r2-cli.mjs';
import { assertFilePath, assertProjectName } from './lib/names.mjs';

const CATALOG_KEY = 'meta/catalog.json';

function parseArgs(argv) {
  const out = { project: null, file: null, date: null, clear: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') out.project = argv[++i];
    else if (arg === '--file') out.file = argv[++i];
    else if (arg === '--date') out.date = argv[++i];
    else if (arg === '--clear') out.clear = true;
    else throw new Error(`Unknown arg: ${arg}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const project = assertProjectName(args.project);
  const file = assertFilePath(args.file || '');
  if (!args.clear && !/^\d{4}-\d{2}-\d{2}$/.test(args.date || '')) {
    throw new Error('--date must be YYYY-MM-DD (or use --clear)');
  }

  const raw = r2GetText(CATALOG_KEY);
  if (raw === null) throw new Error(`catalog is missing at ${CATALOG_KEY}`);
  const catalog = JSON.parse(raw);
  const entry = catalog.projects?.[project]?.files?.find((candidate) => candidate.file === file);
  if (!entry) throw new Error(`catalog entry not found: ${project}/${file}`);

  const previous = entry.artifactDate ?? null;
  entry.artifactDate = args.clear ? null : args.date;
  entry.artifactDateSource = args.clear ? null : 'manual';
  catalog.updatedAt = new Date().toISOString();

  r2BackupText(CATALOG_KEY, raw);
  r2PutText(CATALOG_KEY, JSON.stringify(catalog, null, 2) + '\n');
  console.log(
    `catalog-date: ${project}/${file} ${previous ?? '(none)'} -> ${entry.artifactDate ?? '(cleared)'}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
