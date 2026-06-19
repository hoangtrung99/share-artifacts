#!/usr/bin/env bash
# Deliver MỘT artifact (HTML hoặc Markdown) lên artifacts.hoangtrung.dev chỉ bằng 1 lệnh.
# Dùng được từ BẤT KỲ thư mục nào (gọi bằng đường dẫn tuyệt đối tới script này).
#
#   deliver.sh <file.html|file.md> [project] [--name <newname>.(html|md)] [--protect [password]] [--open]
#
#   <file>             file nguồn (bắt buộc): HTML self-contained, hoặc Markdown (.md)
#   [project]          tên project/thư mục đích (mặc định: "shared")
#   --name <x>         đổi tên file khi publish (phải giữ đuôi .html hoặc .md)
#   --protect [pw]     bảo vệ project bằng login + signed cookie (nếu không kèm pw, wrangler sẽ hỏi)
#   --open             mở URL bằng trình duyệt sau khi xong
#
# Ví dụ:
#   ~/Local/Work/solashi/share-artifacts/deliver.sh ./report.html cost-review
#   → viewer: https://artifacts.hoangtrung.dev/cost-review/report
#   → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SRC="${1:-}"
[ -n "$SRC" ] || { sed -n '2,16p' "$0"; exit 1; }
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

BASENAME="${NAME:-$(basename "$SRC")}"
# prepare-static.mjs chỉ copy .html và .md sang public/. File đuôi khác (vd .htm) sẽ KHÔNG
# được phục vụ verbatim → 404. Validate đuôi của TÊN CUỐI (sau --name), không phải file nguồn.
case "$BASENAME" in
  *.html|*.md) ;;
  *) echo "❌ Chỉ hỗ trợ .html hoặc .md (nhận: $BASENAME). Lưu ý: .htm không được hỗ trợ." >&2; exit 1;;
esac

mkdir -p "src/artifacts/$PROJECT"
cp "$SRC" "src/artifacts/$PROJECT/$BASENAME"
echo "📥 $SRC  ->  src/artifacts/$PROJECT/$BASENAME"

if [ "$PROTECT" = 1 ]; then
  if [ -n "$PROTECT_PW" ]; then ./protect.sh "$PROJECT" "$PROTECT_PW"; else ./protect.sh "$PROJECT"; fi
fi

./deploy.sh

CLEAN="${BASENAME%.*}"   # bỏ đuôi cuối (an toàn cho tên nhiều dấu chấm: a.b.v2.md -> a.b.v2)
RAW_URL="https://artifacts.hoangtrung.dev/$PROJECT/$BASENAME"
VIEW_URL="https://artifacts.hoangtrung.dev/$PROJECT/$CLEAN"
echo
echo "✅ Delivered:"
echo "   $VIEW_URL        (viewer — toolbar + nội dung)"
echo "   $RAW_URL         (raw — file gốc)"
[ "$OPEN" = 1 ] && command -v open >/dev/null && open "$VIEW_URL" || true
