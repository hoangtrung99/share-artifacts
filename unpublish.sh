#!/usr/bin/env bash
# Remove an artifact (or whole project) from R2 + catalog.
#
#   unpublish.sh <project>/<file>        # one page; with or without .html/.md
#   unpublish.sh <project>/<file>.html
#   unpublish.sh <project>               # entire project (all catalog files)
#
# Security-critical ordering: a permanent TOMBSTONE in the revision manifest is written FIRST, so
# viewer/raw/?rev/feedback/history return 404 before any bytes are touched. The tombstone marker is
# KEPT (never deleted) so the legacy content/ fallback can never resurrect unpublished bytes.
# Only afterwards are the mutable content object and the immutable snapshots deleted. A later
# deliberate `deliver.sh` clears the tombstone (that is the only way to republish the path).
#
# Failures are collected and the script exits non-zero; nothing is silent.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BUCKET="artifacts-content"

TARGET="${1:-}"
[ -n "$TARGET" ] || { sed -n '2,10p' "$0"; exit 1; }
TARGET="${TARGET#/}"; TARGET="${TARGET%/}"

PROJECT="${TARGET%%/*}"
REST="${TARGET#*/}"

ERRORS=0

# Write a permanent tombstone manifest for one artifact. Safe to re-run.
tombstone_artifact() {
  local project="$1" file="$2"
  node --input-type=module -e '
import { r2GetText, r2PutText } from "./scripts/lib/r2-cli.mjs";
import { artifactIdFor, artifactTypeFor, registryKey } from "./functions/_feedback-revisions.js";
const [project, file] = process.argv.slice(1);
const artifactId = await artifactIdFor(project, file);
const type = artifactTypeFor(project, file);
const previous = r2GetText(registryKey(artifactId));
const now = new Date().toISOString();
let registry = null;
if (previous != null) { try { registry = JSON.parse(previous); } catch { registry = null; } }
if (!registry || typeof registry !== "object") {
  registry = { schemaVersion: 1, artifactId, project, file, type, createdAt: now, updatedAt: now,
    generation: 1, publicationId: "", latestRevisionId: "", latestRevisionNumber: 0, revisions: [] };
}
registry.artifactId ||= artifactId;
registry.project ||= project;
registry.file ||= file;
registry.type ||= type;
registry.tombstone = true;
registry.tombstonedAt = now;
registry.updatedAt = now;
registry.generation = Number.isInteger(registry.generation) ? registry.generation + 1 : 1;
r2PutText(registryKey(artifactId), JSON.stringify(registry, null, 2) + "\n");
' "$project" "$file"
}

# Delete the immutable snapshots for one artifact (the tombstone manifest stays).
remove_snapshots() {
  local project="$1" file="$2"
  node --input-type=module -e '
import { r2GetText, r2DeleteMany } from "./scripts/lib/r2-cli.mjs";
import { artifactIdFor, registryKey, revisionKey, artifactTypeFor } from "./functions/_feedback-revisions.js";
const [project, file] = process.argv.slice(1);
const artifactId = await artifactIdFor(project, file);
const type = artifactTypeFor(project, file);
const raw = r2GetText(registryKey(artifactId));
const keys = [];
if (raw) {
  try {
    const registry = JSON.parse(raw);
    for (const revision of registry.revisions || []) {
      if (revision && typeof revision.revisionId === "string") keys.push(revisionKey(artifactId, revision.revisionId, type));
    }
  } catch { /* keep the tombstone; nothing else to clean */ }
}
const errors = await r2DeleteMany(keys, 8);
for (const error of errors) console.warn("  snapshot delete failed:", error);
if (errors.length) process.exitCode = 2;
' "$project" "$file"
}

remove_one() {
  local project="$1" file="$2"
  local key="content/${project}/${file}"
  echo "🪦 Tombstoning ${project}/${file} (viewer/raw/?rev/feedback stop serving immediately)"
  if ! tombstone_artifact "$project" "$file"; then
    echo "  ⚠ tombstone failed for ${project}/${file}" >&2
    ERRORS=$((ERRORS + 1))
    return 0 # never delete bytes without a tombstone
  fi
  echo "🗑  R2 delete ${BUCKET}/${key}"
  if ! npx wrangler r2 object delete "${BUCKET}/${key}" --remote; then
    echo "  ⚠ content delete failed for ${key}" >&2
    ERRORS=$((ERRORS + 1))
  fi
  if ! remove_snapshots "$project" "$file"; then
    echo "  ⚠ snapshot cleanup failed for ${project}/${file}" >&2
    ERRORS=$((ERRORS + 1))
  fi
  if ! node scripts/catalog-upsert.mjs --project "$project" --file "$file" --remove; then
    echo "  ⚠ catalog update failed for ${project}/${file}" >&2
    ERRORS=$((ERRORS + 1))
  fi
}

if [ "$PROJECT" = "$TARGET" ]; then
  # Whole project — list files from the catalog via a small node helper.
  echo "🪦 Removing entire project: $PROJECT"
  if ! node --input-type=module -e '
