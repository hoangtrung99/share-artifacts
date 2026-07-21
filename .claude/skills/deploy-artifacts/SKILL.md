---
name: deploy-artifacts
description: Use when the user wants to publish/deploy an HTML or Markdown artifact to artifacts.hoangtrung.dev and get a shareable link. Classifies the artifact into the right project folder (asks if unclear), uploads via R2 deliver (no full rebuild), optionally password-protects it, optionally marks it as a hidden (ghost) project, and returns the URL. Triggers - "deploy this artifact", "publish to my site", "share this report/page", "deploy-artifacts", "đẩy artifact này lên web".
---

# Deploy Artifacts to artifacts.hoangtrung.dev

Goal: take an HTML or Markdown artifact, upload it to R2 under the right project, update the catalog,
and hand the user a shareable link — auto-classifying the project, or asking when unclear.

- **Repo:** `share-artifacts` (run all scripts from repo root).
- **Site:** thin Astro shell (gallery + login + ghost) on Cloudflare Pages. **Content lives on R2**
  (`artifacts-content` bucket). Pages Functions serve content and edge-render Markdown.
- **Mechanism:** `deliver.sh` → `wrangler r2 object put` + catalog upsert. **No** `pnpm build`, **no**
  full Pages content rebuild, **no** git commit of artifacts for a normal deliver.
- **Tooling is `wrangler` (Pages + R2), NOT `cloudflared`.**
- **Shell deploy (rare):** `./deploy.sh` only when functions/shell/CSS change — not for new content.

## Prerequisites (once)

1. Enable **R2** in the Cloudflare dashboard (account-level).
2. Create bucket: `npx wrangler r2 bucket create artifacts-content`
3. Migrate existing content (if any): `node scripts/migrate-to-r2.mjs`
4. Deploy shell: `./deploy.sh`

## Steps

### 1. Locate the artifact
- It's the `.html` or `.md` file just created in this session, or a path the user gives. Only `.html`
  and `.md` are supported (`.htm` is not).
- An `.html` artifact must be **self-contained** (inline CSS/JS, images as `data:` URIs).
- A `.md` artifact may carry frontmatter (`title`, `description`, `tags`, `date`).

### 2. Choose the project folder — classify, or ask
1. Prefer existing project names from the live site / known folders (e.g. `verups`, `guides`, `read`).
2. Read the artifact's `<title>` / headings to understand its topic.
3. Decide destination:
   - Clear match to an **existing** project → use that.
   - Else derive a short **kebab-case** slug (e.g. `cost-review`, `eks-incident`).
4. **If ambiguous, ASK** (AskUserQuestion). Never silently guess.

### 3. Decide password protection
- Internal / work / sensitive content → recommend `--protect`.
- If the project has no password yet, **ask the user for the password** — NEVER invent one, NEVER print it.
- Skip if already protected or clearly public.

### 4. Decide ghost mode
- Hidden from public home → `--ghost` (unlock via `/ghost` master password).
- Can combine `--ghost` and `--protect`.
- Do NOT invent the master password; `--ghost` ensures `GHOST_MASTER_PW` exists.

### 5. Deliver (R2 path)
```bash
cd <share-artifacts-repo>
./deliver.sh <artifact.(html|md)> <project> [--name <newname>.(html|md)] [--protect 'password'] [--ghost]
```
- Prerequisite: `wrangler` authenticated. If auth fails, tell the user how to login and stop.
- If R2 is not enabled (error 10042), tell the user to enable R2 in the dashboard and create
  bucket `artifacts-content`, then retry.

### 6. Return the shareable link
- Viewer: `https://artifacts.hoangtrung.dev/<project>/<file>`
- Raw: `https://artifacts.hoangtrung.dev/<project>/<file>.(html|md)`
- Protected → styled `/login` page; signed cookie (long-lived).
- Ghost → hidden from home; `https://artifacts.hoangtrung.dev/ghost` after master password.

## Notes
- One artifact per `deliver.sh` run. Nested path: `--name folder/file.html`.
- Remove: `./unpublish.sh <project>/<file>` or `./unpublish.sh <project>`.
- Never commit passwords; secrets stay on Cloudflare. Registries live on R2 (`meta/protected.json`,
  `meta/ghost.json`); local `protected.list` / `ghost.list` are optional caches.
- Redeploy the **shell** only when changing functions, Astro pages, or `public/assets/*`:
  `./deploy.sh`.
