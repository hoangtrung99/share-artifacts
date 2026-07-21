# artifacts.hoangtrung.dev

**Tool-only** artifact host. Content (HTML/MD) is **not** in git — it lives on a private Cloudflare R2 bucket. This repo holds the thin Astro shell, Pages Functions, and CLI scripts (`deliver`, `unpublish`, `protect`, `ghost`, `deploy`).

- Viewer: `https://artifacts.hoangtrung.dev/<project>/<file>`
- Raw: `https://artifacts.hoangtrung.dev/<project>/<file>.(html|md)`
- Gallery: `https://artifacts.hoangtrung.dev/` (client fetches `/api/catalog`)
- Project listing: `https://artifacts.hoangtrung.dev/<project>/` (folder tree + filters)

## Architecture

```
R2 bucket: artifacts-content  (private)
  content/<project>/<path>.html|md
  meta/catalog.json
  meta/protected.json
  meta/ghost.json

Cloudflare Pages (project: artifacts)
  dist/              thin Astro shell: /, /login, /ghost
  functions/         auth, catalog API, content catch-all
  Binding ARTIFACTS → artifacts-content  (wrangler.jsonc)
```

```
.
├── src/pages/                 # Thin shell only: index, login, ghost
├── public/assets/             # site.css + viewer.js (non-hashed; used by Function HTML)
├── functions/
│   ├── _middleware.js         # ghost + per-project auth (R2 registries, fail-closed)
│   ├── _store.js              # R2 helpers, catalog/registry load (edge cache ~45s)
│   ├── _markdown.js           # MD → HTML (TOC, task lists, …)
│   ├── _render.js             # listing / HTML iframe viewer / MD shell
│   ├── _auth.js               # HMAC cookies, share tokens
│   ├── api/catalog.js         # GET /api/catalog
│   ├── [[path]].js            # content catch-all from R2
│   ├── login.js / logout.js / ghost.js / share.js / s/[token].js
├── scripts/
│   ├── prepare-static.mjs     # thin shell prep (no artifact copy)
│   ├── catalog-upsert.mjs
│   ├── registry-write.mjs
│   ├── migrate-to-r2.mjs      # one-shot (already run; historical)
│   └── lib/{meta,r2-cli}.mjs
├── deliver.sh                 # R2 put + catalog upsert (--remote)
├── deploy.sh                  # prepare-static + astro build + pages deploy
├── protect.sh / ghost.sh      # CF secrets + R2 registry (no shell redeploy)
├── unpublish.sh               # R2 delete --remote + catalog remove
└── wrangler.jsonc             # pages + r2_buckets binding
```

There is **no** `src/artifacts/` — content is not checked into git.

## One-time setup

### 1. Enable R2 + create bucket

In the **Cloudflare dashboard**, enable **R2** for the account. Until that is done, wrangler returns **error 10042**.

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

> Migration from a local `src/artifacts/` tree was a one-shot (`scripts/migrate-to-r2.mjs`) and is already done. New content always goes through `deliver.sh`.

## Daily workflow

```bash
# Publish one file → R2 + catalog (no rebuild, no pages deploy, no git commit of content)
./deliver.sh ./report.html cost-review
# → viewer: https://artifacts.hoangtrung.dev/cost-review/report
# → raw:    https://artifacts.hoangtrung.dev/cost-review/report.html

# Nested path under the project
./deliver.sh ./report.html cost-review --name folder/report.html

./deliver.sh ./secret.md ops --protect --ghost
./unpublish.sh cost-review/report   # one file
./unpublish.sh cost-review          # whole project
```

**Wrangler R2 CLI must use `--remote`** (wrangler 4 defaults to local otherwise). All scripts already pass `--remote`.

### When to run `deploy.sh`

Only when the **shell** changes: Functions, Astro pages (`/`, `/login`, `/ghost`), or `public/assets/*`. **Not** for new or updated content.

```bash
./deploy.sh   # prepare-static + astro build + wrangler pages deploy
```

### Metadata

- **Markdown:** frontmatter `title`, `description`, `tags`, `date`.
- **HTML:** `<title>`, `<meta name="description">`, optional `<meta name="date" content="YYYY-MM-DD">`.

## Password protection

Auth: styled `/login` + signed cookie `cf_auth_<project>` (HMAC-SHA256 on `COOKIE_SECRET`).

| | Project cookie | Ghost cookie |
|--|----------------|--------------|
| TTL | **180 days** | **7 days** |

Password is a Pages secret `PW_<PROJECT>` — **never in git**. Runtime registry: `meta/protected.json` on R2. Local `protected.list` is an optional cache.

**Fail-closed:** project listed as protected but missing `PW_*` or `COOKIE_SECRET` → 403.

```bash
./protect.sh my-project
./protect.sh my-project 's3cret'
./protect.sh --list
./protect.sh --unprotect my-project
```

**No shell redeploy** after protect/unprotect — secrets + R2 registry only. Home 🔒 badges come from `/api/catalog` (edge cache ~45s).

## Ghost projects

Hidden from `/`. Visible at `/ghost` after master password (`GHOST_MASTER_PW`). Registry: `meta/ghost.json` on R2. Local `ghost.list` is optional cache. A project can be both ghost and password-protected.

```bash
./ghost.sh my-project
./ghost.sh --list
./ghost.sh --unghost my-project
./ghost.sh --set-master
```

Same as protect: **no `deploy.sh` required** for ghost/unghost.

## Share links

`POST /share` → `GET /s/<token>`. Caller must already be authenticated for the project. TTL options: **24h / 7d / 30d / 180d**. Stateless HMAC — rotating `COOKIE_SECRET` revokes all outstanding shares.

## Content routes & UI

Served by `functions/[[path]].js` from R2:

| Path | Behavior |
|------|----------|
| `/<project>/` | Project listing with **folder tree** + client-side filters (simple text filter, not Pagefind) |
| `/<project>/<file>` | HTML: iframe viewer · MD: **edge-rendered** (TOC, highlight.js CDN, GFM task lists) |
| `/<project>/<file>.html\|md` | Raw object |
| `/` | Gallery shell; client loads `/api/catalog` |

Search on the gallery and project listing is a **simple client filter** over catalog data — not Pagefind.

## Multi-machine

- **Content sync = R2.** Deliver/unpublish from any machine with wrangler auth; no git pull of artifacts needed.
- **Git** is only for tool code (shell, functions, scripts). Clone the repo to get CLIs; content is already on R2.

## Build (shell only)

```bash
pnpm run build   # prepare-static + astro build (no artifact enumeration)
```

## Constants

| Name | Value |
|------|--------|
| Site | `https://artifacts.hoangtrung.dev` |
| Pages project | `artifacts` |
| R2 bucket | `artifacts-content` |
| Binding | `ARTIFACTS` |
| Content keys | `content/<project>/<path>.html\|md` |
| Catalog / registries | `meta/catalog.json`, `meta/protected.json`, `meta/ghost.json` |
| Project cookie TTL | 180 days |
| Ghost cookie TTL | 7 days |
| Share TTLs | 24h / 7d / 30d / 180d |
| Registry edge cache | ~45s |

## Plan / design notes

See [`docs/plans/r2-content-storage.md`](docs/plans/r2-content-storage.md) (status: **Implemented**).
