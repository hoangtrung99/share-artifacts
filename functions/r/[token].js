// GET /r/<token> — redeem a review grant into an artifact-scoped HttpOnly cookie.
//
// The grant token is single-purpose URL material: it is validated (sha256 hash lookup in D1,
// expiry + revocation checked), turned into a cookie scoped to ONE artifact, and immediately
// removed from the browser history via a 302 to the artifact URL. The token never appears in the
// artifact URL, JS-readable storage, or a request header.
//
// Cookie: cf_review_<artifactId.slice(0,16)> — HttpOnly; Secure; SameSite=Strict; Path=/
//         Max-Age capped at the grant's remaining TTL (every API request re-checks the DB row, so
//         revocation/expiry wins immediately even if the cookie is still present).
//
// Fail-safe: no FEEDBACK_DB → 503 plain text; unknown/expired/revoked token → 404 (generic).

import { hasFeedbackDb, findGrantByToken } from '../_feedback-db.js';
import { reviewGrantCookie } from '../_feedback.js';

const TOKEN_RE = /^gr_[0-9a-f]{32}\.[0-9a-f]{64}$/;

const plainHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function plain(body, status) {
  return new Response(body, { status, headers: plainHeaders });
}

export const onRequest = async ({ request, env, params }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', { status: 405, headers: { ...plainHeaders, allow: 'GET' } });
  }
  try {
    if (!hasFeedbackDb(env)) return plain('Review feedback is not configured on this deployment.', 503);

    const raw = params?.token;
    const token = Array.isArray(raw) ? raw.join('/') : raw == null ? '' : String(raw);
    if (!TOKEN_RE.test(token)) return plain('Review link not found.', 404);

    const grant = await findGrantByToken(env, token);
    if (!grant) return plain('Review link not found or expired.', 404);

    const expiresMs = Date.parse(grant.expires_at);
    const maxAge = Number.isFinite(expiresMs)
      ? Math.max(1, Math.floor((expiresMs - Date.now()) / 1000))
      : 60;
    // Land on the extensionless viewer route (never the raw object). project/file were validated
    // when the grant was created; encode per segment defensively.
    const viewerFile = String(grant.file).replace(/\.(html|md)$/i, '');
    const filePath = viewerFile.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const location = `/${encodeURIComponent(grant.project)}/${filePath}`;

    return new Response(null, {
      status: 302,
      headers: {
        location,
        'set-cookie': reviewGrantCookie(grant.artifact_id, token, maxAge),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[review-redeem] failure:', error && error.message ? error.message : error);
    return plain('Review link could not be redeemed.', 500);
  }
};
