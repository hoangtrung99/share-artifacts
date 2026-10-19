---
name: artifact-versions
description: Publish and inspect immutable versions of artifacts.hoangtrung.dev artifacts. Use when asked to publish or republish an artifact, inspect or compare revision history / old versions (?rev=), bootstrap revisions for existing artifacts, explain a version link that 404s, or unpublish/tombstone an artifact.
---

# Artifact versions

Every publish is an immutable revision served from Cloudflare R2. [REFERENCE.md](REFERENCE.md) has
the R2 layout, manifest schema, commands and failure modes. Review threads are covered by the
sibling `artifact-feedback` skill.

## Mental model

- `revisionId = SHA-256(exact bytes)`. A publish stores an immutable snapshot
  `revisions/<artifactId>/<revisionId>/source.<ext>` and a per-artifact manifest
  `meta/revisions/<artifactId>.json` (revisions[], latest pointer, generation, publicationId,
  optional tombstone). The catalog is discovery metadata only.
- Publish order: snapshot → manifest (conditional R2 write when `CLOUDFLARE_API_TOKEN` is available)
  → mutable `content/` → catalog. Retrying identical bytes is a no-op (no new revision).
- The viewer **pins** the iframe/download/feedback to one revision; `?rev=<revisionId>` serves that
  snapshot (unknown → 404, never a silent fallback). The address-bar URL stays canonical, and an
  old-revision banner links back to latest.
- `unpublish.sh` writes a tombstone **first**, then deletes bytes; never delete manifests or
  snapshots manually. Only a deliberate re-publish revives a tombstoned path.

## Publish / republish

```bash
./deliver.sh ./report.html <project> --name <file>.html [--date YYYY-MM-DD] [--protect] [--ghost]
```

The script hashes the exact file bytes, registers the revision (lazily bootstrapping the previous
object as revision 1 when the artifact is legacy), uploads the snapshot, then overwrites
`content/` and upserts the catalog. Verify afterwards:

```bash
pnpm run revisions:status --project <project> --file <file.html>
curl -s "$ARTIFACTS_SITE_URL/api/revisions?project=<p>&file=<f>" | jq '.revisions'
```

The viewer/reader bar has a **History** button (plus More → Versions) that lists revisions and opens
old snapshots read-only. Version-history metadata is public for public artifacts; protected/ghost
history needs the project/ghost cookie.

## First rollout for existing artifacts

```bash
pnpm run revisions:bootstrap            # dry-run: list artifacts that would get revision 1
pnpm run revisions:bootstrap -- --apply # write snapshots, manifests and catalog fields
```

Run it once against a scratch R2 project with real credentials before relying on publish/unpublish
in production, and keep a single publisher when running without conditional-write credentials.

## Inspect old versions

- Current latest: `/<project>/<file>` (viewer) or `/<project>/<file>.html|.md` (raw).
- Pinned: append `?rev=<revisionId>` to the viewer, raw URL, iframe or download.
- To make older content current again, re-deliver that old file — this creates a **new** revision
  (history is append-only; revisions are never rewritten).

## Operational notes

- Conditional manifest writes need an explicit `CLOUDFLARE_API_TOKEN`; wrangler's OAuth token is not
  assumed to work for the R2 REST endpoint. Without it the CLI falls back to write + read-back
  verification and announces single-writer mode.
- Manifest reads are cached in-isolate for ~15s; a just-published revision can 404 briefly (retry).
- Snapshot responses are cache-capped (public 300s / protected no-store) so unpublish and password
  changes take effect; tombstoned paths 404 before any cache/304 path.
- Production deploy of shell changes: `./deploy.sh` from a clean tree (never deploy content/artifacts
  through git).
