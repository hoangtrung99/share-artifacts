# artifacts-access — reference

## Cookie / token inventory

| Cookie / secret | Scope | Purpose |
|---|---|---|
| `cf_auth_<project>` | one project | project password session (HMAC, password-version bound, 180d) |
| `cf_ghost` | all ghost projects | ghost master unlock (7d, bound to `GHOST_MASTER_PW`) |
| share link `/s/<token>` | one project + path | redeems into `cf_auth_<project>` for the link TTL |
| review link `/r/<token>` | one artifact | sets `cf_review_<artifactId16>` (HttpOnly, SameSite=Strict, Secure, TTL ≤ grant) |
| `FEEDBACK_ADMIN_TOKEN` | site owner | CLI-only read/export, mark addressed, grant management |
| `COOKIE_SECRET` | all HMAC tokens | rotating revokes every session/share/review cookie |
| `GHOST_MASTER_PW` | ghost layer | master password; rotating revokes ghost sessions |
| `PW_<SNAKE(PROJECT)>` | one project | the project password (Pages secret) |

## Enforcement points

- `functions/_middleware.js` gates content routes: ghost layer first, then per-project password.
  It lets `/api/*` through, so each API route enforces its own access.
- `/api/revisions` is readable anonymously for **public** artifacts (metadata only); protected and
  ghost projects require their cookies.
- `/api/feedback*` and exports always require: admin token, a valid review-grant cookie for that
  artifact, or a project/ghost session **for protected/ghost projects** (read-only). Writes require
  admin or grant.
- Feedback routes fail closed on malformed protected/ghost registry JSON and on unreadable revision
  manifests (`503 registry_unavailable`).
- Mutations: same-origin `Origin` required (otherwise `403 csrf`), JSON content type, bounded sizes,
  best-effort isolate rate limits (30 writes / 120 reads per minute per artifact+credential).

## CSRF/curl recipes

```bash
# grant creation as owner (Origin required)
curl -s -X POST -H 'content-type: application/json' \
  -H 'Origin: https://artifacts.hoangtrung.dev' \
  -H "X-Feedback-Admin: $FEEDBACK_ADMIN_TOKEN" \
  -d '{"project":"<p>","file":"<f>","scope":"comment","ttlSeconds":604800}' \
  https://artifacts.hoangtrung.dev/api/feedback/grants

# reviewer read: redeem first, then reuse the cookie
curl -s -c /tmp/review.cookies -o /dev/null "https://artifacts.hoangtrung.dev/r/<token>"
COOKIE=$(awk '$6 ~ /^cf_review_/ {print $6"="$7}' /tmp/review.cookies)
curl -s -H "Cookie: $COOKIE" "https://artifacts.hoangtrung.dev/api/feedback?project=<p>&file=<f>"
```

## Local test cookies

Use a separate `wrangler pages dev` instance with test secrets and mint signed cookies with the same
helpers the app uses (`functions/_auth.js`: `signToken`, `authCookie`, `GHOST_*`, `pwVersion`).
Do not reuse production secrets locally. The node tests already demonstrate this pattern in
`test/auth.test.mjs` and `test/helpers/fakes.mjs`.

## Revocation cheat-sheet

| Change | Revokes |
|---|---|
| rotate `PW_<PROJECT>` | that project's sessions + share links + reviewer links gated by it |
| rotate `COOKIE_SECRET` | every auth/share/ghost/review cookie |
| revoke a review grant | that artifact's review cookie on next request |
| unpublish artifact/project | routes 404 (tombstones), feedback history kept server-side |
| `--unprotect` / `--unghost` | gates removed (takes effect after caches) |
