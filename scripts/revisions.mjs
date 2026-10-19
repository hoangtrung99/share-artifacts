#!/usr/bin/env node
// Immutable revision registry CLI (publish + bootstrap).
//
//   node scripts/revisions.mjs register --project <p> --file <file.html> --source <local file>
//                                         [--created-by deliver] [--out <registry.json>]
//   node scripts/revisions.mjs bootstrap [--project <p>] [--file <file>] [--apply] [--force]
//   node scripts/revisions.mjs status --project <p> --file <file>
//
// `register` is what deliver.sh calls before overwriting the mutable content object:
//   1. hash the local bytes (revisionId = sha256),
//   2. if the artifact has no manifest, snapshot the *previous* R2 object as revision 1
//      (lazy bootstrap; identical bytes are not duplicated),
//   3. upload the immutable snapshot revisions/<artifactId>/<revisionId>/source.<ext>,
//   4. update meta/revisions/<artifactId>.json with an R2 conditional write (If-Match ETag /
//      If-None-Match:*), incrementing `generation` and recording a `publicationId`.
//
// Republishing identical bytes is a true no-op (same revisionId, same generation, no new number).
// A deliberate republish after `unpublish.sh` clears the tombstone marker (the only way to revive a
// path). If Cloudflare REST credentials for conditional writes are unavailable, the script falls
// back to a CLI write + read-back verification and says so (single-writer limitation).
//
// `bootstrap` (dry-run by default) registers every existing artifact from `content/` bytes and
// merges artifactId/latestRevisionId/latestRevisionNumber/revisionCount into meta/catalog.json
// (one dated catalog backup first). Use `--apply` to write. Tombstoned artifacts are skipped.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { r2BackupText, r2GetBuffer, r2GetText, r2PutBuffer, r2PutText } from './lib/r2-cli.mjs';
import { assertSnapshotBytes, snapshotRevisionId } from './lib/snapshot-bytes.mjs';
import { assertCasEtag, assertConditionalPrecondition, hasConditionalCredentials, r2GetObjectWithEtag, r2PutTextConditional } from './lib/r2-api.mjs';
import { assertFilePath, assertProjectName } from './lib/names.mjs';
import {
  addRevision,
  artifactIdFor,
  artifactTypeFor,
  contentTypeFor,
  createRegistry,
  findRevision,
  normalizeRegistry,
  registryKey,
  revisionKey,
  sha256Hex,
} from '../functions/_feedback-revisions.js';

const CATALOG_KEY = 'meta/catalog.json';
let warnedNoCas = false;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // npm/pnpm may forward the `--` separator literally
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const name = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (name === 'apply' || name === 'force' || name === 'help') {
      out[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    out[name] = value;
  }
  return out;
}

function parseRegistryText(raw) {
  let parsed;
  try {
    parsed = normalizeRegistry(JSON.parse(raw));
  } catch (error) {
    throw new Error(`revision manifest is invalid JSON: ${error.message}`);
  }
  if (!parsed) throw new Error('revision manifest has an invalid shape; refusing to overwrite it');
  return parsed;
}

/**
 * Read one manifest with its ETag (REST, CAS-capable) or plain text (CLI fallback).
 * @returns {Promise<{ registry: object|null, etag: string|null, missing: boolean }>}
 */
async function readRegistryState(artifactId) {
  const key = registryKey(artifactId);
  if (hasConditionalCredentials()) {
    // With conditional credentials configured, an R2 error aborts the publication: we must never
    // silently downgrade to an unconditional write (unknown latest pointer = corrupted history).
    const result = await r2GetObjectWithEtag(key);
    if (result.missing) return { registry: null, etag: null, missing: true };
    // No ETag => a follow-up PUT would be uncontrolled; abort instead of writing unconditionally.
    assertCasEtag(result, key);
    return { registry: parseRegistryText(result.text), etag: result.etag, missing: false };
  }
  if (!warnedNoCas) {
    console.error('revisions: conditional writes unavailable (no Cloudflare API credentials) — using CLI write + read-back verification');
    warnedNoCas = true;
  }
  const raw = r2GetText(key);
  if (raw == null) return { registry: null, etag: null, missing: true };
  return { registry: parseRegistryText(raw), etag: null, missing: false };
}

/**
 * Conditional manifest write (CAS). Returns { ok, conflict }.
 * @param {object} registry
 * @param {{ etag: string|null, missing: boolean }} current
 */
