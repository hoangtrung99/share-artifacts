# artifacts.hoangtrung.dev

**Tool-only** artifact host. Content (HTML/MD) is **not** in git — it lives on a private Cloudflare R2 bucket. This repo holds the thin Astro shell, Pages Functions, CI, and CLI scripts (`deliver`, `unpublish`, `protect`, `ghost`, `deploy`, `r2:backfill`).

- Viewer: `https://artifacts.hoangtrung.dev/<project>/<file>`
- Raw: `https://artifacts.hoangtrung.dev/<project>/<file>.(html|md)`
- Gallery: `https://artifacts.hoangtrung.dev/` (client fetches `/api/catalog`)
- Project listing: `https://artifacts.hoangtrung.dev/<project>/` (folder tree + filters)
- Health: `https://artifacts.hoangtrung.dev/api/health`

## Architecture

```
R2 bucket: artifacts-content  (private)
  content/<project>/<path>.html|md   — artifact bytes
  meta/catalog.json                  — project/file index + time metadata
  meta/protected.json                — protected project names
  meta/ghost.json                    — ghost project names
  meta/redirect-map.json             — 301 map for moved artifacts
  meta/backups/                      — dated catalog/registry snapshots
  reviews/…                          — append-only review feedback (one-off feature)

Cloudflare Pages (project: artifacts)
  dist/              thin Astro shell: /, /login, /ghost, /404
  functions/         auth, catalog API, content catch-all, admin-less health
  Binding ARTIFACTS → artifacts-content  (wrangler.jsonc)
```

```
.
├── src/pages/                 # Thin shell only: index, login, ghost, 404
├── shell-assets/              # site.css + viewer.js — ONE stylesheet for shell + Functions
├── public/                    # generated at build (assets, _headers, _redirects, robots.txt)
├── functions/
│   ├── _middleware.js         # ghost + per-project auth (R2 registries, fail-closed)
│   ├── _store.js              # R2 helpers + catalog/registry/upload-time caches
│   ├── _auth.js               # HMAC cookies, password versions, share tokens
│   ├── _http.js               # shared security/cache/response helpers
│   ├── _markdown.js           # MD → HTML (TOC, task lists, …)
│   ├── _render.js             # listing / HTML iframe viewer / MD shell
│   ├── api/catalog.js         # GET /api/catalog
│   ├── api/reviews.js         # POST/GET /api/reviews (append-only feedback)
│   ├── api/health.js          # GET /api/health
│   ├── api/[[path]].js        # JSON 404 for unknown /api/*
│   ├── [[path]].js            # content catch-all from R2
│   ├── login.js / logout.js / ghost.js / share.js / s/[token].js
├── scripts/
│   ├── prepare-static.mjs     # thin shell prep (fail-closed public/, headers/robots)
│   ├── catalog-upsert.mjs     # catalog mutation (+ dated backup, time metadata)
│   ├── registry-write.mjs     # protected/ghost registries (+ dated backup)
│   ├── backfill-r2-times.mjs  # R2 inventory report / time-metadata backfill
│   ├── lib/{meta,r2-cli,r2-api,names}.mjs
│   ├── migrate-to-r2.mjs      # one-shot historical migration (already run)
├── deliver.sh                 # R2 put + catalog upsert (--remote)
├── deploy.sh                  # test + prepare-static + astro build + pages deploy
├── protect.sh / ghost.sh      # CF secrets + R2 registry (no shell redeploy)
├── unpublish.sh               # R2 delete (parallel) + catalog remove
├── test/ + tests/             # node:test suites
└── .github/workflows/ci.yml   # install → typecheck → test → build
```

There is **no** `src/artifacts/` — content is not checked into git.

## Timestamps and the "Recent" sort

Every file has two independent time notions, both stored in `meta/catalog.json`:

| Field | Meaning |
|-------|---------|
| `uploadedAt` | Upload timestamp recorded by `deliver` (client clock) and refreshed from R2 object metadata; compared by instant, not by string format |
| `uploadedAtReliable` | `false` for bulk imports/moves where the upload time is an artifact of the operation, not of publishing |
| `uploadSource` | `deliver`, `r2`, `bulk-migration`, or `reorg-move` |
| `artifactDate` | Best-effort creation date: explicit frontmatter/`<meta name="date">`, else a date in the path/content |
| `createdAt` | First known upload time |

