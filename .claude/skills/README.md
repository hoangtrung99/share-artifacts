# Repository agent skills

Small, trigger-based skills for working on **artifacts.hoangtrung.dev** (thin Astro shell +
Cloudflare Pages Functions + private R2 content + optional D1 feedback). Each directory loads one
`SKILL.md`; detailed contracts/examples live next to it in `REFERENCE.md`. Load the narrowest skill
that matches the task.

| Skill | Load when | Reference |
|---|---|---|
| [`artifact-feedback`](artifact-feedback/SKILL.md) | read/export feedback, create or revoke review links, mark addressed, resolve/reopen, review UX, local feedback testing | [REFERENCE](artifact-feedback/REFERENCE.md) |
| [`artifact-versions`](artifact-versions/SKILL.md) | publish/republish, inspect old revisions (`?rev=`), bootstrap revisions, explain version 404, unpublish/tombstone | [REFERENCE](artifact-versions/REFERENCE.md) |
| [`deploy-artifacts`](deploy-artifacts/SKILL.md) | deliver/upload an artifact, classify project, rename/move, protect/ghost, publish and return a link (authoring workflow) | — |
| [`artifacts-access`](artifacts-access/SKILL.md) | password/ghost gates, share vs review grants, cookie/session behaviour, 401/403, revocation, security model | [REFERENCE](artifacts-access/REFERENCE.md) |
| [`artifacts-deploy`](artifacts-deploy/SKILL.md) | deploy the shell to Cloudflare Pages, set secrets, create/migrate D1, CI/rollback | [REFERENCE](artifacts-deploy/REFERENCE.md) |
| [`artifacts-local-dev`](artifacts-local-dev/SKILL.md) | run the local stack, seed R2/D1, reproduce viewer/API/auth bugs, run tests/Playwright | [REFERENCE](artifacts-local-dev/REFERENCE.md) |

The previous combined `artifacts-review` skill was split into `artifact-feedback` +
`artifact-versions` so each trigger stays sharp.

## Maintenance

- `SKILL.md` stays under ~100 lines: mental model, commands, guardrails; move detail to
  `REFERENCE.md`.
- Put concrete trigger words in the frontmatter `description` (“Use when …”); that is all the agent
  sees before loading.
- Update these skills in the same change as behaviour changes (commands, routes, environment,
  permissions). Keep examples copy-paste runnable and free of secrets.
- Verify a skill links resolve (`grep -R '](.*REFERENCE.md)' .claude/skills`) and that commands still
  match `package.json` / shell scripts.
- The repo stays public: never add tokens, `.dev.vars` values, protected project names from
  `meta/`/`ghost.list`/`protected.list`, or real artifact content to skills.
