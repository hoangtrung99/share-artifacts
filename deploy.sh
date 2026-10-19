#!/usr/bin/env bash
# Build the thin Astro shell + deploy Pages (functions + dist).
# Content lives on R2 — this does NOT upload artifacts and does NOT git-commit them.
#
#   ./deploy.sh          # refuses to deploy from a dirty git tree
#   ./deploy.sh --force  # deploy anyway (wrangler marks the deploy as dirty)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BRANCH="main"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h|--help)
      echo "usage: $0 [--force]"
      echo "  --force  deploy even when the git working tree is dirty"
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $arg" >&2
      echo "usage: $0 [--force]" >&2
      exit 2
      ;;
  esac
done

# Deploys must be reproducible from a commit: uncommitted shell changes would go live without
# review. Only deployment-relevant paths block: tracked edits plus untracked files under
# functions/, src/, public/, shell-assets/ and scripts/. Untracked scratch elsewhere (designs,
# notes) does not deploy anything, so it does not block. --force is the explicit escape hatch.
if [ "$FORCE" != true ]; then
  TRACKED_DIRTY="$(git status --porcelain --untracked-files=no)"
  UNTRACKED_RELEVANT="$(git status --porcelain --untracked-files=all \
    | grep '^?? ' | sed 's/^?? //' \
    | grep -E '^(functions|src|public|shell-assets|scripts)/|^(astro\.config\.mjs|jsconfig\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|wrangler\.jsonc)$' || true)"
  if [ -n "$TRACKED_DIRTY$UNTRACKED_RELEVANT" ]; then
    echo "❌ Working tree has uncommitted deploy changes — commit or stash first (or pass --force)." >&2
    [ -n "$TRACKED_DIRTY" ] && printf '%s\n' "$TRACKED_DIRTY" >&2
    [ -n "$UNTRACKED_RELEVANT" ] && printf '?? %s\n' "$UNTRACKED_RELEVANT" >&2
    exit 1
  fi
fi

echo "🧪 Run tests…"
pnpm test

echo "🏗  Build thin shell (prepare-static + astro build)…"
pnpm run build

[ -d "$ROOT/dist" ] || { echo "❌ Build finished but ./dist is missing." >&2; exit 1; }

echo "🚀 Deploy to Cloudflare Pages (project=artifacts, branch=$BRANCH)…"
DEPLOY_ARGS=(--branch="$BRANCH")
if [ "$FORCE" = true ]; then
  DEPLOY_ARGS+=(--commit-dirty=true)
fi
npx wrangler pages deploy "${DEPLOY_ARGS[@]}"

echo "✅ Shell deployed. Content is served from R2 (bucket artifacts-content)."
echo "   https://artifacts.hoangtrung.dev/"