Sorting rules (`_store.js#resolveArtifactTime`):

1. **Reliable upload** → sort and display the upload time. New deliveries are always reliable.
2. **Bulk/legacy upload** (initial migration 2026-07-21, reorg 2026-08-27) → sort and display the
   artifact date when one is known, so a folder move never makes an old report look new.
3. Neither known → show the raw upload time, labelled as a legacy bulk upload in the tooltip.

The listing displays `↑` for upload time and `◆` for an artifact date; hover a date to see both
values. "Recent" means newest effective time first; artifacts sharing a bulk timestamp are
tie-broken by their artifact date.

If a date is wrong or missing, re-deliver with an explicit date:

```bash
./deliver.sh ./report.html verups --date 2026-10-19
```

Inspect R2 and repair the catalog metadata (scan-only by default):

```bash
pnpm r2:inventory   # prints per-project counts, drift, newest artifacts; writes meta/r2-inventory-*.json
pnpm r2:backfill    # same, then writes the catalog (dated backup under meta/backups/)
```

The inventory uses the Cloudflare REST API with the wrangler login token (or
`CLOUDFLARE_API_TOKEN`); `wrangler r2 object` has no `list` command.

## One-time setup

### 1. Enable R2 + create bucket

```bash
npx wrangler r2 bucket create artifacts-content
```

### 2. Install + auth

```bash
pnpm install
npx wrangler login
# COOKIE_SECRET (idempotent — protect.sh also creates it if missing)
openssl rand -base64 32 | npx wrangler pages secret put COOKIE_SECRET --project-name=artifacts
```

### 3. Deploy the shell

```bash
./deploy.sh
```

Custom domain (once): Workers & Pages → `artifacts` → Custom domains → `artifacts.hoangtrung.dev`.

> Migration from a local `src/artifacts/` tree was a one-shot (`scripts/migrate-to-r2.mjs`).

## Daily workflow

```bash
# Publish one file → R2 + catalog (no rebuild, no pages deploy, no git commit of content)
./deliver.sh ./report.html cost-review
# → viewer: https://artifacts.hoangtrung.dev/cost-review/report
# → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html

# Nested path under the project
./deliver.sh ./report.html cost-review --name folder/report.html

# Explicit artifact date (when the content has no usable date)
./deliver.sh ./report.html cost-review --date 2026-10-19

./deliver.sh ./secret.md ops --protect --ghost
./unpublish.sh cost-review/report   # one file
./unpublish.sh cost-review          # whole project (parallel deletes)
```

**Wrangler R2 CLI must use `--remote`** (wrangler 4 defaults to local otherwise). All scripts already pass `--remote`. `wrangler` is pinned in `package.json`; use `npx wrangler` (resolves the pinned local binary).

Every catalog/registry mutation writes a dated snapshot under `meta/backups/` first. The backup
is mandatory: if it cannot be written, the mutation aborts instead of overwriting context.`--seed`
only treats a *confirmed missing* catalog as absent (auth/network errors abort).

### When to run `deploy.sh`

Only when the **shell** changes: Functions, Astro pages (`/`, `/login`, `/ghost`, `/404`), or
`shell-assets/*`. **Not** for new or updated content.

```bash
./deploy.sh          # refuses uncommitted deploy changes; test + build + deploy
./deploy.sh --force  # explicit escape hatch
```

CI also runs typecheck/test/build on push and PR.

### Metadata

- **Markdown:** frontmatter `title`, `description`, `tags`, `date`.
- **HTML:** `<title>`, `<meta name="description">`, optional `<meta name="date" content="YYYY-MM-DD">`.
- Listing dates come from the time model above, not from these tags.

## Password protection

Auth: styled `/login` + signed cookie `cf_auth_<project>` (HMAC-SHA256 on `COOKIE_SECRET`).
Tokens embed a fingerprint of the current password, so **changing `PW_<PROJECT>` revokes every
existing session/share link** for that project.

| | Project cookie | Ghost cookie |
|--|----------------|--------------|
| TTL | **180 days** | **7 days** |

Password is a Pages secret `PW_<PROJECT>` — **never in git**. Runtime registry: `meta/protected.json` on R2. Local `protected.list` is an **untracked** optional cache.

**Fail-closed:** project listed as protected but missing `PW_*` or `COOKIE_SECRET` → 403.

