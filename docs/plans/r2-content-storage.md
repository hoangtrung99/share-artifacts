# Plan: R2 content storage (tool-only repo)

**Status:** code complete (2026-07-21). Blocked on Cloudflare account: enable R2 (error 10042), create bucket, migrate, deploy shell.

## Goal

Make `share-artifacts` tool-only. Artifact HTML/MD content lives on private Cloudflare R2.
Deliver uploads go straight to R2 (no full Astro rebuild). Thin Astro shell for gallery/login/ghost.
Pages Functions serve content from R2, edge-render Markdown, and load auth registries from R2.

## R2 layout

Bucket: `artifacts-content` (binding `ARTIFACTS`)

```
content/<project>/<path>.html|md
meta/catalog.json
meta/protected.json
meta/ghost.json
```

## Components

| Piece | Role |
|-------|------|
| `deliver.sh` | Validate, extract meta, `wrangler r2 object put`, catalog upsert, optional protect/ghost |
| `deploy.sh` | Build thin Astro shell + `wrangler pages deploy` (functions + dist) |
| `protect.sh` / `ghost.sh` | CF secrets + write R2 registries (local `.list` as cache) |
| `unpublish.sh` | Delete R2 objects + catalog entries |
| `functions/_store.js` | R2 helpers, registry cache TTL 45s |
| `functions/_markdown.js` | Pure JS markdown → HTML |
| `functions/_render.js` | Project listing / HTML viewer / MD viewer shells |
| `functions/_middleware.js` | Auth from R2 registries (fail-closed) |
| `functions/api/catalog.js` | `GET /api/catalog` |
| `functions/[[path]].js` | Catch-all content routes |
| `scripts/migrate-to-r2.mjs` | One-shot walk of `src/artifacts` → R2 |
| `public/assets/site.css` + `viewer.js` | Non-hashed assets for Function HTML |

## URL contract (unchanged)

- Viewer: `/<project>/<file>`
- Raw: `/<project>/<file>.html` or `.md`
- Project listing: `/<project>/`
- Gallery: `/` (client fetch `/api/catalog`)

## Enablement steps (operator)

1. Cloudflare dashboard → enable R2 (error 10042 if skipped)
2. `npx wrangler r2 bucket create artifacts-content`
3. `node scripts/migrate-to-r2.mjs`
4. `./deploy.sh` (shell + functions with R2 binding)
5. Smoke: public project, protected login, ghost unlock, deliver new file without rebuild

## Dual mode / leftovers

- `src/artifacts/` is **not** deleted until migrate is proven — still the source for migration.
- After thin shell deploy, static artifact pages are gone from `dist`; content is R2-only.
- Local `protected.list` / `ghost.list` remain optional caches; runtime auth uses R2.

## Auth

- Ghost + per-project password layers preserved (fail-closed).
- Share links (`/share`, `/s/:token`) unchanged.
- Passwords never in git.
