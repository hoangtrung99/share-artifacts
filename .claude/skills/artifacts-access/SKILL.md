---
name: artifacts-access
description: Understand and change who can view or comment on artifacts.hoangtrung.dev content. Use when asked about password protection, ghost/hidden projects, share links, review grants, 401/403 responses, cookie/session behaviour, revocation, or the security model of the artifact host.
---

# Artifacts access

Access is layered: **project gate** (public / password / ghost) → optional **review grant** for
feedback → **owner credential** for management. [REFERENCE.md](REFERENCE.md) has the token formats,
cookie names and the full permission matrix.

## Layers

1. **Public project** — anyone with the URL can read; no write access of any kind without a grant.
2. **Protected project** — middleware requires a valid signed `cf_auth_<project>` cookie; it is
   issued by `/login?project=…` with `PW_<PROJECT>`, or by redeeming a project share link `/s/<token>`.
   Tokens are bound to a password-version fingerprint: rotating the password revokes all sessions and
   share links.
3. **Ghost project** — hidden from the gallery; requires the master cookie `cf_ghost` from `/ghost`.
   A project can be both ghost and protected; a share link will not bypass either gate and ghost
   projects cannot be shared.
4. **Review grant** — `/r/<token>` sets a scoped `cf_review_<artifactId16>` cookie (HttpOnly,
   SameSite=Strict, Secure) that adds comment/reply/resolve rights **on top of** the project gate.
   It never bypasses password/ghost. Grants are revocable and expire.
5. **Owner credential** — `FEEDBACK_ADMIN_TOKEN` is a server-side Pages secret used by the CLI only
   (mark addressed, manage grants, read all feedback). Project/share cookies are deliberately
   read-only for feedback because share links reuse the same project cookie.

## Rules to follow

- Never put the admin token in a browser, URL, artifact content or git. Local value lives in
  `.dev.vars`; production is a Pages secret.
- Do not weaken a gate to test something: for local verification start a separate Pages dev server
  with test secrets (`PW_<P>=test`, `COOKIE_SECRET=test`, `GHOST_MASTER_PW=test`) and forged cookies
  minted with the repo's `_auth.js` helpers.
- Public artifact review data is not public: `/api/feedback*` needs a grant or admin token.
  `/api/revisions` metadata *is* public for public artifacts (no feedback fields).
- Mutations require same-origin `Origin` and JSON; 403/`csrf` is expected from curl unless you send
  the matching `Origin` header.
- Unpublish/protect/ghost only take effect after edge caches expire (~45s) and never retroactively
  erase bytes a client already cached before protection.

## Common responses

| Status | Meaning |
|---|---|
| `401 auth_required` | project/ghost cookie missing or expired (or password rotated) |
| `403 forbidden` | authenticated but lacking the capability (grant/admin required, or CSRF) |
| `403 misconfigured` | project listed protected/ghost but secret missing — fail closed |
| `503 feedback_not_configured` | D1 binding absent; content is unaffected |
| redirect to `/login` or `/ghost` | document navigation without the required cookie |

## Change access

```bash
./protect.sh <project> [password] ; ./protect.sh --unprotect <project>
./ghost.sh <project> ; ./ghost.sh --unghost <project>
pnpm run feedback:grant -- create --project <p> --file <f> --ttl 7d
pnpm run feedback:grant -- revoke --grant <grantId>
```

See `artifact-publishing` for share/unpublish and `artifact-feedback` for grant workflows.