```bash
./protect.sh my-project
./protect.sh my-project 's3cret'
./protect.sh --list
./protect.sh --unprotect my-project
```

**No shell redeploy** after protect/unprotect — secrets + R2 registry only. Home 🔒 badges come from `/api/catalog` (edge cache ~45s).

## Ghost projects

Hidden from `/`. Visible at `/ghost` after master password (`GHOST_MASTER_PW`). Registry: `meta/ghost.json` on R2. Local `ghost.list` is an **untracked** optional cache — ghost names must never be committed to this public repo.

```bash
./ghost.sh my-project
./ghost.sh --list
./ghost.sh --unghost my-project
./ghost.sh --set-master
```

Ghost projects cannot be share-linked (a share link would either bypass the master password or
dead-end at `/ghost`); `POST /share` rejects them explicitly.

## Share links

`POST /share` → `GET /s/<token>`. Caller must already be authenticated for the project and the
request must be same-origin. TTL options: **24h / 7d / 30d / 180d**. Stateless HMAC — rotating
`COOKIE_SECRET` or changing the project password revokes outstanding links; individual revocation
is not supported.

## Content routes, caching and headers

Served by `functions/[[path]].js` from R2:

| Path | Behavior |
|------|----------|
| `/<project>/` | Project listing with folder tree + client filters (simple text filter, not Pagefind) |
| `/<project>/<file>` | HTML: iframe viewer · MD: edge-rendered (TOC, highlight.js CDN, GFM task lists) |
| `/<project>/<file>.html\|md` | Raw object |
| `/api/*` | JSON APIs; unknown paths return JSON 404 |
| `/<unknown-project>/…` | plain-text 404 from the content catch-all |
| anything else | `dist/404.html` (static shell fall-through) |

- Cache-Control: public content `public, max-age=60`; protected/ghost content **`private, no-store`**
  (raw bytes: 300s public / no-store private).
- Listings/viewers send ETag and answer `If-None-Match` with 304; raw artifacts reuse R2's ETag.
- Security headers are set in Functions (`public/_headers` only applies to static assets):
  `nosniff`, referrer policy, and `frame-ancestors 'self'` so artifacts cannot be framed elsewhere.
- `_astro/*` hashed assets are immutable for a year; `/assets/*` use short revalidating caches.
- Catalog, registry, redirect map and per-project upload times are cached in-isolate for 30–60s
  (new deliveries can take up to ~30s to appear in listings).
- Protection takes effect on the next uncached request. Content a client already cached while a
  project was public can remain readable from that client's cache for the advertised max-age;
  rotate the artifact or bump its URL if that matters.

## Local development

```bash
pnpm dev        # Astro shell only — Functions/R2 do not run, content routes 404
pnpm dev:edge   # build + wrangler pages dev dist — Functions run against local R2 state
```

`wrangler pages dev` uses local R2 persistence (`.wrangler/state`), which starts empty. Use
`pnpm dev` for shell/page work and the node tests for route/auth logic; to exercise real content
locally, put objects under the `ARTIFACTS` binding with `npx wrangler r2 object put … --local`.

## Testing and CI

```bash
pnpm typecheck   # tsc --checkJs over functions/**
pnpm test        # node:test suites in test/ and tests/
pnpm build       # prepare-static + astro build
```

`test/` covers the CLI/catalog safety, auth token versions, middleware gates, content routes,
time resolution and shell-asset consistency; `tests/reviews.test.mjs` covers the review API.
CI (`.github/workflows/ci.yml`) runs install → typecheck → test → build on pushes and PRs.

## Build (shell only)

```bash
pnpm run build   # prepare-static + astro build (no artifact enumeration)
```

## Constants

| Name | Value |
|------|-------|
| Site | `https://artifacts.hoangtrung.dev` |
| Pages project | `artifacts` |
| R2 bucket | `artifacts-content` |
| Binding | `ARTIFACTS` |
| Content keys | `content/<project>/<path>.html\|md` |
| Catalog / registries | `meta/catalog.json`, `meta/protected.json`, `meta/ghost.json` |
| Catalog backups | `meta/backups/` |
| Project cookie TTL | 180 days |
| Ghost cookie TTL | 7 days |
| Share TTLs | 24h / 7d / 30d / 180d |
| Registry edge cache | ~45s |
| Catalog / upload-time cache | ~30s |
