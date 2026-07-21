---
description: Publish an HTML or Markdown artifact to artifacts.hoangtrung.dev in one step
argument-hint: <file.(html|md)> [project] [--protect [password]] [--open]
---

The user wants to publish/deliver an HTML or Markdown artifact to artifacts.hoangtrung.dev.

Arguments received: `$ARGUMENTS`

Run from the **share-artifacts repo root**:

```
./deliver.sh $ARGUMENTS
```

Notes:
- Only `.html` and `.md` are supported (`.htm` is rejected — it would 404).
- Default project is `shared` if none is given.
- Content is uploaded to **Cloudflare R2** (bucket `artifacts-content`) via `wrangler r2 object put --remote`,
  and the catalog is upserted. Scripts already pass `--remote` (wrangler 4 defaults to local otherwise).
- There is **no** Astro rebuild, **no** `./deploy.sh`, and **no** git commit of artifact content for a normal deliver.
- Nested path under the project: `--name folder/file.html`.
- Prints viewer URL (`/<project>/<file>`) and raw URL (`/<project>/<file>.(html|md)`).
- `--protect [password]` protects the project via styled login + signed cookie + R2 registry
  (`meta/protected.json`). No shell redeploy required. If no password is given, `protect.sh` prompts —
  do NOT invent a password and do NOT print passwords.
- `--ghost` hides the project from the home gallery (master password at `/ghost`; R2 registry
  `meta/ghost.json`). No shell redeploy required.
- After it finishes, report the shareable URL(s) the script printed.
- Prerequisite: wrangler authenticated; R2 enabled on the account; bucket `artifacts-content` exists.
  If error 10042, tell the user to enable R2 in the Cloudflare dashboard first.
