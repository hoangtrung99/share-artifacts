---
name: artifacts-deploy
description: Deploy the artifacts.hoangtrung.dev Cloudflare Pages shell/functions and its D1 setup. Use when asked to ship a shell/code change to production, set Pages secrets, create or migrate the feedback D1 database, investigate a failed CI/deploy, or roll back a deployment.
---

# Artifacts deploy

Production = Cloudflare Pages project **artifacts** (domain `artifacts.hoangtrung.dev`), R2 bucket
`artifacts-content`, D1 database `artifacts-feedback`. Content/artifacts never deploy through git.
[REFERENCE.md](REFERENCE.md) has exact commands, config and troubleshooting.

## Preconditions

- `git status` clean (tracked changes; `deploy.sh` refuses a dirty tree unless `--force`).
- `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` green.
- Authenticated `wrangler` account with Pages + D1 access (`npx wrangler whoami`).
- No secrets in git. `wrangler.jsonc` holds bindings; secrets are Pages secrets.

## Deploy the shell

```bash
./deploy.sh            # pnpm test → prepare-static + astro build → wrangler pages deploy
./deploy.sh --force    # only when an uncommitted deploy is intentional
```

Deployment uploads `dist/` and the `functions/` bundle; it does **not** upload artifacts. R2 content
and the catalog are live already. After deploy: check `/api/health`, a viewer page asset version,
and any API you touched.

## First-time / new-environment setup

```bash
npx wrangler d1 create artifacts-feedback
npx wrangler d1 migrations apply artifacts-feedback --remote
# add the d1_databases block to wrangler.jsonc (binding FEEDBACK_DB)
npx wrangler pages secret put FEEDBACK_ADMIN_TOKEN --project-name artifacts
# also: COOKIE_SECRET, PW_<PROJECT>*, GHOST_MASTER_PW as needed
pnpm run revisions:bootstrap            # dry-run, then -- --apply once
```

Secrets are written from stdin; never commit or echo them into logs. `wrangler.jsonc` contains the
database id (not a secret).

## CI

`.github/workflows/ci.yml` runs install → typecheck → test → build on pushes/PRs to `main`. A red CI
blocks nothing technically in Pages (deploys are manual) but must be fixed before/with any push.
The local equivalent: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`.

## Rollback / failure modes

- **Bad deploy:** revert the offending commit, run `./deploy.sh` again. Pages keeps deployment
  history; the previous deployment URL is visible in the dashboard.
- **Dirty-tree refusal:** commit/stash, or `--force` deliberately.
- **Missing secret / binding:** the feature route should fail safe (e.g. feedback 503); fix the
  secret/binding and redeploy is not required for Pages secrets.
- **R2/version issues:** see `artifact-versions`; the shell deploy never rewrites content.

## Do not

- Deploy from a worktree/branch other than the verified commit.
- Put content in git or deploy artifacts via Pages.
- Rotate `COOKIE_SECRET` casually: it revokes every session/share link.
