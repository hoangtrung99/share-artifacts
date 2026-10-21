# artifacts-deploy — reference

## Pre-deploy checklist

```bash
git status --porcelain        # must be clean for tracked files
pnpm install
pnpm typecheck
pnpm test
pnpm build
npx wrangler whoami           # account with Pages + D1 write
```

`deploy.sh` runs test + build itself and refuses a dirty tracked tree. Untracked files under
`functions/`, `src/`, `public/`, `shell-assets/` or `scripts/` also block; `--force` marks the deploy
dirty (avoid unless deliberate).

## What gets deployed

- `dist/` — Astro shell (`/`, `/login`, `/ghost`, 404) + generated `public/` assets (`/assets/*`,
  `_headers`, `_redirects`, robots/sitemap).
- `functions/` — Pages Functions bundle (auth, catalog API, content catch-all, feedback API,
  revisions API, share/review routes).
- NOT content: artifacts live on R2 and are served by the Functions. Deploying the shell never
  changes uploaded files/versions.
- Bindings/secrets are project-level configuration kept by Cloudflare, not files in `dist`.

## Production environment facts

| Item | Value |
|---|---|
| Pages project | `artifacts` |
| Domain | `artifacts.hoangtrung.dev` |
| R2 bucket / binding | `artifacts-content` / `ARTIFACTS` |
| D1 database / binding | `artifacts-feedback` / `FEEDBACK_DB` (id in `wrangler.jsonc`) |
| Health | `/api/health` |
| Secrets | `COOKIE_SECRET`, `GHOST_MASTER_PW`, `PW_<PROJECT>`, `FEEDBACK_ADMIN_TOKEN` |
| Vars | `FEEDBACK_REQUIRE_GRANT` (optional; `1`/`true` = legacy grant-required feedback, unset = open) |

## D1 / feedback setup

```bash
npx wrangler d1 create artifacts-feedback                     # prints database_id
npx wrangler d1 migrations apply artifacts-feedback --remote  # applies migrations/0*.sql
npx wrangler d1 migrations list artifacts-feedback --remote   # status
```
Set the binding block in `wrangler.jsonc` (binding `FEEDBACK_DB`), set secrets with
`npx wrangler pages secret put <NAME> --project-name artifacts` (value on stdin), then deploy.
With no binding the feedback API returns `503 feedback_not_configured` and the viewer hides the
actions; the rest of the site keeps working.

**Feedback policy flag (temporary):** feedback is OPEN by default (anonymous public artifacts can
read/write; authors are `guest`). To restore the old grant-required policy, set the Pages env var
`FEEDBACK_REQUIRE_GRANT=1` (or `true`) for the `artifacts` project and redeploy so Functions pick it
up; remove it (or set `0`) and redeploy to return to open mode. Its value is not secret, but treat it
as deployment configuration (dashboard or `wrangler`), never artifact content.

## Verification after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://artifacts.hoangtrung.dev/api/health
curl -s https://artifacts.hoangtrung.dev/<project>/<file> | grep -o 'viewer.js?v=[0-9a-f]*'
curl -s -o /dev/null -w '%{http_code}\n' 'https://artifacts.hoangtrung.dev/api/revisions?project=<p>&file=<f>'
curl -s -o /dev/null -w '%{http_code}\n' 'https://artifacts.hoangtrung.dev/api/feedback?project=<p>&file=<f>'
```
Expected: health 200; asset version matches `ASSET_V` in `functions/_render.js`; public revision
metadata 200; feedback anonymous **200 in open mode** (403 only when `FEEDBACK_REQUIRE_GRANT=1`);
protected content 401 without cookie. Open-mode feedback is capacity-capped (100 messages/thread,
500/artifact → `429 feedback_capacity`) and write-limited per client IP, so a load/smoke test that
posts many comments can legitimately hit 429 — treat that as expected, not a deploy failure.

## CI

`.github/workflows/ci.yml`: pushes/PRs to `main` → pnpm install (frozen lockfile) → typecheck →
test → build, Node 24, pnpm 10.8.0. `gh run list --limit 3` / `gh run view <id>` to inspect.
Do not push a commit you have not typechecked/tested locally; commits also carry deploys.

## Rollback / recovery

- Revert the bad commit (`git revert <sha>`) and `./deploy.sh` again; Pages keeps old deployment
  URLs in the dashboard.
- Secrets/bindings are independent of deploy; fix them and retry the request (no redeploy needed
  for Pages secrets, but a binding change in `wrangler.jsonc` needs a deploy).
- Never `git push --force` on `main` to “fix” CI; use revert/merge.
- Rotating `COOKIE_SECRET` logs everyone out; rotate project passwords via `protect.sh`.
