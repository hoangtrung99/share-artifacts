---
name: deploy-artifacts
description: Use when the user wants to publish/deploy an HTML artifact to artifacts.hoangtrung.dev and get a shareable link. Classifies the artifact into the right project folder (asks if unclear), deploys via the share-artifacts repo, optionally password-protects it, and returns the URL. Triggers - "deploy this artifact", "publish this to my site", "share this report/page", "deploy-artifacts", "đẩy artifact này lên web".
---

# Deploy Artifacts to artifacts.hoangtrung.dev

Goal: take an HTML artifact, put it under the right project folder, deploy it, and hand the user a
shareable link — auto-classifying the project, or asking when unclear.

- **Repo:** `~/Local/Work/solashi/share-artifacts` (run all scripts from here).
- **Mechanism:** `deliver.sh` → copies the file into `public/<project>/`, regenerates the file-browser,
  deploys to Cloudflare Pages, prints the URL `https://artifacts.hoangtrung.dev/<project>/<file>`.
- **Tooling is `wrangler` (Pages), NOT `cloudflared`.**

## Steps

### 1. Locate the artifact
- It's the HTML file just created in this session, or a path the user gives.
- It must be a **self-contained** `.html` (inline CSS/JS, images as `data:` URIs — no refs to local
  sibling files). If it references local assets, warn the user (they won't load on the site).

### 2. Choose the project folder — classify, or ask
1. List existing projects: `ls ~/Local/Work/solashi/share-artifacts/public/`
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
./deliver.sh <artifact.html> <project> [--name <newname>.html] [--protect 'password']
```
- Prerequisite: `wrangler` authenticated (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` env var). If the
  deploy fails on auth, tell the user how to authenticate and stop.

### 5. Return the shareable link
- Report the URL(s) `deliver.sh` printed: `https://artifacts.hoangtrung.dev/<project>/<file>`
  (and the clean URL without `.html`).
- If the project is protected, remind the user: open with a **blank username** and enter the password.

## Notes
- One artifact per run. To put many files into one project, copy them into `public/<project>/` then run
  `./deploy.sh` once.
- Remove later: `./unpublish.sh <project>/<file>.html` (or `./unpublish.sh <project>` for the whole project).
- Never commit passwords to git; they live only as Cloudflare secrets (`./protect.sh` handles this).
