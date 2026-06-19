#!/usr/bin/env bash
# Gỡ artifact khỏi artifacts.hoangtrung.dev (xoá khỏi src/artifacts rồi build + deploy lại).
#
#   unpublish.sh <project>/<file>        # xoá 1 page; <file> có thể kèm .html/.md hoặc bỏ đuôi
#   unpublish.sh <project>/<file>.html   # xoá đúng 1 đuôi
#   unpublish.sh <project>               # xoá cả project (tự gỡ mật khẩu nếu có)
#
# Build wipe lại public/ và dist/ từ src/artifacts (source of truth), deploy upload atomic,
# nên xoá khỏi src/artifacts + deploy = page biến mất khỏi web.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

TARGET="${1:-}"
[ -n "$TARGET" ] || { sed -n '2,9p' "$0"; exit 1; }
TARGET="${TARGET#/}"; TARGET="${TARGET%/}"   # bỏ slash thừa
BASE="src/artifacts/$TARGET"

removed=0

# 1) Trùng đúng file (caller gõ kèm đuôi).
if [ -f "$BASE" ]; then
  rm -f "$BASE"
  echo "🗑  Đã xoá page: $TARGET"
  removed=1
fi

# 2) Tên "sạch" (không đuôi): xoá cả .html và .md nếu có (cùng map về 1 viewer URL).
if [ "$removed" = 0 ]; then
  for ext in html md; do
    if [ -f "$BASE.$ext" ]; then
      rm -f "$BASE.$ext"
      echo "🗑  Đã xoá page: $TARGET.$ext"
      removed=1
    fi
  done
fi

# 3) Cả project (thư mục cấp 1).
if [ "$removed" = 0 ] && [ -d "$BASE" ]; then
  PROJECT="${TARGET%%/*}"
  rm -rf "$BASE"
  echo "🗑  Đã xoá project: $TARGET"
  removed=1
  if grep -qxF "$PROJECT" protected.list 2>/dev/null; then
    echo "↳ project '$PROJECT' đang có mật khẩu — gỡ bảo vệ (xoá secret)…"
    ./protect.sh --unprotect "$PROJECT" || true
  fi
fi

if [ "$removed" = 0 ]; then
  echo "❌ Không thấy: $BASE (đã thử .html, .md và thư mục project)" >&2
  exit 1
fi

./deploy.sh
echo "✅ Đã gỡ '$TARGET' khỏi artifacts.hoangtrung.dev."