import { r2GetText, r2PutText, r2BackupText, r2DeleteMany } from "./scripts/lib/r2-cli.mjs";
import { artifactIdFor, artifactTypeFor, registryKey, revisionKey } from "./functions/_feedback-revisions.js";
const project = process.argv[1];
const raw = r2GetText("meta/catalog.json");
if (!raw) { console.log("catalog empty"); process.exit(0); }
const catalog = JSON.parse(raw);
const files = catalog.projects?.[project]?.files || [];
const now = new Date().toISOString();

// 1. Tombstone every artifact FIRST: serving must 404 before any bytes change.
const tombstones = [];
for (const entry of files) {
  const artifactId = await artifactIdFor(project, entry.file);
  const type = artifactTypeFor(project, entry.file);
  const previous = r2GetText(registryKey(artifactId));
  let registry = null;
  if (previous != null) { try { registry = JSON.parse(previous); } catch { registry = null; } }
  if (!registry || typeof registry !== "object") {
    registry = { schemaVersion: 1, artifactId, project, file: entry.file, type, createdAt: now, updatedAt: now,
      generation: 1, publicationId: "", latestRevisionId: "", latestRevisionNumber: 0, revisions: [] };
  }
  registry.artifactId ||= artifactId;
  registry.project ||= project;
  registry.file ||= entry.file;
  registry.type ||= type;
  registry.tombstone = true;
  registry.tombstonedAt = now;
  registry.updatedAt = now;
  registry.generation = Number.isInteger(registry.generation) ? registry.generation + 1 : 1;
  try {
    r2PutText(registryKey(artifactId), JSON.stringify(registry, null, 2) + "\n");
    tombstones.push({ file: entry.file, artifactId, registry });
  } catch (error) {
    console.warn("  tombstone failed for", entry.file, "-", error.message);
    process.exitCode = 2;
  }
}

// 2. If ANY tombstone failed, abort before touching bytes/metadata/discovery: a surviving
//    snapshot must never outlive unpublish. Tombstones are idempotent, so a rerun is safe.
if (process.exitCode) {
  console.error("  aborting: at least one tombstone failed; content/snapshots/catalog untouched");
  process.exit(3);
}

// 3. Back up the catalog BEFORE deleting anything; a failed backup aborts the removal.
r2BackupText("meta/catalog.json", raw);

// 4. Delete mutable content objects.
const contentKeys = files.map((entry) => "content/" + project + "/" + entry.file);
console.log("  deleting", contentKeys.length, "content object(s) with concurrency 8…");
const contentErrors = await r2DeleteMany(contentKeys, 8);
for (const error of contentErrors) console.warn("  content delete failed:", error);
if (contentErrors.length) process.exitCode = 2;

// 5. Delete immutable snapshots only; KEEP the tombstone manifests.
const snapshotKeys = [];
for (const tombstone of tombstones) {
  const type = artifactTypeFor(project, tombstone.file);
  for (const revision of tombstone.registry.revisions || []) {
    if (revision && typeof revision.revisionId === "string") {
      snapshotKeys.push(revisionKey(tombstone.artifactId, revision.revisionId, type));
    }
  }
}
const snapshotErrors = await r2DeleteMany(snapshotKeys, 8);
for (const error of snapshotErrors) console.warn("  snapshot delete failed:", error);
if (snapshotErrors.length) process.exitCode = 2;

// 6. Update discovery metadata.
delete catalog.projects[project];
catalog.updatedAt = now;
r2PutText("meta/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
console.log("catalog updated");
' "$PROJECT"; then
    echo "  ⚠ project removal failed for ${PROJECT}" >&2
    ERRORS=$((ERRORS + 1))
  fi

  if [ "$ERRORS" -eq 0 ]; then
    if grep -qxF "$PROJECT" protected.list 2>/dev/null; then
      echo "↳ project '$PROJECT' is protected — unprotecting…"
      ./protect.sh --unprotect "$PROJECT" || true
    fi
    if grep -qxF "$PROJECT" ghost.list 2>/dev/null; then
      echo "↳ project '$PROJECT' is ghost — unghosting…"
      ./ghost.sh --unghost "$PROJECT" || true
    fi
  else
    echo "❌ Removal aborted: ${ERRORS} error(s); bytes/metadata/protection left intact. Fix the tombstone failure and re-run." >&2
    exit 1
  fi
  echo "✅ Removed project '$PROJECT' from R2 (tombstones retained)."
  exit 0
fi

# Single file (extensionless targets probe both html and md, as before).
if [[ "$REST" == *.html || "$REST" == *.md ]]; then
  remove_one "$PROJECT" "$REST"
else
  for ext in html md; do
    remove_one "$PROJECT" "${REST}.${ext}"
  done
fi

if [ "$ERRORS" -ne 0 ]; then
  echo "❌ Unpublished '$TARGET' with ${ERRORS} cleanup error(s); tombstones keep it unservable. Re-run to retry cleanup." >&2
  exit 1
fi
echo "✅ Unpublished '$TARGET' from R2 (tombstone retained)."
