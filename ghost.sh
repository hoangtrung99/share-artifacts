#!/usr/bin/env bash
# Quản lý ghost projects — các project ẩn khỏi trang chủ, chỉ hiện qua /ghost sau khi nhập master password.
#
# Auth tương tự protect.sh: trang /ghost (form) + signed cookie cf_ghost (HMAC-SHA256 trên COOKIE_SECRET).
# Master password lưu dạng SECRET trên Cloudflare (GHOST_MASTER_PW) — KHÔNG bao giờ nằm trong git.
# Tên ghost project thêm vào ghost.list (chỉ TÊN, không phải mật khẩu) → prepare-static.mjs sinh
# functions/ghost-folders.js để middleware fail-closed. Chạy ./deploy.sh để build + đẩy.
#
#   ./ghost.sh <folder>                      # đánh dấu folder là ghost project
#   ./ghost.sh --list                        # liệt kê ghost projects
#   ./ghost.sh --unghost <folder>            # gỡ ghost
#   ./ghost.sh --set-master [password]       # đặt master password cho /ghost
#   ./ghost.sh --ensure-master               # đảm bảo GHOST_MASTER_PW tồn tại (dùng bởi deliver.sh)
#
# Yêu cầu: đã `npx wrangler login` (hoặc đặt CLOUDFLARE_API_TOKEN) và Pages project tồn tại.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PROJECT="artifacts"
LIST="$ROOT/ghost.list"
touch "$LIST"

add_list() { grep -qxF "$1" "$LIST" || printf '%s\n' "$1" >> "$LIST"; }
del_list() { grep -vxF "$1" "$LIST" > "$LIST.tmp" 2>/dev/null || true; mv "$LIST.tmp" "$LIST"; }

secret_exists() { npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -qw "$1"; }

# Đảm bảo COOKIE_SECRET tồn tại — middleware/ghost fail-closed nếu thiếu.
ensure_cookie_secret() {
  if secret_exists "COOKIE_SECRET"; then return 0; fi
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

# Đảm bảo GHOST_MASTER_PW tồn tại. Nếu chưa có, tự sinh một password dài (không in ra) HOẶC
# dùng password truyền vào.
ensure_master_password() {
  local pw="${1:-}"
  if secret_exists "GHOST_MASTER_PW"; then
    echo "✅ GHOST_MASTER_PW đã tồn tại."
    return 0
  fi
  echo "👻 Chưa có GHOST_MASTER_PW — đặt master password cho /ghost…"
  if [ -n "$pw" ]; then
    printf '%s' "$pw" | npx wrangler pages secret put GHOST_MASTER_PW --project-name="$PROJECT"
  else
    npx wrangler pages secret put GHOST_MASTER_PW --project-name="$PROJECT"
  fi
  if secret_exists "GHOST_MASTER_PW"; then
    echo "✅ GHOST_MASTER_PW đã được tạo."
  else
    echo "❌ Không xác nhận được GHOST_MASTER_PW sau khi tạo." >&2
    exit 1
  fi
}

case "${1:-}" in
  --list)
    echo "Ghost projects (theo ghost.list):"
    if [ -s "$LIST" ]; then sort -u "$LIST" | sed 's/^/  👻 /'; else echo "  (chưa có)"; fi
    ;;
  --unghost)
    folder="${2:?Thiếu tên folder}"
    del_list "$folder"
    echo "✅ Đã gỡ '$folder' khỏi ghost mode. Chạy ./deploy.sh để cập nhật ghost-folders.js."
    ;;
  --set-master)
    ensure_cookie_secret
    shift
    if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then
      ensure_master_password "$1"
    else
      ensure_master_password
    fi
    echo "   → Chạy ./deploy.sh để áp dụng master password."
    ;;
  --ensure-master)
    ensure_cookie_secret
    ensure_master_password "${2:-}"
    ;;
  ""|-h|--help)
    sed -n '2,18p' "$0"
    ;;
  *)
    folder="$1"
    [ -d "$ROOT/src/artifacts/$folder" ] || echo "⚠  Chưa thấy src/artifacts/$folder — vẫn đánh dấu ghost được, nhưng hãy kiểm tra lại tên." >&2

    ensure_cookie_secret
    ensure_master_password "${2:-}"

    add_list "$folder"
    echo "✅ Đã đánh dấu '$folder' là ghost project (master password + COOKIE_SECRET xác nhận tồn tại)."
    echo "   → Chạy ./deploy.sh để cập nhật ghost-folders.js và đẩy middleware."
    echo "   → Sau deploy, kiểm chứng: mở https://artifacts.hoangtrung.dev/ghost hoặc https://artifacts.hoangtrung.dev/?ghost=true"
    ;;
esac
