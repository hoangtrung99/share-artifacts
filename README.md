# artifacts.hoangtrung.dev

Tool-only artifact host. **Content (HTML/MD) lives on private Cloudflare R2.** A thin Astro shell
provides the gallery, login, and ghost pages. Cloudflare Pages Functions serve content from R2,
edge-render Markdown, and enforce password / ghost auth from runtime registries on R2.

- Viewer: `https://artifacts.hoangtrung.dev/<project>/<file>`
- Raw: `https://artifacts.hoangtrung.dev/<project>/<file>.(md|html)`
- Gallery: `https://artifacts.hoangtrung.dev/` (client-side `/api/catalog`)

## Architecture

```
R2 bucket: artifacts-content
  content/<project>/<path>.html|md
  meta/catalog.json
  meta/protected.json
  meta/ghost.json

Pages (dist/ + functions/)
  Thin Astro shell: /, /login, /ghost
  Functions: auth middleware, /api/catalog, catch-all content routes
  Binding: ARTIFACTS → artifacts-content
```

```
.
├── src/pages/                 # Thin shell: index, login, ghost
├── src/artifacts/             # LOCAL ONLY — migration source (not served after migrate)
├── public/assets/             # site.css + viewer.js (non-hashed, used by Function HTML)
├── functions/
│   ├── _middleware.js         # ghost + per-project auth (registry from R2)
│   ├── _store.js              # R2 helpers, catalog/registry load
│   ├── _markdown.js           # MD → HTML
│   ├── _render.js             # listing / viewer HTML shells
│   ├── _auth.js               # HMAC cookies, share tokens
│   ├── api/catalog.js         # GET /api/catalog
│   ├── [[path]].js            # content catch-all
│   ├── login.js / logout.js / ghost.js / share.js / s/[token].js
├── scripts/
│   ├── prepare-static.mjs     # thin shell prep (no artifact copy)
│   ├── catalog-upsert.mjs
│   ├── registry-write.mjs
│   ├── migrate-to-r2.mjs
│   └── lib/{meta,r2-cli}.mjs
├── deliver.sh                 # upload one artifact to R2 + catalog
├── deploy.sh                  # build shell + pages deploy
├── protect.sh / ghost.sh      # secrets + R2 registry
├── unpublish.sh               # delete from R2 + catalog
└── wrangler.jsonc             # pages + r2_buckets binding
```

## One-time setup

### 1. Enable R2 (required)

In the **Cloudflare dashboard**, enable **R2** for the account. Until this is done, wrangler returns
**error 10042**. Then create the bucket:

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

### 3. Migrate existing content (if you still have `src/artifacts/`)

```bash
node scripts/migrate-to-r2.mjs --dry-run   # preview
node scripts/migrate-to-r2.mjs             # upload all + seed catalog + registries
```

### 4. Deploy the shell

```bash
./deploy.sh
```

Custom domain (once): Workers & Pages → `artifacts` → Custom domains → `artifacts.hoangtrung.dev`.

## Daily workflow

```bash
# Publish one file (no rebuild)
./deliver.sh ./report.html cost-review
# → viewer: https://artifacts.hoangtrung.dev/cost-review/report
# → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html

./deliver.sh ./secret.md ops --protect --ghost
./unpublish.sh cost-review/report
./unpublish.sh cost-review          # whole project
```

Redeploy the **shell** only when changing Functions, Astro pages, or `public/assets/*`:

```bash
./deploy.sh
```

### Metadata

- **Markdown:** frontmatter `title`, `description`, `tags`, `date`.
- **HTML:** `<title>`, `<meta name="description">`, optional `<meta name="date" content="YYYY-MM-DD">`.

## Password protection

Auth uses a styled `/login` page + signed cookie `cf_auth_<project>` (HMAC-SHA256 on `COOKIE_SECRET`).
Password is a Pages secret `PW_<PROJECT>` — **never in git**. Project name is stored in
`protected.list` (local cache) and `meta/protected.json` on R2 (runtime registry).

**Fail-closed:** listed protected but missing `PW_*` or `COOKIE_SECRET` → 403.

```bash
./protect.sh my-project
./protect.sh my-project 's3cret'
./protect.sh --list
./protect.sh --unprotect my-project
# No shell redeploy required — R2 registry updates immediately (edge cache ~45s).
```

## Ghost projects

Hidden from `/`. Visible at `/ghost` after master password (`GHOST_MASTER_PW`). Registry:
`meta/ghost.json` on R2. Can be both ghost and password-protected.

```bash
./ghost.sh my-project
./ghost.sh --list
./ghost.sh --unghost my-project
./ghost.sh --set-master
```

## Share links

Signed share tokens (`POST /share` → `GET /s/<token>`). Caller must already be authenticated for the
project. Duration options: 24h / 7d / 30d / 180d. Stateless — rotating `COOKIE_SECRET` revokes all.

## Build

```bash
pnpm run build   # prepare-static + astro build (no pagefind, no artifact enumeration)
```

## Constants

| Name | Value |
|------|--------|
| Pages project | `artifacts` |
| R2 bucket | `artifacts-content` |
| Binding | `ARTIFACTS` |
| Site | `https://artifacts.hoangtrung.dev` |

## Plan

See `docs/plans/r2-content-storage.md`.
