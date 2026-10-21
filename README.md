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
  content/<project>/<path>.html|md   — artifact bytes (mutable current)
  revisions/<artifactId>/<revisionId>/source.html|md — immutable publish snapshots
  meta/revisions/<artifactId>.json   — revision manifest + latest pointer + tombstone
  meta/catalog.json                  — project/file index + time + revision metadata
  meta/protected.json                — protected project names
  meta/ghost.json                    — ghost project names
  meta/redirect-map.json             — 301 map for moved artifacts
  meta/backups/                      — dated catalog/registry snapshots
  reviews/…                          — append-only review feedback (one-off feature)

Cloudflare Pages (project: artifacts)
  dist/              thin Astro shell: /, /login, /ghost, /404
  functions/         auth, catalog API, content catch-all, feedback API, admin-less health
  Binding ARTIFACTS → artifacts-content  (wrangler.jsonc)
  Binding FEEDBACK_DB → D1 (optional; feedback API returns 503 when unbound)
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
│   ├── api/reviews.js         # POST/GET /api/reviews (one-off dashboard feedback)
│   ├── api/revisions.js       # GET /api/revisions (version history)
│   ├── api/feedback/[[path]].js # feedback threads / replies / export / grants
│   ├── _feedback*.js          # D1 store, revision manifest, access gate, anchoring
│   ├── r/[token].js           # review-grant redemption → HttpOnly cookie
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
│   ├── revisions.mjs          # revision register/status CLI (manifest CAS)
│   ├── bootstrap-revisions.mjs# backfill revisions for existing artifacts
│   ├── feedback.mjs           # read-only agent feedback CLI
│   ├── review-grant.mjs       # owner CLI: create/list/revoke review grants
│   ├── migrate-to-r2.mjs      # one-shot historical migration (already run)
├── deliver.sh                 # R2 put + catalog upsert (--remote)
├── deploy.sh                  # test + prepare-static + astro build + pages deploy
├── protect.sh / ghost.sh      # CF secrets + R2 registry (no shell redeploy)
├── unpublish.sh               # R2 delete (parallel) + catalog remove
├── migrations/                # D1 schema (apply when the owner creates the DB)
├── test/ + tests/             # node:test suites (feedback tests use a node:sqlite D1 shim)
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

If a date is wrong or missing, re-deliver with an explicit date (this also counts as a fresh
publish):

```bash
./deliver.sh ./report.html verups --date 2026-10-19
```

To correct a legacy file's artifact date **without** re-uploading or changing its recency:

