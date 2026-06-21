---
description: Publish an HTML or Markdown artifact to artifacts.hoangtrung.dev in one step
argument-hint: <file.(html|md)> [project] [--protect [password]] [--open]
---

The user wants to publish/deliver an HTML or Markdown artifact to artifacts.hoangtrung.dev.

Arguments received: `$ARGUMENTS`

Run from the share-artifacts repo root:

```
./deliver.sh $ARGUMENTS
```

Notes:
- Only `.html` and `.md` are supported (`.htm` is rejected — it would 404).
- Default project folder is `shared` if none is given.
- `deliver.sh` runs `git pull --rebase` first (sync source across machines), then copies into
  `src/artifacts/<project>/`, runs `npm run build`, deploys, runs `git commit + push` (publish artifact to
  git so other machines sync), then prints both the viewer URL (`/<project>/<file>`) and the raw URL
  (`/<project>/<file>.(html|md)`).
- `--protect [password]` protects the project via the styled login page + signed cookie. If no password is
  given, `protect.sh` prompts for it — do NOT invent a password and do NOT print any password to logs.
- After it finishes, report the shareable URL(s) the script printed.
- Prerequisite: wrangler is authenticated (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` env var set).