async function writeRegistryState(registry, current) {
  const key = registryKey(registry.artifactId);
  const body = JSON.stringify(registry, null, 2) + '\n';
  if (hasConditionalCredentials()) {
    // Never downgrade: a conditional failure is an uncertain outcome and aborts publication.
    const precondition = current.missing ? { ifNoneMatch: '*' } : { ifMatch: current.etag };
    assertConditionalPrecondition(precondition);
    const result = await r2PutTextConditional(key, body, precondition);
    return result.ok ? { ok: true, conflict: false } : { ok: false, conflict: true };
  }
  r2PutText(key, body);
  return { ok: true, conflict: false };
}

/** True when the manifest read-back still contains `revisionId` and points latest at it if required. */
/**
 * Upload immutable snapshot bytes exactly as captured, then verify the object read-back hashes to
 * `revisionId`. An existing snapshot is never overwritten: if its bytes do not match the revision id
 * the publication aborts (corrupt/foreign object).
 * @param {string} artifactId
 * @param {string} revisionId
 * @param {'html'|'md'} type
 * @param {Buffer} bytes exact bytes that produced revisionId
 * @param {string} contentType
 */
async function putSnapshotVerified(artifactId, revisionId, type, bytes, contentType) {
  const key = revisionKey(artifactId, revisionId, type);
  // Byte-exact comparison: download the object as a Buffer (a decoded string round-trip can map
  // different bytes, e.g. 0xFF, to the same replacement sequence and hide a hash mismatch).
  const existing = r2GetBuffer(key);
  if (existing != null) {
    // Byte-exact download comparison (never a decoded-string hash).
    await assertSnapshotBytes(existing, revisionId);
    return;
  }
  r2PutBuffer(key, bytes, contentType);
  const written = r2GetBuffer(key);
  if (written == null) throw new Error(`snapshot ${key} is missing after upload`);
  if ((await snapshotRevisionId(written)) !== revisionId) {
    throw new Error(`snapshot ${key} read-back hash mismatch after upload`);
  }
}

async function verifyManifest(artifactId, revisionId, { expectLatest }) {
  const raw = r2GetText(registryKey(artifactId));
  if (raw == null) return false;
  let registry;
  try {
    registry = normalizeRegistry(JSON.parse(raw));
  } catch {
    return false;
  }
  if (!registry || !findRevision(registry, revisionId)) return false;
  return expectLatest ? registry.latestRevisionId === revisionId : true;
}

/**
 * Register one revision (see file header).
 * @param {{ project: string, file: string, source: string, createdBy?: string, out?: string }} input
 */
