#!/usr/bin/env node
// Inventory R2 and backfill the catalog's time metadata.
//
// Why this exists: the previous listing sorted by a date guessed from the artifact body, which
// was wrong or missing for most files ("Recent" looked random). R2 knows the real object
// last-modified time, but that time is only meaningful for ordinary deliveries. One-off bulk
// operations (initial R2 migration 2026-07-21, the folder reorg on 2026-08-27) rewrote objects,
// so their upload times say nothing about when the artifact was made. This script records:
//
//   uploadedAt          R2 last-modified (ISO)
//   uploadedAtReliable  false for migration/reorg batches
//   uploadSource        'deliver' | 'r2' | 'bulk-migration' | 'reorg-move'
//   artifactDate        best-effort creation date from explicit meta/frontmatter/path
//   createdAt           first known upload time
//
// It also reports catalog/R2 drift (missing objects, orphan objects) and can add R2 orphans to
// the catalog (metadata extracted from their content).
//
// Usage:
//   node scripts/backfill-r2-times.mjs                 # dry run: report only
//   node scripts/backfill-r2-times.mjs --apply         # write catalog (with dated backup)
//   node scripts/backfill-r2-times.mjs --migration-cutoff 2026-07-22 --reorg-day 2026-08-27

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2BackupText, r2GetText, r2PutText } from './lib/r2-cli.mjs';
import { DEFAULT_BUCKET, listR2Objects } from './lib/r2-api.mjs';
import { extractMeta } from './lib/meta.mjs';
import { filePathError, projectNameError } from './lib/names.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const CATALOG_KEY = 'meta/catalog.json';
const R2_PREFIX = 'content/';

function parseArgs(argv) {
  const out = {
    apply: false,
    bucket: DEFAULT_BUCKET,
    migrationCutoff: '2026-07-22T00:00:00.000Z',
    reorgDay: '2026-08-27',
    recent: 15,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--bucket') out.bucket = argv[++i];
    else if (arg === '--migration-cutoff') out.migrationCutoff = argv[++i];
    else if (arg === '--reorg-day') out.reorgDay = argv[++i];
    else if (arg === '--recent') out.recent = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n'));
      process.exit(0);
    } else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!Number.isFinite(out.recent) || out.recent < 1) out.recent = 15;
  return out;
}

