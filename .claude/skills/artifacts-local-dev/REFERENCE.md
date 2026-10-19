# artifacts-local-dev — reference

## Ready-made local stack

```bash
pnpm run build
# seed local R2 (example single artifact, no revision manifest)
mkdir -p /tmp/artifacts-seed
printf '<!doctype html><h1>Hello</h1>' > /tmp/artifacts-seed/a.html
npx wrangler r2 object put artifacts-content/content/demo/a.html \
  --file=/tmp/artifacts-seed/a.html --local --persist-to /tmp/demo-state
# start Functions shell
npx wrangler pages dev dist --port 8788 --persist-to /tmp/demo-state \
  --d1=FEEDBACK_DB --binding FEEDBACK_ADMIN_TOKEN=demo-admin-token
```

- Local R2 persists under `<persist-to>/v3/r2/`; local D1 under `<persist-to>/v3/d1/`.
- Apply the feedback schema to the local D1 SQLite before using feedback routes:
  find the non-`metadata.sqlite` file in `v3/d1/miniflare-D1DatabaseObject/` and run
  `sqlite3 <file> < migrations/0001_feedback.sql`.
- Viewer pages are at `/demo/a`; raw at `/demo/a.html`; APIs at `/api/*`.
- To test the review UI: create a revision manifest + catalog/catalog probe works without catalog
  (`[[path]].js` probes R2), then `POST /api/feedback/grants` with the admin header and `Origin`
  matching `http://127.0.0.1:8788`, redeem `/r/<token>` in a browser context.

## What runs where

| Command | Serves | Notes |
|---|---|---|
| `pnpm dev` | Astro shell only | Functions/R2 absent; content routes 404 |
| `pnpm dev:edge` | build + `wrangler pages dev dist` | real Functions + local R2 (`.wrangler/state`) |
| `pnpm preview` | Astro preview | static shell only |

## Testing

- `pnpm typecheck` — checkJs over `functions/**`.
- `pnpm test` — `node --test test/*.test.mjs tests/*.test.mjs`; uses `MemoryBucket` and a
  `node:sqlite` D1 shim; commit the migration-driven tests rather than ad-hoc scripts.
- Browser: Playwright with installed Chrome (`channel:'chrome'`) against `pages dev`. Prefer
  `127.0.0.1`; review cookies are `Secure` but Chrome accepts them on localhost/127.0.0.1.
- Auth in tests: mint cookies with `functions/_auth.js` helpers (see `test/helpers/fakes.mjs`) or
  redeem share/review links; don't disable gates in product code for tests.
- Shell asset changes: edit `shell-assets/*`, run `pnpm build` (prepare-static mirrors to
  `public/assets`), and `pnpm test` enforces `ASSET_V == hash(css+js)`. Update `ASSET_V` in
  `functions/_render.js` + `src/layouts/Base.astro` when the hash changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `wrangler` prompts for login | `npx wrangler login`; local dev still works offline |
| `--d1` flag ignored | ensure `wrangler pages dev` (not `pnpm dev`) and migration applied locally |
| iframe content 401 | project gate — mint/provide the project cookie or use a public fixture |
| `asset is stale` test failure | run `pnpm build`; public/assets must byte-match shell-assets |
| port busy | pass another `--port` and a separate `--persist-to` dir |
| state corrupted | use a fresh `--persist-to` directory (don't delete production state) |
