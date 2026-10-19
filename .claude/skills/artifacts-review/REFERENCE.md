# artifacts-review — reference

## API (base `https://artifacts.hoangtrung.dev`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/feedback?artifact=<id>&status=open&revision=current\|all\|<rev>` | list threads + counts + permissions |
| GET | `/api/feedback/<threadId>` | one thread with messages |
| POST | `/api/feedback` | create thread (requires `revisionId`, `kind`, `anchor`, `body`, `idempotencyKey`) |
| POST | `/api/feedback/<threadId>/replies` | reply |
| PATCH | `/api/feedback/<threadId>` | status transition (`expectedVersion` CAS) |
| GET | `/api/feedback/export?artifact=<id>&format=json\|md` | export for agents |
| GET | `/api/revisions?artifact=<id>` or `?project=&file=` | version history |
| POST/GET/DELETE | `/api/feedback/grants[/<grantId>]` | owner grant management |
| GET | `/r/<token>` | redeem review grant → HttpOnly cookie → viewer |

Auth headers: `X-Feedback-Admin: <FEEDBACK_ADMIN_TOKEN>` (owner CLI), or the review cookie; for
protected/ghost artifacts the project/ghost cookie is still required (a grant never bypasses it).
`Origin` must be same-origin for mutations; bodies are JSON.

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

Anchor rules: `exact` is stored verbatim; `prefix`/`suffix` keep boundary whitespace (it is
meaningful for duplicate disambiguation); offsets are hints only. Client resolves a quote by
exact occurrences → prefix/suffix context; ambiguity = `unanchored` (never wrong passage).

## Status transitions

`open → addressed` (owner only, must carry a registered fixing revision) → `resolved` (owner or
reviewer); `resolved → open` (reopen). Resolve uses the recorded `addressedRevisionId`; a caller
cannot retarget it. `expectedVersion` mismatch → `409 version_conflict` with the current thread.

How to mark a comment addressed/resolved:

1. Fix the artifact and publish it (`./deliver.sh ...`) — note the printed `?rev=<revisionId>` (or
   `pnpm run revisions:status --project <p> --file <f>`).
2. Owner marks addressed (CLI; the admin token is never exposed to the browser):
   `pnpm run feedback -- addressed --thread <threadId> --revision <revisionId>`
3. The reviewer opens the artifact with the review link, opens Feedback, and clicks **Resolve**
   (or **Reopen** on a resolved thread). Project-cookie sessions are read-only by design; only the
   admin token can mark addressed, because share links reuse the same project cookie.

## CLI env

- `ARTIFACTS_SITE_URL` (default production URL)
- `FEEDBACK_ADMIN_TOKEN` — owner read + `addressed`/grants; in this repo read from `.dev.vars`
- `ARTIFACTS_COOKIE` — browser cookie string, e.g. `cf_review_<artifactId16>=gr_…` or `cf_auth_<p>=…`

Reviewer-cookie example:

```bash
TOKEN="$(node -e 'console.log(process.argv[1].split("/r/")[1])' "$REVIEW_URL")"
curl -s -c /tmp/review.cookies -o /dev/null "https://artifacts.hoangtrung.dev/r/$TOKEN"
COOKIE=$(awk '$6 ~ /^cf_review_/ {print $6"="$7}' /tmp/review.cookies)
ARTIFACTS_COOKIE="$COOKIE" pnpm run feedback -- list --artifact <id> --format json
```

## Version management

```
content/<project>/<file>                          mutable current bytes
revisions/<artifactId>/<revisionId>/source.<ext>  immutable snapshot
meta/revisions/<artifactId>.json                  manifest: revisions[], latest, generation, tombstone
meta/catalog.json                                 index (artifactId/latestRevisionId/...)
```

`revisionId = sha256(bytes)`. Publish order: snapshot → manifest (conditional R2 write) → content →
catalog; identical republish is a no-op. `?rev=` serves the snapshot for raw HTML/MD and the viewer;
default viewer pins the iframe to the latest revision while the address bar stays canonical.
Unpublish writes a tombstone manifest first, then deletes bytes; `deliver.sh` is the only way to
revive a tombstoned path.

Commands:

```bash
pnpm run revisions:status --project <p> --file <f>
pnpm run revisions:bootstrap            # dry-run (all artifacts)
pnpm run revisions:bootstrap -- --apply # write snapshots/manifests/catalog fields
```

## Local setup (reproducible)

```bash
pnpm run build
# 1) seed local R2 with content + manifests + catalog (wrangler --local --persist-to DIR)
# 2) start Pages dev with local D1:
npx wrangler pages dev dist --port 8788 --persist-to DIR --d1=FEEDBACK_DB \
  --binding FEEDBACK_ADMIN_TOKEN=demo-admin-token
# 3) apply migrations to the local D1 sqlite (migrations/0001_feedback.sql), then
#    POST /api/feedback/grants with the admin header to mint review links.
```

## Production notes

- D1 binding `FEEDBACK_DB` lives in `wrangler.jsonc`; migration `migrations/0001_feedback.sql`.
- `FEEDBACK_ADMIN_TOKEN` is a Pages secret; keep it out of git and never put it in a URL/browser.
- After a schema or shell change: `./deploy.sh` (runs typecheck/test/build, then Pages deploy).
- Pre-production check: run `deliver.sh` / `unpublish.sh` / `revisions:bootstrap --apply` once
  against a scratch R2 project with real credentials (conditional-write REST path).
