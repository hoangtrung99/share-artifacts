#!/usr/bin/env bash
# Quản lý mật khẩu cho từng folder (project) trên Cloudflare Pages.
# Auth dùng trang /login (form có style) + signed cookie (HMAC-SHA256 trên COOKIE_SECRET) —
# KHÔNG còn popup HTTP Basic Auth. Xem functions/_middleware.js + functions/login.js.
#
# Mật khẩu lưu dạng SECRET trên Cloudflare (PW_<FOLDER>) — KHÔNG bao giờ nằm trong git.
# Tên folder thêm vào protected.list (chỉ TÊN, không phải mật khẩu) → prepare-static.mjs sinh
# functions/protected-folders.js để middleware fail-closed. Chạy ./deploy.sh để build + đẩy.
#
#   ./protect.sh <folder> [password]    # bật/đổi mật khẩu cho folder
#   ./protect.sh --list                 # liệt kê folder đang được bảo vệ
#   ./protect.sh --unprotect <folder>   # gỡ bảo vệ (xoá secret + bỏ khỏi protected.list)
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

secret_exists() { npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -qw "$1"; }

# Đảm bảo COOKIE_SECRET (khoá ký cookie) tồn tại trên project. Middleware fail-closed: một folder
# có PW_<x> nhưng THIẾU COOKIE_SECRET sẽ trả 403 (misconfigured), không hiện trang login. Tạo idempotent:
# chỉ sinh khi CHƯA có — KHÔNG bao giờ ghi đè (ghi đè sẽ vô hiệu mọi cookie đăng nhập đang còn hạn).
ensure_cookie_secret() {
  if secret_exists "COOKIE_SECRET"; then
    return 0
  fi
  echo "🔑 Chưa có COOKIE_SECRET (khoá ký cookie) — sinh ngẫu nhiên và đặt lên project…"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "❌ Cần 'openssl' để sinh COOKIE_SECRET. Cài openssl hoặc đặt thủ công:" >&2
    echo "   openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name=$PROJECT" >&2
    exit 1
  fi
  openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name="$PROJECT"
  if secret_exists "COOKIE_SECRET"; then
    echo "✅ COOKIE_SECRET đã được tạo."
  else
    echo "❌ Không xác nhận được COOKIE_SECRET sau khi tạo — kiểm tra lại quyền wrangler." >&2
    exit 1
  fi
}

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
    sed -n '2,14p' "$0"
    ;;
  *)
    folder="$1"
    [ -d "$ROOT/src/artifacts/$folder" ] || echo "⚠  Chưa thấy src/artifacts/$folder — vẫn set được, nhưng hãy kiểm tra lại tên." >&2
    k="$(key_for "$folder")"
    pw="${2:-}"

    # Khoá ký phải có TRƯỚC khi bật bảo vệ, nếu không folder sẽ 403 thay vì hiện login.
    ensure_cookie_secret

    echo "Đặt mật khẩu cho '$folder'  ->  secret $k  (project $PROJECT)…"
    if [ -n "$pw" ]; then
      printf '%s' "$pw" | npx wrangler pages secret put "$k" --project-name="$PROJECT"
    else
      npx wrangler pages secret put "$k" --project-name="$PROJECT"   # wrangler tự hỏi giá trị (đáng tin nhất)
    fi
    echo "🔎 Xác minh secret đã tồn tại trên project…"
    if secret_exists "$k"; then
      add_list "$folder"
      echo "✅ Đã bảo vệ '$folder' (secret $k + COOKIE_SECRET xác nhận tồn tại)."
      echo "   → Chạy ./deploy.sh để cập nhật badge 🔒, sinh protected-folders.js và đẩy middleware."
      echo "   → Sau deploy, kiểm chứng: mở https://artifacts.hoangtrung.dev/$folder/ phải chuyển sang trang /login."
    else
      echo "❌ KHÔNG thấy secret $k sau khi set — folder CHƯA được bảo vệ, không đánh dấu protected." >&2
      echo "   Thử lại (bỏ tham số mật khẩu để wrangler tự hỏi): ./protect.sh '$folder'" >&2
      exit 1
    fi
    ;;
esac
