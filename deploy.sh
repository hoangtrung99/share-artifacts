#!/usr/bin/env bash
# Build site Astro tĩnh rồi deploy lên Cloudflare Pages.
#
# `pnpm run build` chạy 3 bước (xem package.json):
#   1. scripts/prepare-static.mjs  — copy raw artifact src/artifacts/ -> public/ (phục vụ verbatim
#                                    tại /<project>/<file>.(html|md)) + sinh functions/protected-folders.js
#   2. astro build                 — build gallery + viewer pages vào ./dist
#   3. pagefind --site dist        — index full-text search vào dist/pagefind/
#
# Sau đó `wrangler pages deploy` upload ./dist (pages_build_output_dir) và thư mục functions/ ở
# repo root (middleware login + signed cookie). Phải chạy từ repo root để wrangler nhận functions/.
#
# Idempotent: prepare-static wipe lại public/, astro build wipe lại dist/ mỗi lần chạy.
#
# Kết quả: https://artifacts.hoangtrung.dev/<project>/<file>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ARTIFACTS_DIR="$ROOT/src/artifacts"
BRANCH="main"

[ -d "$ARTIFACTS_DIR" ] || { echo "❌ Không thấy thư mục nguồn: $ARTIFACTS_DIR" >&2; exit 1; }

echo "🏗  Build site (prepare-static + astro build + pagefind)…"
pnpm run build

[ -d "$ROOT/dist" ] || { echo "❌ Build xong nhưng không thấy ./dist — kiểm tra lỗi build ở trên." >&2; exit 1; }

echo "🚀 Deploy lên Cloudflare Pages (project=artifacts, branch=$BRANCH)…"
npx wrangler pages deploy --branch="$BRANCH" --commit-dirty=true
