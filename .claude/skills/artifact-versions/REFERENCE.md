# artifact-versions — reference

## R2 layout

```text
content/<project>/<file>                           mutable current bytes (compat / legacy)
revisions/<artifactId>/<revisionId>/source.<ext>   immutable snapshot (html/md)
meta/revisions/<artifactId>.json                   manifest: revisions[], latest, generation, tombstone
meta/catalog.json                                  discovery index + artifactId/latestRevisionId/...
```

- `artifactId = sha256("artifact-v1\0" + project + "\0" + file).slice(0,32)` — stable per path.
- `revisionId = sha256(content bytes)` — content-addressed, immutable.
- Manifest `generation` increments on publish; every revision carries a `publicationId`; identical
  republish does not bump either.
- `tombstone: true` marks an unpublished path; serving, `?rev=`, revisions API, feedback and exports
  all 404 before any 304/cache path. Tombstones are kept; a deliberate `deliver.sh` is the only
  revival path.

## Publish pipeline (`deliver.sh`)

1. hash the local file bytes (never re-read after hashing).
2. read the manifest; if missing, snapshot the previous `content/` object as revision 1 (bootstrap).
3. upload the snapshot (idempotent by revisionId; existing snapshot bytes are verified).
4. commit the manifest with a conditional R2 write when `CLOUDFLARE_API_TOKEN` is set
   (`If-Match` ETag / `If-None-Match: *`). Otherwise CLI write + read-back verification, single
   writer only.
5. overwrite mutable `content/`, then upsert catalog fields (`artifactId`, `latestRevisionId`,
   `latestRevisionNumber`, `revisionCount`).
6. print viewer/raw and `?rev=` URLs.

Commands:

```bash
pnpm run revisions:status --project <p> --file <f>
pnpm run revisions:bootstrap              # dry-run
pnpm run revisions:bootstrap -- --apply   # first rollout for existing artifacts
```

## Version serving

| URL | Behaviour |
|---|---|
| `/<project>/<file>` (viewer) | pinned to latest revision when a manifest exists; canonical address bar |
| `/<project>/<file>.html\|.md` (raw) | latest snapshot, or `?rev=<revisionId>` for a pinned one |
| `?rev=<64 hex>` | immutable snapshot; unknown/foreign rev → 404 (never silent latest) |
| tombstoned path | 404 before cache/304 |

Cache: public snapshot bytes `max-age=300`, protected/ghost `private, no-store`; ETag is
`"r-<revisionId>"`. The viewer/reader bar has a History button; old revisions render read-only with a
"Viewing revision N of M — latest is vM" banner and Back to latest.

## `/api/revisions` (metadata only)

`GET /api/revisions?artifact=<id>` or `?project=<p>&file=<f>` → artifact identity, `revisions[]`
(`revisionId`, `number`, `size`, `createdAt`, `createdBy`, `publicationId`, `isLatest`), `latest`,
`total`, `current`. Public artifacts are readable anonymously; protected/ghost need the project/ghost
cookie; tombstones/unknown artifacts 404. No feedback fields are returned.

## Reverting / comparing

- Compare: open `?rev=<old>` for each revision; the banner distinguishes historical views.
- Revert content: re-deliver the old file as a **new** revision (append-only; revisions are never
  rewritten). Consumers should reference the new latest or pin a specific revision.
- Do not delete/overwrite manifests or snapshots by hand; use `unpublish.sh` for removal.

## Unpublish

```bash
./unpublish.sh <project> <file.html|md>   # tombstone → content delete → snapshot cleanup
```

Project-wide removal aborts before deleting anything if any tombstone write fails; tombstones stay.
Rerun after fixing credentials/lock issues.

## Failure modes / ops notes

| Symptom | Meaning / fix |
|---|---|
| `deliver.sh` warns conditional writes unavailable | no `CLOUDFLARE_API_TOKEN`; CLI fallback is single-writer, ensure one publisher |
| just-published `?rev=` 404 for ~15s | in-isolate manifest cache; retry or pin after a moment |
| old revision still served after unpublish | tombstone not written / callers cached ≤300s; check manifest first |
| manifest write conflict | another publish raced; re-run (script re-reads generation) |

Before relying on production: run `deliver.sh`, `unpublish.sh` and `revisions:bootstrap --apply` once
against a scratch R2 project with real credentials (the conditional-write REST path is not
exercisable without them).

## Local development

`wrangler pages dev` with local R2 + D1 (`--persist-to DIR`, `--d1=FEEDBACK_DB`). Seed local objects
with `wrangler r2 object put … --local --persist-to DIR`; manifests/catalog can be seeded directly in
tests. `pnpm test` covers revision registration, pinning fallbacks, manifest guards and tombstone
behaviour.
