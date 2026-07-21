#!/usr/bin/env bash
# Build the thin Astro shell + deploy Pages (functions + dist).
# Content lives on R2 — this does NOT upload artifacts and does NOT git-commit them.
#
#   ./deploy.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
BRANCH="main"

echo "🏗  Build thin shell (prepare-static + astro build)…"
pnpm run build

[ -d "$ROOT/dist" ] || { echo "❌ Build finished but ./dist is missing." >&2; exit 1; }

echo "🚀 Deploy to Cloudflare Pages (project=artifacts, branch=$BRANCH)…"
npx wrangler pages deploy --branch="$BRANCH" --commit-dirty=true

echo "✅ Shell deployed. Content is served from R2 (bucket artifacts-content)."
echo "   https://artifacts.hoangtrung.dev/"
