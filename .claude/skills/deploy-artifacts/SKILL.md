---
name: deploy-artifacts
description: Use when the user wants to publish/deploy an HTML or Markdown artifact to artifacts.hoangtrung.dev and get a shareable link. Classifies the artifact into the right project folder (asks if unclear), deploys via the share-artifacts repo, optionally password-protects it, and returns the URL. Triggers - "deploy this artifact", "publish this to my site", "share this report/page", "deploy-artifacts", "đẩy artifact này lên web".
---

# Deploy Artifacts to artifacts.hoangtrung.dev

Goal: take an HTML or Markdown artifact, put it under the right project folder, deploy it, and hand the
user a shareable link — auto-classifying the project, or asking when unclear.

- **Repo:** `~/Local/Work/solashi/share-artifacts` (run all scripts from here).
- **Site:** a static Astro app (gallery + viewer) on Cloudflare Pages. `src/artifacts/` is the source of truth.
- **Mechanism:** `deliver.sh` → copies the file into `src/artifacts/<project>/`, runs `npm run build`
  (prepare-static + astro build + pagefind), deploys to Cloudflare Pages, and prints two URLs:
  the viewer `https://artifacts.hoangtrung.dev/<project>/<file>` and the raw
  `https://artifacts.hoangtrung.dev/<project>/<file>.(html|md)`.
- **Tooling is `wrangler` (Pages), NOT `cloudflared`.**
- **Git sync (automatic):** `deliver.sh` runs `git pull --rebase` before copying the artifact (skipped with
  a warning if the working tree is dirty) and `git commit + push` after a successful deploy, so
  `src/artifacts/` stays consistent across machines. Only the artifact + `protected.list` +
  `functions/protected-folders.js` are staged — unrelated changes are left alone.

## Steps

### 1. Locate the artifact
- It's the `.html` or `.md` file just created in this session, or a path the user gives. Only `.html`
  and `.md` are supported (`.htm` is not — it would 404).
- An `.html` artifact must be **self-contained** (inline CSS/JS, images as `data:` URIs — no refs to local
  sibling files). If it references local assets, warn the user (they won't load on the site).
- A `.md` artifact may carry frontmatter (`title`, `description`, `tags`, `date`) — used for gallery metadata.

### 2. Choose the project folder — classify, or ask
1. List existing projects: `ls ~/Local/Work/solashi/share-artifacts/src/artifacts/`
2. Read the artifact's `<title>` and top headings to understand its topic.
3. Decide the destination project:
   - If it clearly belongs to an **existing** project → use that.
   - Otherwise derive a short **kebab-case** slug from the topic (e.g. `cost-review`, `ses-research`,
     `eks-incident`).
4. **If the classification is ambiguous or you are not confident, ASK** (AskUserQuestion): present the
   best-matching existing project(s) + your suggested new slug, and let the user pick. Never silently guess.

### 3. Decide password protection
- If the artifact has internal / work / sensitive content, recommend protecting the project.
- To protect: pass `--protect`. If that project has no password yet, **ask the user for the password** —
  NEVER invent one, NEVER print it to output/logs.
- Skip if the project is already protected (the existing password persists) or the content is clearly public.

### 4. Deploy
```bash
cd ~/Local/Work/solashi/share-artifacts
./deliver.sh <artifact.(html|md)> <project> [--name <newname>.(html|md)] [--protect 'password']
```
- Prerequisite: `wrangler` authenticated (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` env var). If the
  deploy fails on auth, tell the user how to authenticate and stop.

### 5. Return the shareable link
- Report the URL(s) `deliver.sh` printed: the viewer `https://artifacts.hoangtrung.dev/<project>/<file>`
  and the raw `https://artifacts.hoangtrung.dev/<project>/<file>.(html|md)`.
- If the project is protected, tell the user: visiting it opens a **styled login page** (project name + a
  password field) — enter the password there. There is no browser popup; a signed cookie keeps them in for 12h.

## Notes
- One artifact per run. To put many files into one project, copy them into `src/artifacts/<project>/` then run
  `./deploy.sh` once.
- Remove later: `./unpublish.sh <project>/<file>` (or `./unpublish.sh <project>` for the whole project).
- Never commit passwords to git; they live only as Cloudflare secrets (`./protect.sh` handles this, and
  auto-creates the `COOKIE_SECRET` signing key if it's missing).
