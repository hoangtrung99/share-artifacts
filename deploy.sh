#!/usr/bin/env bash
# Sinh lại trang file-browser rồi deploy public/ lên Cloudflare Pages.
# Đọc cấu hình từ wrangler.jsonc (name=artifacts, pages_build_output_dir=./public).
# Chạy từ repo root để wrangler nhận thư mục functions/ (middleware Basic Auth).
#
# Kết quả: https://artifacts.hoangtrung.dev/<project>/<file>.html
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PUBLIC_DIR="$ROOT/public"
BRANCH="main"

[ -d "$PUBLIC_DIR" ] || { echo "❌ Không thấy thư mục: $PUBLIC_DIR" >&2; exit 1; }

echo "🧭 Sinh lại trang file-browser (index.html cho mỗi thư mục)…"
node "$ROOT/build-index.mjs" "$PUBLIC_DIR"

echo "🚀 Deploy lên Cloudflare Pages (project=artifacts, branch=$BRANCH)…"
npx wrangler pages deploy --branch="$BRANCH" --commit-dirty=true