async function registerRevision({ project, file, source, createdBy = 'deliver', out }) {
  assertProjectName(project);
  assertFilePath(file);
  if (!fs.existsSync(source)) throw new Error(`source file not found: ${source}`);

  const type = artifactTypeFor(project, file);
  const contentType = contentTypeFor(type);
  const bytes = fs.readFileSync(source);
  const revisionId = await sha256Hex(new Uint8Array(bytes));
  const artifactId = await artifactIdFor(project, file);
  const contentKey = `content/${project}/${file}`;
  let bootstrapped = null;
  let revived = false;

  for (let attempt = 1; attempt <= 6; attempt++) {
    const current = await readRegistryState(artifactId);
    let registry = current.registry;
    bootstrapped = null;
    revived = false;

    if (!registry) {
      registry = createRegistry({ artifactId, project, file, type });
      const previousBytes = r2GetBuffer(contentKey);
      if (previousBytes != null) {
        const previousHash = await sha256Hex(new Uint8Array(previousBytes));
        if (previousHash !== revisionId) {
          // Snapshot the exact bytes we are about to overwrite, then register them as revision 1.
          await putSnapshotVerified(artifactId, previousHash, type, previousBytes, contentType);
          const baseline = addRevision(registry, {
            revisionId: previousHash,
            size: previousBytes.length,
            createdBy: 'bootstrap',
            contentType,
            publicationId: randomUUID(),
          });
          bootstrapped = baseline.revision;
          registry = baseline.registry;
        }
      }
    } else if (registry.tombstone) {
      // Deliberate republish of an unpublished path: clear the permanent marker.
      registry = { ...registry, tombstone: false, tombstonedAt: '' };
      revived = true;
    }

    const existing = findRevision(registry, revisionId);
    // Immutable snapshot: upload the exact captured bytes, verified against the hash.
    await putSnapshotVerified(artifactId, revisionId, type, bytes, contentType);

    // Identical republish of a live artifact: a true no-op (no number, no generation bump).
    if (existing && !revived && !bootstrapped) {
      const finalRaw = r2GetText(registryKey(artifactId));
      const finalRegistry = finalRaw ? normalizeRegistry(JSON.parse(finalRaw)) : registry;
      if (out) fs.writeFileSync(out, JSON.stringify(finalRegistry, null, 2) + '\n');
      return { registry: finalRegistry, revision: findRevision(finalRegistry, revisionId), added: false, bootstrapped, revived: false };
    }

    const publicationId = existing && !revived ? existing.publicationId || randomUUID() : randomUUID();
    const added = addRevision(registry, {
      revisionId,
      size: bytes.length,
      createdBy,
      contentType,
      publicationId,
    });
    const next = {
      ...added.registry,
      generation: (registry.generation || 0) + 1,
      publicationId,
    };
    const written = await writeRegistryState(next, current);
    if (!written.ok) {
      console.error(`revisions: manifest changed concurrently (attempt ${attempt}); retrying`);
      continue;
    }
    const isNew = !existing;
    if (!(await verifyManifest(artifactId, revisionId, { expectLatest: isNew || revived }))) {
      console.error(`revisions: manifest read-back verification failed (attempt ${attempt}); retrying`);
      continue;
    }
    const verifiedRaw = r2GetText(registryKey(artifactId));
    const verifiedRegistry = verifiedRaw ? normalizeRegistry(JSON.parse(verifiedRaw)) : next;
    if (out) fs.writeFileSync(out, JSON.stringify(verifiedRegistry, null, 2) + '\n');
    return {
      registry: verifiedRegistry,
      revision: findRevision(verifiedRegistry, revisionId),
      added: isNew,
      bootstrapped,
      revived,
    };
  }
  throw new Error('revisions: could not persist the revision manifest after 6 attempts');
}

async function commandRegister(args) {
  const project = args.project;
  const file = args.file;
  const source = args.source;
  if (!project || !file || !source) {
    throw new Error('register requires --project, --file and --source');
  }
  const result = await registerRevision({
    project,
    file,
    source,
    createdBy: args.createdBy || 'deliver',
    out: args.out,
  });
  const registry = result.registry;
  console.log(
    `revisions: ${project}/${file} → v${result.revision.number} (${result.revision.revisionId.slice(0, 12)}…)` +
      (result.added ? '' : ' [already registered]'),
  );
  if (result.bootstrapped) console.log(`revisions: snapshot of previous bytes registered as v${result.bootstrapped.number}`);
  if (result.revived) console.log('revisions: tombstone cleared by deliberate republish');
  console.log(
    `revisions: latest v${registry.latestRevisionNumber}/${registry.revisions.length}, generation ${registry.generation}, artifactId=${registry.artifactId}`,
  );
  return { registry, revision: result.revision, added: result.added };
}

function catalogFiles(catalog, { project, file } = {}) {
  const out = [];
  for (const [projectName, entry] of Object.entries(catalog.projects || {})) {
    if (project && projectName !== project) continue;
    for (const fileEntry of entry?.files || []) {
      if (!fileEntry || typeof fileEntry.file !== 'string') continue;
      if (file && fileEntry.file !== file) continue;
      if (!/\.(html|md)$/i.test(fileEntry.file)) continue;
      out.push({ project: projectName, file: fileEntry.file, entry: fileEntry });
    }
  }
  return out;
}

