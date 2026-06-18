#!/usr/bin/env bash
# Gỡ artifact khỏi artifacts.hoangtrung.dev.
#   unpublish.sh <project>/<file>.html   # xoá 1 page
#   unpublish.sh <project>               # xoá cả project (tự gỡ mật khẩu nếu có)
#
# Deploy upload toàn bộ public/ dạng atomic, nên xoá local + deploy = page biến mất khỏi web.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

TARGET="${1:-}"
[ -n "$TARGET" ] || { sed -n '2,6p' "$0"; exit 1; }
TARGET="${TARGET#/}"; TARGET="${TARGET%/}"   # bỏ slash thừa
REL="public/$TARGET"

if [ -f "$REL" ]; then
  rm -f "$REL"
  echo "🗑  Đã xoá page: $TARGET"
elif [ -d "$REL" ]; then
  PROJECT="${TARGET%%/*}"
  rm -rf "$REL"
  echo "🗑  Đã xoá project: $TARGET"
  if grep -qxF "$PROJECT" protected.list 2>/dev/null; then
    echo "↳ project '$PROJECT' đang có mật khẩu — gỡ bảo vệ (xoá secret)…"
    ./protect.sh --unprotect "$PROJECT" || true
  fi
else
  echo "❌ Không thấy: $REL" >&2
  exit 1
fi

./deploy.sh
echo "✅ Đã gỡ '$TARGET' khỏi artifacts.hoangtrung.dev."