function normalizeDate(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function classify(uploaded, args) {
  if (uploaded < args.migrationCutoff) {
    return { reliable: false, source: 'bulk-migration' };
  }
  if (uploaded.startsWith(args.reorgDay)) {
    return { reliable: false, source: 'reorg-move' };
  }
  return { reliable: true, source: 'r2' };
}

function projectSummary(catalog, uploadsByProject) {
  const lines = [];
  for (const [project, projectData] of Object.entries(catalog.projects)) {
    const files = Array.isArray(projectData?.files) ? projectData.files : [];
    let reliable = 0;
    let bulk = 0;
    let reorg = 0;
    let unknown = 0;
    for (const file of files) {
      if (file.uploadedAtReliable === true) reliable++;
      else if (file.uploadSource === 'bulk-migration') bulk++;
      else if (file.uploadSource === 'reorg-move') reorg++;
      else unknown++;
    }
    const uploads = uploadsByProject.get(project) || [];
    const times = uploads.map((o) => o.uploaded).sort();
    lines.push(
      `  ${project.padEnd(8)} files=${String(files.length).padEnd(4)} reliable=${String(reliable).padEnd(4)} bulk=${String(bulk).padEnd(4)} reorg=${String(reorg).padEnd(3)} r2=${String(times.length).padEnd(4)} ${times[0] || '-'} .. ${times[times.length - 1] || '-'}`,
    );
  }
  return lines.join('\n');
}

function effectiveTime(file) {
  if (file.uploadedAtReliable === true && file.uploadedAt) return file.uploadedAt;
  if (file.artifactDate) return file.artifactDate;
  return file.uploadedAt || '';
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = r2GetText(CATALOG_KEY);
  if (raw === null) throw new Error(`catalog is missing at ${CATALOG_KEY}`);

  const catalog = JSON.parse(raw);
  if (!catalog.projects || typeof catalog.projects !== 'object') {
    throw new Error('catalog.projects is missing or invalid');
  }

  const objects = await listR2Objects({ bucket: args.bucket, prefix: R2_PREFIX });
  const byKey = new Map(objects.map((object) => [object.key, object]));
  const uploadsByProject = new Map();
  for (const object of objects) {
    const rest = object.key.slice(R2_PREFIX.length);
    const project = rest.split('/')[0];
    if (!uploadsByProject.has(project)) uploadsByProject.set(project, []);
    uploadsByProject.get(project).push(object);
  }

  const stats = {
    objects: objects.length,
    catalogFiles: 0,
    missingOnR2: [],
    orphansAdded: [],
    orphansSkipped: [],
    duplicates: [],
    reliable: 0,
    bulkMigration: 0,
    reorgMove: 0,
    changed: 0,
  };

  const catalogKeys = new Set();
  for (const [project, projectData] of Object.entries(catalog.projects)) {
    if (!projectData || typeof projectData !== 'object') {
      console.warn('skipping non-object project in catalog:', project);
      continue;
    }
    if (!Array.isArray(projectData.files)) {
      console.warn('skipping project with non-array files in catalog:', project);
      continue;
    }
    const seenFiles = new Set();
    for (const file of projectData.files) {
      stats.catalogFiles++;
      const key = R2_PREFIX + project + '/' + file.file;
      catalogKeys.add(key);
      if (seenFiles.has(file.file)) stats.duplicates.push(key);
      seenFiles.add(file.file);

      const object = byKey.get(key);
      if (!object) {
        stats.missingOnR2.push(key);
        continue;
      }
      const classification = classify(object.uploaded, args);
      const next = {
        uploadedAt: object.uploaded,
        uploadedAtReliable: classification.reliable,
        uploadSource:
          classification.source === 'r2' && file.uploadSource === 'deliver' && file.uploadedAt === object.uploaded
            ? 'deliver'
            : classification.source,
        artifactDate: normalizeDate(file.artifactDate || file.date || file.sortDate),
        createdAt: file.createdAt || object.uploaded,
      };
      if (
        file.uploadedAt !== next.uploadedAt ||
        file.uploadedAtReliable !== next.uploadedAtReliable ||
        file.uploadSource !== next.uploadSource ||
        (file.artifactDate || null) !== next.artifactDate
      ) {
        stats.changed++;
      }
      Object.assign(file, next);
      if (next.uploadedAtReliable) stats.reliable++;
      else if (next.uploadSource === 'bulk-migration') stats.bulkMigration++;
      else if (next.uploadSource === 'reorg-move') stats.reorgMove++;
    }
  }

  // Objects on R2 that the catalog does not know about: add them (metadata from content).
  for (const object of objects) {
    if (catalogKeys.has(object.key)) continue;
    if (!/\.(html|md)$/i.test(object.key)) {
      stats.orphansSkipped.push(object.key + ' (not html/md)');
      continue;
    }
    const rest = object.key.slice(R2_PREFIX.length);
    const project = rest.split('/')[0];
    const file = rest.slice(project.length + 1);
    const projectError = projectNameError(project);
    const fileError = filePathError(file);
    if (projectError || fileError) {
      stats.orphansSkipped.push(object.key + ' (' + (projectError || fileError) + ')');
      continue;
    }
    const body = r2GetText(object.key);
    if (body == null) {
      stats.orphansSkipped.push(object.key + ' (unreadable)');
      continue;
    }
    const meta = extractMeta(body, project, file);
    const classification = classify(object.uploaded, args);
    const entry = {
      ...meta,
      file,
      routePath: `${project}/${file.replace(/\.(html|md)$/i, '')}`,
      uploadedAt: object.uploaded,
      uploadedAtReliable: classification.reliable,
      uploadSource: classification.source,
      artifactDate: normalizeDate(meta.artifactDate || meta.date || meta.sortDate),
      createdAt: object.uploaded,
    };
    if (!catalog.projects[project]) catalog.projects[project] = { files: [] };
    const duplicate = catalog.projects[project].files.find(
      (existing) => existing.routePath === entry.routePath,
    );
    if (duplicate) {
      stats.orphansSkipped.push(object.key + ' (duplicate routePath)');
      continue;
    }
    catalog.projects[project].files.push(entry);
    stats.orphansAdded.push(object.key);
  }

  // Report
  console.log('R2 inventory:');
  console.log(projectSummary(catalog, uploadsByProject));
  console.log('');
  console.log(`objects=${stats.objects} catalogFiles=${stats.catalogFiles} reliable=${stats.reliable} bulkMigration=${stats.bulkMigration} reorgMove=${stats.reorgMove}`);
  console.log(`catalog entries missing on R2: ${stats.missingOnR2.length}`);
  for (const key of stats.missingOnR2.slice(0, 20)) console.log('  missing', key);
  console.log(`R2 orphans added to catalog: ${stats.orphansAdded.length}`);
  for (const key of stats.orphansAdded) console.log('  +', key);
  if (stats.orphansSkipped.length) {
    console.log(`R2 orphans skipped: ${stats.orphansSkipped.length}`);
    for (const key of stats.orphansSkipped) console.log('  !', key);
  }
  if (stats.duplicates.length) {
    console.log(`duplicate catalog files: ${stats.duplicates.length}`);
    for (const key of stats.duplicates) console.log('  dup', key);
  }
  console.log(`catalog entries whose time metadata changed: ${stats.changed}`);

  const recent = [];
  for (const [project, projectData] of Object.entries(catalog.projects)) {
    for (const file of projectData.files) {
      recent.push({ project, file: file.file, time: effectiveTime(file), source: file.uploadedAtReliable ? 'upload' : (file.artifactDate ? 'artifact' : 'upload'), artifactDate: file.artifactDate, uploadedAt: file.uploadedAt });
    }
  }
  recent.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  console.log(`\nNewest ${args.recent} by effective time:`);
  for (const item of recent.slice(0, args.recent)) {
    console.log(`  ${item.time.slice(0, 10)}  ${item.project}/${item.file}  (${item.source})`);
  }

  // Persist a local inventory snapshot (meta/ is gitignored).
  const metaDir = path.join(ROOT, 'meta');
  fs.mkdirSync(metaDir, { recursive: true });
  const inventoryPath = path.join(metaDir, `r2-inventory-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(inventoryPath, JSON.stringify({ fetchedAt: new Date().toISOString(), bucket: args.bucket, objects, stats }, null, 2));
  console.log(`\nLocal inventory snapshot: ${path.relative(ROOT, inventoryPath)}`);

  if (!args.apply) {
    console.log('\nDry run — catalog not written. Re-run with --apply to persist.');
    return;
  }

  const now = new Date().toISOString();
  catalog.updatedAt = now;
  r2BackupText(CATALOG_KEY, raw);
  r2PutText(CATALOG_KEY, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`\nApplied: catalog updated at ${now} (previous version backed up under meta/backups/).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
