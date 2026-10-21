// Shared read/write gate for feedback routes.
//
// /api/* bypasses _middleware.js, so every feedback/revisions route resolves access itself:
//   1. FEEDBACK_ADMIN_TOKEN (site owner): read + write + mark addressed + manage grants. A project
//      or share cookie is NOT owner proof (share redemption issues the same cookie).
//   2. Valid artifact-scoped review grant cookie (set by GET /r/<token>): read + comment/reply/
//      resolve/reopen. Every request re-hashes the cookie and re-checks expiry/revocation in D1.
//   3. Project/ghost cookie: read only (including export/counts/history).
//   4. Otherwise: public artifacts are NOT public discussion — read requires a grant or admin.
//
// Malformed protected/ghost registries and unreadable revision manifests fail closed (503), never
// "look public".

import {
  ApiError,
  accessCapabilities,
  adminAuthorized,
  readReviewGrantToken,
  requireGrantMode,
  resolveProjectAccess,
} from './_feedback.js';
import { hasFeedbackDb, verifyGrant } from './_feedback-db.js';

/**
 * @param {object} env
 * @param {Request} request
 * @param {object} artifact resolved artifact identity
 * @param {{ write?: boolean }} [options]
 * @returns {Promise<{ access: object, grant: object|null, admin: boolean }>}
 */
export async function resolveFeedbackAccess(env, request, artifact, { write = false } = {}) {
  const legacyGrantRequired = requireGrantMode(env);
  const admin = await adminAuthorized(env, request);
  let authenticated = false;
  let accessFailure = null;

  if (!admin) {
    const projectAccess = await resolveProjectAccess(env, request, artifact.project);
    if (projectAccess.ok) authenticated = Boolean(projectAccess.authenticated);
    else accessFailure = projectAccess;
  }

  // A protected/ghost gate failure fails closed BEFORE any grant capability is applied: a review
  // grant only adds write permission on top of a valid read session, it never bypasses the project
  // password or ghost master password. (The site-owner admin token may bypass; handled above.)
  if (accessFailure) {
    throw new ApiError(accessFailure.status, accessFailure.code, accessFailure.message);
  }

  let grant = null;
  let reviewer = false;
  const token = readReviewGrantToken(request, artifact.artifactId);
  if (token) {
    if (!hasFeedbackDb(env)) {
      // A stale artifact cookie with the feature unbound must be a clean 503, never a binding crash.
      throw new ApiError(503, 'feedback_not_configured', 'Review feedback is not configured on this deployment.');
    }
    grant = await verifyGrant(env, token, artifact.artifactId);
    reviewer = Boolean(grant);
  }

  // Open policy (default): passing the project/ghost gate is enough for read AND write. Legacy
  // policy (FEEDBACK_REQUIRE_GRANT=1|true): only admin or a valid grant may write; project/ghost
  // sessions are read-only; anonymous public viewers have no access at all.
  const open = !legacyGrantRequired;
  const access = accessCapabilities({ admin, reviewer, authenticated, open });
  access.open = open;

  if (write) {
    if (!access.canWrite) {
      throw new ApiError(
        403,
        'forbidden',
        legacyGrantRequired
          ? 'Writing review feedback requires the site owner or a review-grant link for this artifact.'
          : 'Writing review feedback requires access to this artifact.',
      );
    }
    return { access, grant, admin };
  }

  if (!(admin || authenticated || reviewer || open)) {
    throw new ApiError(403, 'forbidden', 'Review access requires a review-grant link for this artifact.');
  }
  return { access, grant, admin };
}
