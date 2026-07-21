#!/usr/bin/env bash
# Remove an artifact (or whole project) from R2 + catalog.
#
#   unpublish.sh <project>/<file>        # one page; with or without .html/.md
#   unpublish.sh <project>/<file>.html
#   unpublish.sh <project>               # entire project (all catalog files)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BUCKET="artifacts-content"

TARGET="${1:-}"
[ -n "$TARGET" ] || { sed -n '2,8p' "$0"; exit 1; }
TARGET="${TARGET#/}"; TARGET="${TARGET%/}"

PROJECT="${TARGET%%/*}"
REST="${TARGET#*/}"

remove_one() {
  local project="$1" file="$2"
  local key="content/${project}/${file}"
  echo "🗑  R2 delete ${BUCKET}/${key}"
  npx wrangler r2 object delete "${BUCKET}/${key}" --remote 2>/dev/null || true
  node scripts/catalog-upsert.mjs --project "$project" --file "$file" --remove || true
}

if [ "$PROJECT" = "$TARGET" ]; then
  # Whole project — list files from catalog via a small node helper
  echo "🗑  Removing entire project: $PROJECT"
  node --input-type=module -e "
import { r2GetText, r2Delete } from './scripts/lib/r2-cli.mjs';
const project = process.argv[1];
const raw = r2GetText('meta/catalog.json');
if (!raw) { console.log('catalog empty'); process.exit(0); }
const catalog = JSON.parse(raw);
const files = catalog.projects?.[project]?.files || [];
for (const f of files) {
  const key = 'content/' + project + '/' + f.file;
  console.log('  delete', key);
  try { r2Delete(key); } catch (e) { console.warn(e.message); }
}
delete catalog.projects[project];
catalog.updatedAt = new Date().toISOString();
const { r2PutText } = await import('./scripts/lib/r2-cli.mjs');
r2PutText('meta/catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log('catalog updated');
" "$PROJECT"

  if grep -qxF "$PROJECT" protected.list 2>/dev/null; then
    echo "↳ project '$PROJECT' is protected — unprotecting…"
    ./protect.sh --unprotect "$PROJECT" || true
  fi
  if grep -qxF "$PROJECT" ghost.list 2>/dev/null; then
    echo "↳ project '$PROJECT' is ghost — unghosting…"
    ./ghost.sh --unghost "$PROJECT" || true
  fi
  echo "✅ Removed project '$PROJECT' from R2."
  exit 0
fi

# Single file
removed=0
if [[ "$REST" == *.html || "$REST" == *.md ]]; then
  remove_one "$PROJECT" "$REST"
  removed=1
else
  for ext in html md; do
    # Probe via delete (idempotent)
    remove_one "$PROJECT" "${REST}.${ext}"
    removed=1
  done
fi

echo "✅ Unpublished '$TARGET' from R2."
