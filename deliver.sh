#!/usr/bin/env bash
# Deliver ONE artifact (HTML or Markdown) to artifacts.hoangtrung.dev via R2.
# No Astro rebuild, no Pages deploy of content, no git commit of artifacts.
#
#   deliver.sh <file.html|file.md> [project] [--name <newname>.(html|md)] [--protect [password]] [--ghost] [--open]
#
#   <file>             source file (required): self-contained HTML, or Markdown (.md)
#   [project]          project folder name (default: "shared")
#   --name <x>         rename on publish (must keep .html or .md)
#   --protect [pw]     password-protect the project (sets CF secret + R2 registry)
#   --ghost            hide project from home; unlock via /ghost master password
#   --open             open viewer URL after success
#
# Example:
#   ./deliver.sh ./report.html cost-review
#   → viewer: https://artifacts.hoangtrung.dev/cost-review/report
#   → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SITE="https://artifacts.hoangtrung.dev"
BUCKET="artifacts-content"

SRC="${1:-}"
[ -n "$SRC" ] || { sed -n '2,18p' "$0"; exit 1; }
shift

PROJECT="shared"; NAME=""; PROTECT=0; PROTECT_PW=""; GHOST=0; OPEN=0
if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then PROJECT="$1"; shift; fi
while [ "${1:-}" ]; do
  case "$1" in
    --name)    NAME="${2:?--name needs a value}"; shift 2;;
    --protect) PROTECT=1; shift; if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then PROTECT_PW="$1"; shift; fi;;
    --ghost)   GHOST=1; shift;;
    --open)    OPEN=1; shift;;
    *) echo "❌ Unknown arg: $1" >&2; exit 1;;
  esac
done

[ -f "$SRC" ] || { echo "❌ File not found: $SRC" >&2; exit 1; }

# Resolve to absolute for wrangler --file=
SRC_ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"

BASENAME="${NAME:-$(basename "$SRC")}"
case "$BASENAME" in
  *.html|*.md) ;;
  *) echo "❌ Only .html or .md supported (got: $BASENAME)." >&2; exit 1;;
esac

# Optional subpath not supported here — file lands at project root.
# For nested paths, pass --name "folder/file.html".
FILE_REL="$BASENAME"
KEY="content/${PROJECT}/${FILE_REL}"

case "$BASENAME" in
  *.html) CT="text/html; charset=utf-8";;
  *.md)   CT="text/markdown; charset=utf-8";;
esac

echo "📤 Uploading to R2: ${BUCKET}/${KEY}"
npx wrangler r2 object put "${BUCKET}/${KEY}" --file="$SRC_ABS" --content-type="$CT" --remote

# Extract metadata + upsert catalog
META_TMP="$(mktemp)"
node --input-type=module -e "
import fs from 'node:fs';
import { extractMeta } from './scripts/lib/meta.mjs';
const raw = fs.readFileSync(process.argv[1], 'utf8');
const meta = extractMeta(raw, process.argv[2], process.argv[3]);
fs.writeFileSync(process.argv[4], JSON.stringify(meta));
" "$SRC_ABS" "$PROJECT" "$FILE_REL" "$META_TMP"

node scripts/catalog-upsert.mjs --project "$PROJECT" --file "$FILE_REL" --meta-file "$META_TMP"
rm -f "$META_TMP"

if [ "$PROTECT" = 1 ]; then
  if [ -n "$PROTECT_PW" ]; then ./protect.sh "$PROJECT" "$PROTECT_PW"; else ./protect.sh "$PROJECT"; fi
fi

if [ "$GHOST" = 1 ]; then
  ./ghost.sh "$PROJECT" --ensure-master
fi

CLEAN="${BASENAME##*/}"
CLEAN="${CLEAN%.*}"
# If --name had a folder prefix, keep it in the viewer path
VIEW_REL="${FILE_REL%.*}"
RAW_URL="${SITE}/${PROJECT}/${FILE_REL}"
VIEW_URL="${SITE}/${PROJECT}/${VIEW_REL}"

echo
echo "✅ Delivered (R2 — live without rebuild):"
echo "   $VIEW_URL        (viewer)"
echo "   $RAW_URL         (raw)"
[ "$OPEN" = 1 ] && command -v open >/dev/null && open "$VIEW_URL" || true
