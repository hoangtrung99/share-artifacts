// GET /api/revisions — version history for one artifact.
//
// Query: ?artifact=<artifactId> or ?project=<p>&file=<f> (both forms accepted; cross-checked).
// Auth: feedback read gate (_feedback-access.js) — site owner (FEEDBACK_ADMIN_TOKEN), a valid
// review-grant cookie, or a project/ghost cookie for protected/ghost projects. Version history for
// a public artifact is not public discussion data: it needs the same review access as the threads.
//
// Unpublished artifacts (tombstoned manifest) return 404. Legacy artifacts published before
// revisioning return an empty history plus `current` (hash of the mutable content bytes) so the UI
// can explain that version history starts with the next publish; feedback writes stay rejected.

import { ApiError, errorResponse, json, resolveArtifact } from '../_feedback.js';
import { resolveFeedbackAccess } from '../_feedback-access.js';
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

    await resolveFeedbackAccess(env, request, artifact);

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
