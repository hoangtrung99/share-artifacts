# artifact-feedback — reference

## API (base `https://artifacts.hoangtrung.dev`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/feedback?artifact=<id>&status=open&revision=current\|all\|<rev>` | list threads + counts + permissions |
| GET | `/api/feedback/<threadId>` | one thread with messages |
| POST | `/api/feedback` | create thread (requires `revisionId`, `kind`, `anchor`, `body`, `idempotencyKey`) |
| POST | `/api/feedback/<threadId>/replies` | reply |
| PATCH | `/api/feedback/<threadId>` | status transition (`expectedVersion` CAS) |
| GET | `/api/feedback/export?artifact=<id>&format=json\|md` | export for agents |
| GET | `/api/revisions?artifact=<id>` or `?project=&file=` | version metadata (public for public artifacts) |
| POST/GET/DELETE | `/api/feedback/grants[/<grantId>]` | owner grant management |
| GET | `/r/<token>` | redeem grant → HttpOnly artifact cookie → viewer |

Headers: `X-Feedback-Admin: <FEEDBACK_ADMIN_TOKEN>` (owner CLI) or the review cookie; protected/ghost
artifacts still require the project/ghost cookie — a grant never bypasses it. `Origin` must be
same-origin for mutations; bodies are JSON. Errors: `{error, code}` (`auth_required`, `forbidden`,
`version_conflict`, `idempotency_conflict`, `invalid_revision`, `feedback_not_configured`, …).

## Thread shape (abridged)

```json
{
  "threadId": "th_…", "artifactId": "…", "project": "demo", "file": "sample.html",
  "revisionId": "…", "revisionNumber": 2, "kind": "comment|replace|remove",
  "status": "open|addressed|resolved", "version": 3,
  "anchor": { "version": 1, "type": "text|document", "exact": "…", "prefix": "…",
              "suffix": "…", "start": 0, "end": 42, "heading": "…", "headingPath": ["…"],
              "element": {"tag":"p","id":"intro","role":null,"selector":"#intro","text":"…"} },
  "replacement": null, "addressedRevisionId": null,
  "author": {"name":"An","kind":"owner|reviewer|guest","unverified":true},
  "messages": [{"messageId":"msg_…","seq":1,"body":"…","author":{…},"createdAt":"…"}],
  "permissions": {"canReply":true,"canChangeStatus":false,"canResolve":true,"canReopen":false}
}
```

Anchor rules: `exact` is stored verbatim; `prefix`/`suffix` keep boundary whitespace (meaningful for
duplicate disambiguation); offsets are hints only. Resolution order: unique exact occurrence →
prefix/suffix context; ambiguity = `unanchored` (never the wrong passage). Threads stay in the
history even when unanchored.

## Status transitions and how to mark them

| Transition | Who | How |
|---|---|---|
| `open → addressed` | owner only | `pnpm run feedback -- addressed --thread <id> --revision <newRevisionId>` |
| `addressed → resolved` | owner or reviewer | reviewer clicks **Resolve** in popup/panel (or PATCH with `expectedVersion`) |
| `resolved → open` | owner or reviewer | **Reopen** |
| `open → resolved` | not allowed | a fixing revision must be recorded first |

Resolve uses the recorded `addressedRevisionId`; callers cannot retarget it. `expectedVersion`
mismatch returns `409 version_conflict` plus the current thread.

## CLI env

- `ARTIFACTS_SITE_URL` (default production URL)
- `FEEDBACK_ADMIN_TOKEN` — owner read + `addressed` + grants; in this repo read from `.dev.vars`
- `ARTIFACTS_COOKIE` — browser cookie header, e.g. `cf_review_<artifactId16>=gr_…` or `cf_auth_<p>=…`

Reviewer-cookie example:

```bash
TOKEN="$(node -e 'console.log(process.argv[1].split("/r/")[1])' "$REVIEW_URL")"
curl -s -c /tmp/review.cookies -o /dev/null "https://artifacts.hoangtrung.dev/r/$TOKEN"
COOKIE=$(awk '$6 ~ /^cf_review_/ {print $6"="$7}' /tmp/review.cookies)
ARTIFACTS_COOKIE="$COOKIE" pnpm run feedback -- list --artifact <id> --format json
```

## Review link / grant details

- TTL 60s–180d (`--ttl 7d` default); the link is `/r/<token>`; redemption sets
  `cf_review_<artifactId16>` (HttpOnly, SameSite=Strict, Secure, max-age capped at grant expiry) and
  redirects to the extensionless viewer without the token.
- The token is stored server-side as SHA-256; revoke with `feedback:grant -- revoke`. Expiry and
  revocation win on the next request.
- Public artifact: anyone with the grant can read/comment on that artifact. Protected/ghost:
  grant holders still pass the project/ghost gate first.
- Project/share cookie sessions are read-only; only the admin token (CLI) can mark addressed/manage
  grants. This is deliberate: share links reuse the same project cookie.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| `503 feedback_not_configured` | D1 binding absent (local/dev) — feature disabled, rest of site fine |
| `403 forbidden` on list | no grant/admin credential for a public artifact |
| `401 auth_required` | protected/ghost project cookie missing or expired |
| `409 version_conflict` | thread changed; refetch and retry with the returned version |
| `400 invalid_revision` | resolving before addressed, or wrong revision id |
| thread shows `Location lost` / `Unanchored` | quote context no longer resolves in that revision; do not auto-attach |

## Local setup

```bash
pnpm run build
# seed local R2 (content + revisions + meta/catalog.json) with `wrangler r2 object put --local --persist-to DIR`
npx wrangler pages dev dist --port 8788 --persist-to DIR --d1=FEEDBACK_DB \
  --binding FEEDBACK_ADMIN_TOKEN=demo-admin-token
```

Apply `migrations/0001_feedback.sql` to the local D1 sqlite, then create grants through
`POST /api/feedback/grants` (header `X-Feedback-Admin`) or `pnpm run feedback:grant`.
