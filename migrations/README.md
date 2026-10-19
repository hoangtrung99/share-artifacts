# D1 migrations — review feedback

The feedback feature uses a Cloudflare D1 database bound as `FEEDBACK_DB`. The binding is
**optional at runtime**: when it is missing, every `/api/feedback*` route returns
`503 feedback_not_configured` and the rest of the site (content, revisions, auth) keeps working.

This change does **not** create any database. The owner does the following once, when they want to
enable review comments in production:

```bash
# 1. Create the database (prints the database_id)
npx wrangler d1 create artifacts-feedback

# 2. Put the binding in wrangler.jsonc (it is committed commented-out):
#    "d1_databases": [
#      { "binding": "FEEDBACK_DB",
#        "database_name": "artifacts-feedback",
#        "database_id": "<database_id from step 1>" }
#    ]

# 3. Apply the schema (remote)
npx wrangler d1 migrations apply artifacts-feedback --remote

# 4. Optional: site-owner token for creating review grants on public artifacts
openssl rand -base64 32 | npx wrangler pages secret put FEEDBACK_ADMIN_TOKEN --project-name=artifacts
```

Local development:

```bash
# Local D1 is created on the spot (no production database involved):
npx wrangler pages dev dist --d1=FEEDBACK_DB --persist-to .wrangler/state
```

Unit tests do not need wrangler or D1: they execute `0001_feedback.sql` against `node:sqlite`
through a small D1-compatible shim (`test/feedback-sqlite-helper.mjs`), so the committed schema is
what gets tested.

## Migration policy

- Append-only, numbered files: `0002_<topic>.sql`. Never edit an applied migration.
- Every migration must be valid plain SQLite so the node:sqlite test shim can execute it verbatim.
- Threads/messages/events/grants are the feedback source of truth. Revisions and artifact identity
  live in R2 (`meta/revisions/<artifactId>.json`) because publishing runs from the CLI; D1 stores a
  reference (`artifact_id`, `revision_id`) only.
