#!/usr/bin/env bash
# Deliver ONE artifact (HTML or Markdown) to artifacts.hoangtrung.dev via R2.
# No Astro rebuild, no Pages deploy of content, no git commit of artifacts.
#
#   deliver.sh <file.html|file.md> [project] [--name <newname>.(html|md)] [--date YYYY-MM-DD] [--protect [password]] [--ghost] [--open]
#
#   <file>             source file (required): self-contained HTML, or Markdown (.md)
#   [project]          project folder name (default: "shared")
#   --name <x>         rename on publish (must keep .html or .md)
#   --date <d>         explicit artifact/topic date (YYYY-MM-DD) when it cannot be extracted
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

PROJECT="shared"; NAME=""; ARTIFACT_DATE=""; PROTECT=0; PROTECT_PW=""; GHOST=0; OPEN=0
if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then PROJECT="$1"; shift; fi
while [ "${1:-}" ]; do
  case "$1" in
    --name)    NAME="${2:?--name needs a value}"; shift 2;;
    --date)    ARTIFACT_DATE="${2:?--date needs YYYY-MM-DD}"; shift 2;;
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

# Validate project/file names before uploading anything (the same rules the catalog enforces).
node --input-type=module -e "
import { assertProjectName, assertFilePath } from './scripts/lib/names.mjs';
assertProjectName(process.argv[1]);
assertFilePath(process.argv[2]);
" "$PROJECT" "$FILE_REL"

case "$BASENAME" in
  *.html) CT="text/html; charset=utf-8";;
  *.md)   CT="text/markdown; charset=utf-8";;
esac

echo "📤 Uploading to R2: ${BUCKET}/${KEY}"
npx wrangler r2 object put "${BUCKET}/${KEY}" --file="$SRC_ABS" --content-type="$CT" --remote

# Extract metadata + upsert catalog in one process (records uploadedAt/artifactDate).
CATALOG_ARGS=(--project "$PROJECT" --file "$FILE_REL" --source "$SRC_ABS")
[ -n "$ARTIFACT_DATE" ] && CATALOG_ARGS+=(--date "$ARTIFACT_DATE")
node scripts/catalog-upsert.mjs "${CATALOG_ARGS[@]}"

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