async function commandBootstrap(args) {
  const raw = r2GetText(CATALOG_KEY);
  if (raw == null) throw new Error('meta/catalog.json is missing; nothing to bootstrap');
  const catalog = JSON.parse(raw);
  const candidates = catalogFiles(catalog, args);
  if (!candidates.length) {
    console.log('revisions: no matching artifacts in the catalog');
    return;
  }

  const plans = [];
  for (const candidate of candidates) {
    const artifactId = await artifactIdFor(candidate.project, candidate.file);
    const state = await readRegistryState(artifactId);
    if (state.registry?.tombstone) {
      console.warn(`revisions: skip ${candidate.project}/${candidate.file} (tombstoned by unpublish)`);
      continue;
    }
    if (state.registry && !args.force) continue;
    const contentBytes = r2GetBuffer(`content/${candidate.project}/${candidate.file}`);
    if (contentBytes == null) {
      console.warn(`revisions: skip ${candidate.project}/${candidate.file} (content object missing)`);
      continue;
    }
    const revisionId = await sha256Hex(new Uint8Array(contentBytes));
    plans.push({ ...candidate, artifactId, revisionId, contentBytes });
  }

  if (!plans.length) {
    console.log('revisions: every catalog artifact already has a manifest');
    return;
  }
  console.log(`revisions: ${plans.length} artifact(s) ${args.apply ? 'to bootstrap' : 'would be bootstrapped (dry-run)'}`);
  for (const plan of plans) {
    console.log(`  ${plan.project}/${plan.file} → artifactId=${plan.artifactId} v1=${plan.revisionId.slice(0, 12)}… (${plan.contentBytes.length} bytes)`);
  }
  if (!args.apply) {
    console.log('revisions: dry-run only — re-run with --apply to write snapshots + manifests + catalog fields');
    return;
  }

  const now = new Date().toISOString();
  let failures = 0;
  for (const plan of plans) {
    const type = artifactTypeFor(plan.project, plan.file);
    const contentType = contentTypeFor(type);
    // The plan captured content + hash together: keep using those bytes for the upload so a
    // concurrent edit of content/ cannot put different bytes under the planned revision id.
    const captured = plan.contentBytes;
    if (!captured) {
      console.warn(`revisions: skip ${plan.project}/${plan.file} (no captured content)`);
      continue;
    }
    try {
      const current = await readRegistryState(plan.artifactId);
      await putSnapshotVerified(plan.artifactId, plan.revisionId, type, captured, contentType);
      const registry = createRegistry({ artifactId: plan.artifactId, project: plan.project, file: plan.file, type, createdAt: now });
      const { registry: next } = addRevision(registry, {
        revisionId: plan.revisionId,
        size: captured.length,
        createdBy: 'bootstrap',
        createdAt: now,
        contentType,
        publicationId: randomUUID(),
      });
      next.generation = 1;
      next.publicationId = next.revisions[0].publicationId;
      const written = await writeRegistryState(next, current);
      if (!written.ok) throw new Error('manifest changed concurrently');
      if (!(await verifyManifest(plan.artifactId, plan.revisionId, { expectLatest: true }))) {
        throw new Error('manifest read-back verification failed');
      }
      plan.entry.artifactId = next.artifactId;
      plan.entry.latestRevisionId = next.latestRevisionId;
      plan.entry.latestRevisionNumber = next.latestRevisionNumber;
      plan.entry.revisionCount = next.revisions.length;
      console.log(`revisions: bootstrapped ${plan.project}/${plan.file} (v1 ${plan.revisionId.slice(0, 12)}…)`);
    } catch (error) {
      failures++;
      console.error(`revisions: bootstrap failed for ${plan.project}/${plan.file}: ${error.message}`);
    }
  }

  catalog.updatedAt = now;
  r2BackupText(CATALOG_KEY, raw);
  r2PutText(CATALOG_KEY, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`revisions: catalog updated with revision fields (${plans.length - failures} artifacts)`);
  if (failures) throw new Error(`${failures} artifact(s) failed to bootstrap`);
}

async function commandStatus(args) {
  if (!args.project || !args.file) throw new Error('status requires --project and --file');
  assertProjectName(args.project);
  assertFilePath(args.file);
  const artifactId = await artifactIdFor(args.project, args.file);
  const state = await readRegistryState(artifactId);
  if (!state.registry) {
    console.log(JSON.stringify({ artifactId, project: args.project, file: args.file, revisioningEnabled: false, revisions: [] }, null, 2));
    return;
  }
  console.log(JSON.stringify(state.registry, null, 2));
}

export async function runCli(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || command === 'help' || args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 25).join('\n'));
    return;
  }
  if (command === 'register') return commandRegister(args);
  if (command === 'bootstrap') return commandBootstrap(args);
  if (command === 'status') return commandStatus(args);
  throw new Error(`unknown command: ${command} (expected register|bootstrap|status)`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`revisions: ${error && error.message ? error.message : error}`);
    process.exit(1);
  });
}
