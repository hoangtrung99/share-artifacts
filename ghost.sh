#!/usr/bin/env bash
# Manage ghost (hidden) projects — master password + R2 registry.
#
#   ./ghost.sh <folder>                      # mark as ghost
#   ./ghost.sh --list
#   ./ghost.sh --unghost <folder>
#   ./ghost.sh --set-master [password]
#   ./ghost.sh --ensure-master               # used by deliver.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PROJECT="artifacts"
LIST="$ROOT/ghost.list"
touch "$LIST"

add_list() { grep -qxF "$1" "$LIST" || printf '%s\n' "$1" >> "$LIST"; }
del_list() { grep -vxF "$1" "$LIST" > "$LIST.tmp" 2>/dev/null || true; mv "$LIST.tmp" "$LIST"; }

secret_exists() { npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -qw "$1"; }

ensure_cookie_secret() {
  if secret_exists "COOKIE_SECRET"; then return 0; fi
  echo "🔑 No COOKIE_SECRET yet — generating…"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "❌ Need openssl to generate COOKIE_SECRET." >&2
    exit 1
  fi
  openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name="$PROJECT"
  if secret_exists "COOKIE_SECRET"; then
    echo "✅ COOKIE_SECRET created."
  else
    echo "❌ Could not confirm COOKIE_SECRET." >&2
    exit 1
  fi
}

ensure_master_password() {
  local pw="${1:-}"
  if secret_exists "GHOST_MASTER_PW"; then
    echo "✅ GHOST_MASTER_PW already set."
    return 0
  fi
  echo "👻 No GHOST_MASTER_PW yet — set master password for /ghost…"
  if [ -n "$pw" ]; then
    printf '%s' "$pw" | npx wrangler pages secret put GHOST_MASTER_PW --project-name="$PROJECT"
  else
    npx wrangler pages secret put GHOST_MASTER_PW --project-name="$PROJECT"
  fi
  if secret_exists "GHOST_MASTER_PW"; then
    echo "✅ GHOST_MASTER_PW created."
  else
    echo "❌ Could not confirm GHOST_MASTER_PW." >&2
    exit 1
  fi
}

sync_registry() {
  node scripts/registry-write.mjs --ghost || {
    echo "⚠️  Failed to write meta/ghost.json to R2 — retry: node scripts/registry-write.mjs --ghost" >&2
  }
}

case "${1:-}" in
  --list)
    echo "Ghost projects (ghost.list):"
    if [ -s "$LIST" ]; then sort -u "$LIST" | sed 's/^/  👻 /'; else echo "  (none)"; fi
    ;;
  --unghost)
    folder="${2:?Missing folder name}"
    del_list "$folder"
    sync_registry
    echo "✅ Unghosted '$folder' (R2 registry updated). No shell redeploy needed."
    ;;
  --set-master)
    ensure_cookie_secret
    shift
    if [ "${1:-}" ] && [ "${1#--}" = "${1:-}" ]; then
      ensure_master_password "$1"
    else
      ensure_master_password
    fi
    ;;
  --ensure-master)
    ensure_cookie_secret
    ensure_master_password "${2:-}"
    # When called as: ghost.sh <folder> --ensure-master from deliver? deliver uses:
    #   ./ghost.sh "$PROJECT" --ensure-master
    # which falls into default branch. Keep this for explicit use.
    ;;
  ""|-h|--help)
    sed -n '2,12p' "$0"
    ;;
  *)
    folder="$1"
    # Support: ghost.sh <folder> --ensure-master [pw]
    extra="${2:-}"
    ensure_cookie_secret
    if [ "$extra" = "--ensure-master" ]; then
      ensure_master_password "${3:-}"
    else
      ensure_master_password "${2:-}"
    fi

    add_list "$folder"
    sync_registry
    echo "✅ Marked '$folder' as ghost (GHOST_MASTER_PW + COOKIE_SECRET + R2 registry)."
    echo "   → https://artifacts.hoangtrung.dev/ghost"
    ;;
esac
