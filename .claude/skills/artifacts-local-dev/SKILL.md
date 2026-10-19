---
name: artifacts-local-dev
description: Run and test the artifacts.hoangtrung.dev shell, Pages Functions, R2 content and D1 feedback stack locally. Use when starting the dev environment, reproducing a viewer/API/auth bug locally, seeding R2 fixtures, running the test suites, or doing browser/Playwright verification.
---

# Artifacts local dev

Two runtimes: Astro dev serves only the shell, `wrangler pages dev` serves shell **and** Functions
with local R2 + D1. [REFERENCE.md](REFERENCE.md) has ready-made seed/run/verify snippets and
troubleshooting.

## Quick start

```bash
pnpm install
pnpm dev        # Astro shell only — content routes 404 (Functions don't run)
pnpm dev:edge   # build + wrangler pages dev dist — Functions + local R2/D1
```

For deterministic work prefer an isolated persisted state:

```bash
pnpm run build
npx wrangler pages dev dist --port 8788 --persist-to /tmp/demo-state \
  --d1=FEEDBACK_DB --binding FEEDBACK_ADMIN_TOKEN=demo-admin-token
```

`--d1=FEEDBACK_DB` creates a local D1; apply `migrations/0001_feedback.sql` to the local SQLite
before calling feedback routes (otherwise 503/500). Seed R2 objects with
`npx wrangler r2 object put artifacts-content/content/<project>/<file> --file=… --local --persist-to …`;
revision fixtures are `revisions/<artifactId>/<revisionId>/source.<ext>` plus
`meta/revisions/<artifactId>.json` and `meta/catalog.json`.

## Test ladder

```bash
pnpm typecheck                     # tsc --checkJs over functions
pnpm test                          # node:test suites in test/ and tests/
pnpm build                         # prepare-static + astro build
```

- Unit/route tests use `MemoryBucket` and a `node:sqlite` D1 shim — fast and CI-identical.
- For UI/behaviour use Playwright + installed Chrome (`channel:'chrome'`) against
  `wrangler pages dev`, not `file://`; the viewer needs same-origin iframes/API.
- Auth flows need real signed cookies: either redeem a share/review link through a browser context,
  or mint cookies with `functions/_auth.js` helpers in a Node script for tests.
- Use a separate `--persist-to` directory per scenario; copy state for throwaway experiments.

## Common pitfalls

| Symptom | Cause |
|---|---|
| content routes 404 under `pnpm dev` | Functions not running; use `pages dev` |
| `503 feedback_not_configured` | `--d1=FEEDBACK_DB` missing, or migration not applied locally |
| `/api/feedback` 403 | no review grant/admin token (public artifacts gate discussion) |
| writes rejected 400 `invalid_revision` | artifact has no revision manifest (bootstrap or deliver first) |
| iframe API calls 401 | review cookie lost (artifact-scoped) or wrong artifact id |
| CSS/JS stale after edit | rerun `pnpm build` so prepare-static mirrors `shell-assets/`; bump `ASSET_V` is checked by tests |
| deploy refused | dirty tree — that's intentional |

Do not run the production `wrangler` commands against local state, and never put real secrets in
committed fixtures.
