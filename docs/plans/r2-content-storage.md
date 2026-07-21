# Plan: R2 content storage (tool-only repo)

**Status: Implemented** (2026-07-21).

Content lives on private R2. `src/artifacts/` has been **removed**. One-shot migrate
(`scripts/migrate-to-r2.mjs`) already ran. New content is delivered only via `deliver.sh`.

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
| `deliver.sh` | Validate, extract meta, `wrangler r2 object put --remote`, catalog upsert, optional protect/ghost |
| `deploy.sh` | Build thin Astro shell + `wrangler pages deploy` (functions + dist) — shell only |
| `protect.sh` / `ghost.sh` | CF secrets + write R2 registries (local `.list` as optional cache); **no** shell redeploy |
| `unpublish.sh` | Delete R2 objects `--remote` + catalog entries |
| `functions/_store.js` | R2 helpers, registry cache TTL 45s |
| `functions/_markdown.js` | Pure JS markdown → HTML (TOC, task lists, …) |
| `functions/_render.js` | Project listing (folder tree) / HTML iframe viewer / MD viewer (highlight.js CDN) |
| `functions/_middleware.js` | Auth from R2 registries (fail-closed) |
| `functions/api/catalog.js` | `GET /api/catalog` |
| `functions/[[path]].js` | Catch-all content routes |
| `scripts/migrate-to-r2.mjs` | One-shot walk of former `src/artifacts` → R2 (**done**; historical) |
| `public/assets/site.css` + `viewer.js` | Non-hashed assets for Function HTML |

## URL contract

- Viewer: `/<project>/<file>`
- Raw: `/<project>/<file>.html` or `.md`
- Project listing: `/<project>/` (folder tree + client filters)
- Gallery: `/` (client fetch `/api/catalog`)
- Share: `POST /share`, `GET /s/<token>` (TTL 24h / 7d / 30d / 180d)

## Operator notes (post-implementation)

1. R2 enabled on account; bucket `artifacts-content` exists.
2. Shell + functions deployed with R2 binding (`./deploy.sh` when shell changes).
3. Daily content path: `./deliver.sh` / `./unpublish.sh` only — no rebuild.
4. Protect/ghost: secrets + R2 registry; badge lag ≤ edge cache (~45s).

## Leftovers / conventions

- **No** `src/artifacts/` in the repo. Content is R2-only.
- Local `protected.list` / `ghost.list` remain optional caches; runtime auth uses R2.
- Wrangler R2 CLI uses `--remote` in all scripts (wrangler 4 defaults to local).

## Auth

- Ghost (cookie TTL 7d) + per-project password (cookie TTL **180d**), fail-closed.
- Share links (`/share`, `/s/:token`) preserved.
- Passwords never in git.
