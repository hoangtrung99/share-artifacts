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

# Pull code mới nhất để src/artifacts/ không lệch khi deploy từ nhiều máy.
# Chỉ pull khi working tree sạch — tránh rebase conflict/ghi đè thay đổi local chưa commit.
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  echo "⬇️  git pull --rebase…"
  git pull --rebase --quiet || echo "⚠️ git pull thất bại — tiếp tục với state local." >&2
else
  echo "⚠️ Working tree không sạch — bỏ qua git pull (commit/stash thủ công để tránh lệch)." >&2
fi

echo "🏗  Build site (prepare-static + astro build + pagefind)…"
pnpm run build

[ -d "$ROOT/dist" ] || { echo "❌ Build xong nhưng không thấy ./dist — kiểm tra lỗi build ở trên." >&2; exit 1; }

echo "🚀 Deploy lên Cloudflare Pages (project=artifacts, branch=$BRANCH)…"
npx wrangler pages deploy --branch="$BRANCH" --commit-dirty=true

# Commit + push toàn bộ src/artifacts vào git để các máy khác sync (share-artifacts là repo sync giữa các máy).
# deploy.sh deploy cả thư mục nên stage cả src/artifacts + protected/ghost list + functions sinh ra.
git add src/artifacts protected.list ghost.list functions/protected-folders.js functions/ghost-folders.js 2>/dev/null || true
if git diff --cached --quiet 2>/dev/null; then
  echo "ℹ️  Không có thay đổi để commit."
else
  echo "📤 git commit + push…"
  git commit -m "feat(artifacts): deploy site" --quiet \
    && git push --quiet \
    || echo "⚠️ git commit/push thất bại — web đã deploy, nhưng cần commit/push thủ công." >&2
fi
