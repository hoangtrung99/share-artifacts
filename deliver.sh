#!/usr/bin/env bash
# Deliver MỘT artifact HTML lên artifacts.hoangtrung.dev chỉ bằng 1 lệnh.
# Dùng được từ BẤT KỲ thư mục nào (gọi bằng đường dẫn tuyệt đối tới script này).
#
#   deliver.sh <file.html> [project] [--name <newname>.html] [--protect [password]] [--open]
#
#   <file.html>        file nguồn (bắt buộc), nên là HTML self-contained
#   [project]          tên project/thư mục đích (mặc định: "shared")
#   --name <x>.html    đổi tên file khi publish
#   --protect [pw]     đặt Basic Auth cho project (nếu không kèm pw, wrangler sẽ hỏi)
#   --open             mở URL bằng trình duyệt sau khi xong
#
# Ví dụ:
#   ~/Local/Work/solashi/share-artifacts/deliver.sh ./report.html cost-review
#   → https://artifacts.hoangtrung.dev/cost-review/report.html
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SRC="${1:-}"
[ -n "$SRC" ] || { sed -n '2,17p' "$0"; exit 1; }
shift

PROJECT="shared"; NAME=""; PROTECT=0; PROTECT_PW=""; OPEN=0
# project = đối số positional đầu tiên không bắt đầu bằng "--"
if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then PROJECT="$1"; shift; fi
while [ "${1:-}" ]; do
  case "$1" in
    --name)    NAME="${2:?--name cần giá trị}"; shift 2;;
    --protect) PROTECT=1; shift; if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then PROTECT_PW="$1"; shift; fi;;
    --open)    OPEN=1; shift;;
    *) echo "❌ Tham số lạ: $1" >&2; exit 1;;
  esac
done

[ -f "$SRC" ] || { echo "❌ Không thấy file: $SRC" >&2; exit 1; }
case "$SRC" in *.html|*.htm) ;; *) echo "❌ Không phải file HTML: $SRC" >&2; exit 1;; esac

BASENAME="${NAME:-$(basename "$SRC")}"
mkdir -p "public/$PROJECT"
cp "$SRC" "public/$PROJECT/$BASENAME"
echo "📥 $SRC  ->  public/$PROJECT/$BASENAME"

if [ "$PROTECT" = 1 ]; then
  if [ -n "$PROTECT_PW" ]; then ./protect.sh "$PROJECT" "$PROTECT_PW"; else ./protect.sh "$PROJECT"; fi
fi

./deploy.sh

CLEAN="${BASENAME%.html}"; CLEAN="${CLEAN%.htm}"
URL="https://artifacts.hoangtrung.dev/$PROJECT/$BASENAME"
echo
echo "✅ Delivered:"
echo "   $URL"
echo "   https://artifacts.hoangtrung.dev/$PROJECT/$CLEAN   (clean URL, bỏ .html)"
[ "$OPEN" = 1 ] && command -v open >/dev/null && open "$URL" || true
