#!/usr/bin/env bash
# Manage per-project passwords on Cloudflare Pages + R2 registry.
#
# Password lives ONLY as a Pages secret (PW_<FOLDER>) — never in git.
# Project name is added to protected.list (local cache) and meta/protected.json on R2.
#
#   ./protect.sh <folder> [password]
#   ./protect.sh --list
#   ./protect.sh --unprotect <folder>
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PROJECT="artifacts"
LIST="$ROOT/protected.list"
touch "$LIST"

key_for() { printf 'PW_%s' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"; }
add_list() { grep -qxF "$1" "$LIST" || printf '%s\n' "$1" >> "$LIST"; }
del_list() { grep -vxF "$1" "$LIST" > "$LIST.tmp" 2>/dev/null || true; mv "$LIST.tmp" "$LIST"; }

secret_exists() { npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -qw "$1"; }

ensure_cookie_secret() {
  if secret_exists "COOKIE_SECRET"; then
    return 0
  fi
  echo "🔑 No COOKIE_SECRET yet — generating…"
  if ! command -v openssl >/dev/null 2>&1; then
    echo "❌ Need openssl, or set manually:" >&2
    echo "   openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name=$PROJECT" >&2
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

sync_registry() {
  node scripts/registry-write.mjs --protected || {
    echo "⚠️  Failed to write meta/protected.json to R2 — local protected.list updated; retry:" >&2
    echo "   node scripts/registry-write.mjs --protected" >&2
  }
}

case "${1:-}" in
  --list)
    echo "Protected projects (protected.list):"
    if [ -s "$LIST" ]; then sort -u "$LIST" | sed 's/^/  🔒 /'; else echo "  (none)"; fi
    ;;
  --unprotect)
    folder="${2:?Missing folder name}"
    k="$(key_for "$folder")"
    echo "Deleting secret $k from project $PROJECT…"
    npx wrangler pages secret delete "$k" --project-name="$PROJECT" || true
    del_list "$folder"
    sync_registry
    echo "✅ Unprotected '$folder' (secret removed + R2 registry updated). No shell redeploy needed."
    ;;
  ""|-h|--help)
    sed -n '2,12p' "$0"
    ;;
  *)
    folder="$1"
    k="$(key_for "$folder")"
    pw="${2:-}"

    ensure_cookie_secret

    echo "Setting password for '$folder'  ->  secret $k  (project $PROJECT)…"
    if [ -n "$pw" ]; then
      printf '%s' "$pw" | npx wrangler pages secret put "$k" --project-name="$PROJECT"
    else
      npx wrangler pages secret put "$k" --project-name="$PROJECT"
    fi
    echo "🔎 Verifying secret…"
    if secret_exists "$k"; then
      add_list "$folder"
      sync_registry
      echo "✅ Protected '$folder' (secret $k + COOKIE_SECRET + R2 registry)."
      echo "   → https://artifacts.hoangtrung.dev/$folder/ should redirect to /login"
    else
      echo "❌ Secret $k not found after put — project NOT marked protected." >&2
      exit 1
    fi
    ;;
esac