```bash
node scripts/set-artifact-date.mjs --project verups --file old/report.html --date 2026-05-01
# or: pnpm catalog:date -- --project verups --file old/report.html --date 2026-05-01
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
- **HTML:** `<title>`, `<meta name="description">`, optional `<meta name="date" content="YYYY-MM-DD">`,
  optional `<meta name="tags" content="infra, networking">`.
- Listing dates come from the time model above, not from these tags. Tags also drive the category
  filter. Precedence: explicit tags → top-level folder → curated keyword fallback
  (`networking`, `crypto`, `ai`, `dev-tools`, `infra`, `personal`, `translations`) → `General`.
  Add tags when the automatic bucket is not precise enough.

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

## Review feedback and version history

Every publish is kept as an immutable revision and artifacts can be reviewed in place.
The feature is **opt-in per deployment**: with no D1 binding the feedback routes answer
`503` and the viewer hides the Feedback/Versions actions, so the rest of the site behaves
exactly as before.

- **Publishing revisions.** `./deliver.sh` hashes the bytes, stores an immutable snapshot
  (`revisions/<artifactId>/<revisionId>/source.html|md`), commits the per-artifact manifest
  (`meta/revisions/<artifactId>.json`, conditional R2 write when REST credentials exist) and
  only then updates `content/` + the catalog. Re-publishing identical bytes is a no-op.
  Existing artifacts are bootstrapped with `pnpm run revisions:bootstrap` (dry-run by default,
  `-- --apply` writes), or automatically the next time each file is delivered.
- **Viewing revisions.** `?rev=<revisionId>` serves the snapshot for raw HTML/MD and the
  viewer/MD reader; unknown revisions are a `404` (never a silent fallback). The default URL
  stays canonical but the iframe/download are pinned to the latest revision so feedback and
  content can never disagree. The viewer's More menu → **Versions** lists history, and an
  old-revision banner offers "Back to latest" (read-only review). Version-history metadata
  (`GET /api/revisions`) is anonymous for public artifacts; protected/ghost projects still
  require their project/ghost cookie. History contains revision metadata only — no feedback data.
- **Reviewing (open by default).** Any viewer who can open the artifact can select text and leave
  feedback — no review link required (anonymous authors are shown as `Guest · UNVERIFIED`; a typed
  display name is kept). Protected/ghost projects still require their project/ghost cookie.
  Review grants remain supported but are now optional. A reviewer selects text; the
  Comment/Replace/Remove popover appears immediately and a compact inline composer sends the
  feedback **without opening the side panel** (the panel remains available for threads, replies,
  filters, versions and export). Threads have replies and `open -> addressed -> resolved` status;
  every thread stores the revision it was written against and reports `unanchored` instead of
  attaching to the wrong passage. Comments are plain text; highlights use the CSS Custom Highlight
  API and never mutate artifact DOM.
- **Access.** Feedback is **open by default**: public artifacts = anonymous read + create/reply/
  resolve/reopen; protected/ghost projects = their project/ghost cookie (fail closed) then full
  read + write. `FEEDBACK_ADMIN_TOKEN` remains the site-owner credential (mark `addressed`, manage
  grants, mark/grant-only operations) and `/r/<token>` review grants still work as an optional
  extra credential. Set the env var `FEEDBACK_REQUIRE_GRANT=1` (or `true`) to restore the previous
  grant-required policy exactly: public feedback needs a grant/admin, project/share cookies are
  read-only. Version-history metadata stays public for public artifacts (old snapshots already are);
  protected/ghost projects keep their project/ghost cookie gate.
  Hard accumulation caps keep open-mode responses bounded: **100 messages per thread** and
  **500 messages per artifact** (the 101st message / over-cap create returns `429
  feedback_capacity`). Write/read rate limits are per identity: `admin`, `grant:<id>`,
  `project:<client-IP>` for project/ghost sessions, `guest:<client-IP>` for anonymous — one IP
  exhausting its bucket never throttles another IP. Only Cloudflare's `CF-Connecting-IP` is used
  (a missing header maps to a shared `unknown` bucket; `X-Forwarded-For` is ignored).
- **D1 setup (owner).** `npx wrangler d1 create artifacts-feedback` ->
  `npx wrangler d1 migrations apply artifacts-feedback --remote` -> uncomment the
  `d1_databases` block in `wrangler.jsonc`, set the `FEEDBACK_ADMIN_TOKEN` secret, and optionally
  set `FEEDBACK_REQUIRE_GRANT=1` to re-enable grant-required feedback (default: open). The
  migration lives in `migrations/0001_feedback.sql`.
- **Agent CLI (read-only).** `pnpm run feedback -- list|export|revisions ...` reads the API with
  `ARTIFACTS_COOKIE` or the admin token; `pnpm run feedback:grant -- create|list|revoke ...`
  mints/revokes review links. See `design/feedback-versioning/backend-contract.md` for the
  full API, anchor JSON and permission matrix, and `design/feedback-versioning/PLAN.md`
  for the rollout plan. Agents working in this repo load the committed skill suite —
  see [`.claude/skills/README.md`](.claude/skills/README.md): `artifact-feedback`,
  `artifact-versions`, `deploy-artifacts` (content publishing), `artifacts-access`,
  `artifacts-deploy` (shell deploy), `artifacts-local-dev`.

## Shell UI

The shell is a thin, self-hosted design system shared by the Astro pages and the Function-rendered
content routes (`shell-assets/site.css`, `shell-assets/viewer.js`, `functions/_ui.js`).

- **Themes:** five palettes — Coast (default, dark blue), Forest (dark green), Ink (dark neutral),
  Paper (light warm), Sepia (light parchment). The picker lives in every topbar; the choice is
  persisted in `localStorage['artifacts-theme']` and applied before paint by an inline bootstrap
  (`?theme=` overrides it for review links). Every palette is built from the same token contract and
  clears WCAG AA for text and control boundaries.
- **Fonts:** self-hosted variable Newsreader (display + reading, roman/italic) and IBM Plex Sans
  (UI), latin/latin-ext/vietnamese subsets under `public/assets/fonts/`.
- **Compact viewer/reader bar (48px):** identity cluster (back, breadcrumb, mono artifact meta) and
  action cluster (neutral Download, copy, Share for protected projects, theme picker, More). The
  More menu carries Open raw / Print / Theme / Sign out per context; MD pages get a 2px reading
  progress line. Mobile keeps the artifact title and 44px controls and folds secondary actions into
  More.
- **Artifact-matched viewer bar:** on HTML viewer pages the shell samples the same-origin artifact
  iframe's computed top-strip/background/text colours and repaints the bar to match (contrast-checked muted /
  icon tokens), so the bar reads as part of the artifact. It follows theme switches made inside the
  artifact via attribute observation plus a light sampler; cross-origin iframes keep the shell theme.
- **Category filter:** a compact multi-select dropdown in the project toolbar (one trigger instead of
  a wrapping chip wall). A category is an artifact `tag` when present; otherwise the top-level folder
  (root-level files are the **Root** bucket, pinned directly after All); flat projects fall back to
  curated keywords, then `General`. Counts are rendered server-side, state lives in
  `?cat=slug,slug` (OR semantics) and combines with text/type/sort. The control is hidden when a
  project has fewer than two categories.
- **Folder tree controls:** Expand all / Collapse all icon buttons appear whenever a project has
  folders, alongside the native `<details>` groups.
- **Gallery:** project index (activity-sorted, protected last) plus a "Recently added" feed from
  `/api/catalog` (`updatedAt`, `categories`, `recent[]`; protected projects leak none of them).
- **States:** skeleton loading, empty vs filtered-empty, retryable error, designed 404 shell for
  unknown content routes.

## Content routes, caching and headers

Served by `functions/[[path]].js` from R2:

| Path | Behavior |
|------|----------|
| `/<project>/` | Project listing with folder tree + client filters (text, category chips, type, sort; not Pagefind) |
| `/<project>/<file>` | HTML: iframe viewer · MD: edge-rendered (TOC, highlight.js CDN, GFM task lists) |
| `/<project>/<file>.html\|md` | Raw object |
| `/api/*` | JSON APIs; unknown paths return JSON 404 |
| `/<unknown-project>/…` | shared HTML 404 shell from the content catch-all |
| anything else | `dist/404.html` (static shell fall-through) |

- Cache-Control: public content `public, max-age=60`; protected/ghost content **`private, no-store`**
  (raw bytes: 300s public / no-store private).
- Function handlers emit ETag validators and answer `If-None-Match` with 304 (covered by tests and
  `wrangler pages dev`). Note: Cloudflare currently strips `ETag` from Pages **Function** responses
  at the edge (verified in production), so browsers fall back to the `Cache-Control` max-age above;
  static assets keep their ETags.
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
