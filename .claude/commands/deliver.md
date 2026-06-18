---
description: Publish an HTML artifact to artifacts.hoangtrung.dev in one step
argument-hint: <file.html> [project] [--protect [password]] [--open]
---

The user wants to publish/deliver an HTML artifact to artifacts.hoangtrung.dev.

Arguments received: `$ARGUMENTS`

Run from the share-artifacts repo root:

```
./deliver.sh $ARGUMENTS
```

Notes:
- Default project folder is `shared` if none is given.
- `--protect [password]` password-protects the project folder (Basic Auth). If no password is given,
  `protect.sh` prompts for it — do NOT invent a password and do NOT print any password to logs.
- After it finishes, report the shareable URL(s) the script printed.
- Prerequisite: wrangler is authenticated (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` env var set).
