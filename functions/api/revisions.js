// GET /api/revisions — version history for one artifact.
//
// Query: ?artifact=<artifactId> or ?project=<p>&file=<f> (both forms accepted; cross-checked).
// Auth: version metadata is public for public artifacts (old snapshots are already public through
// `?rev=` on public content), so anonymous viewers can browse history. Protected/ghost projects
// still require their project/ghost cookie (fail-closed registries), and the site-owner admin token
// is accepted. This exposes ONLY revision metadata (ids/numbers/sizes/dates/createdBy/isLatest) —
// review threads, counts and exports remain behind the /api/feedback gate.
//
// Unpublished artifacts (tombstoned manifest) return 404. Legacy artifacts published before
// revisioning return an empty history plus `current` (hash of the mutable content bytes) so the UI
// can explain that version history starts with the next publish; feedback writes stay rejected.

import {
  ApiError,
  adminAuthorized,
  errorResponse,
  json,
  resolveArtifact,
  resolveProjectAccess,
} from '../_feedback.js';
import { jsonResponse } from '../_http.js';
import { currentContentRevision } from '../_feedback-revisions.js';

/** @param {object} artifact */
function artifactJson(artifact) {
  return {
    artifactId: artifact.artifactId,
    project: artifact.project,
    file: artifact.file,
    routePath: artifact.routePath,
    type: artifact.type,
    revisioningEnabled: Boolean(artifact.registry),
  };
}

export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed.', code: 'method_not_allowed' }, 405, { allow: 'GET' });
  }
  try {
    const artifact = await resolveArtifact(env, {
      artifactId: url.searchParams.get('artifact'),
      project: url.searchParams.get('project'),
      file: url.searchParams.get('file'),
    });
    if (!artifact) throw new ApiError(404, 'artifact_unknown', 'Unknown or unpublished artifact.');

    // Revision metadata has no discussion data: public artifacts are readable anonymously, while
    // protected/ghost projects keep exactly the project/ghost gate the content route uses.
    if (!(await adminAuthorized(env, request))) {
      const access = await resolveProjectAccess(env, request, artifact.project);
      if (!access.ok) throw new ApiError(access.status, access.code, access.message);
    }

    const registry = artifact.registry;
    const revisions = registry
      ? registry.revisions.map((revision) => ({
          revisionId: revision.revisionId,
          number: revision.number,
          size: revision.size,
          createdAt: revision.createdAt,
          createdBy: revision.createdBy,
          publicationId: revision.publicationId,
          isLatest: revision.revisionId === registry.latestRevisionId,
        }))
      : [];
    const latest = registry && registry.latestRevisionId
      ? { revisionId: registry.latestRevisionId, number: registry.latestRevisionNumber }
      : null;

    let current = null;
    if (latest) {
      current = { revisionId: latest.revisionId, number: latest.number, source: 'registry' };
    } else {
      const legacy = await currentContentRevision(env, artifact.project, artifact.file);
      current = legacy ? { revisionId: legacy.revisionId, number: 1, source: 'content' } : null;
    }

    return json({
      schemaVersion: 1,
      artifactId: artifact.artifactId,
      artifact: artifactJson(artifact),
      revisions,
      latest,
      total: revisions.length,
      current,
    });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error('[revisions] unexpected failure:', error && error.message ? error.message : error);
    return jsonResponse({ error: 'Revision lookup failed.', code: 'internal_error' }, 500);
  }
};
