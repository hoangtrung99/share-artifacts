#!/usr/bin/env bash
# Quản lý mật khẩu Basic Auth cho từng folder (project) trên Cloudflare Pages.
# Mật khẩu lưu dạng SECRET trên Cloudflare (PW_<FOLDER>) — KHÔNG bao giờ nằm trong git.
#
#   ./protect.sh <folder> [password]    # bật/đổi mật khẩu cho folder
#   ./protect.sh --list                 # liệt kê folder đang được bảo vệ
#   ./protect.sh --unprotect <folder>   # gỡ bảo vệ (xoá secret)
#
# Yêu cầu: đã `npx wrangler login` (hoặc đặt CLOUDFLARE_API_TOKEN) và Pages project tồn tại.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PROJECT="artifacts"
LIST="$ROOT/protected.list"   # chỉ chứa TÊN folder (không phải mật khẩu) -> để hiện badge 🔒
touch "$LIST"

key_for() { printf 'PW_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"; }
add_list() { grep -qxF "$1" "$LIST" || printf '%s\n' "$1" >> "$LIST"; }
del_list() { grep -vxF "$1" "$LIST" > "$LIST.tmp" 2>/dev/null || true; mv "$LIST.tmp" "$LIST"; }

case "${1:-}" in
  --list)
    echo "Folder đang được bảo vệ (theo protected.list):"
    if [ -s "$LIST" ]; then sort -u "$LIST" | sed 's/^/  🔒 /'; else echo "  (chưa có)"; fi
    ;;
  --unprotect)
    folder="${2:?Thiếu tên folder}"
    k="$(key_for "$folder")"
    echo "Xoá secret $k khỏi project $PROJECT…"
    npx wrangler pages secret delete "$k" --project-name="$PROJECT"
    del_list "$folder"
    echo "✅ Đã gỡ bảo vệ '$folder'. Chạy ./deploy.sh để cập nhật badge."
    ;;
  ""|-h|--help)
    sed -n '2,9p' "$0"
    ;;
  *)
    folder="$1"
    [ -d "$ROOT/public/$folder" ] || echo "⚠  Chưa thấy public/$folder — vẫn set được, nhưng hãy kiểm tra lại tên." >&2
    k="$(key_for "$folder")"
    pw="${2:-}"
    echo "Đặt mật khẩu cho '$folder'  ->  secret $k  (project $PROJECT)…"
    if [ -n "$pw" ]; then
      printf '%s' "$pw" | npx wrangler pages secret put "$k" --project-name="$PROJECT"
    else
      npx wrangler pages secret put "$k" --project-name="$PROJECT"   # wrangler tự hỏi giá trị (đáng tin nhất)
    fi
    echo "🔎 Xác minh secret đã tồn tại trên project…"
    if npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -qw "$k"; then
      add_list "$folder"
      echo "✅ Đã bảo vệ '$folder' (secret $k xác nhận tồn tại)."
      echo "   → Chạy ./deploy.sh để cập nhật badge 🔒 và đẩy middleware."
      echo "   → Sau deploy, kiểm chứng: mở https://artifacts.hoangtrung.dev/$folder/ phải hỏi mật khẩu."
    else
      echo "❌ KHÔNG thấy secret $k sau khi set — folder CHƯA được bảo vệ, không đánh dấu protected." >&2
      echo "   Thử lại (bỏ tham số mật khẩu để wrangler tự hỏi): ./protect.sh '$folder'" >&2
      exit 1
    fi
    ;;
esac
