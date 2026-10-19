// Shared HTTP response helpers for Pages Functions.
//
// Leading underscore = not routed. These helpers keep security + cache headers consistent
// across handlers. Note that public/_headers only applies to STATIC assets, so Functions must
// set their own headers here.

const NOSNIFF = { 'x-content-type-options': 'nosniff' };
const REFERRER = { 'referrer-policy': 'strict-origin-when-cross-origin' };

/** Headers for shell pages rendered by Functions (listings, viewers, login helpers). */
export function shellSecurity() {
  return {
    ...NOSNIFF,
    ...REFERRER,
    'content-security-policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
  };
}

/** Headers for raw artifact bytes. frame-ancestors lets our own viewer iframe embed them. */
export function artifactSecurity() {
  return {
    ...NOSNIFF,
    ...REFERRER,
    'content-security-policy': "frame-ancestors 'self'",
  };
}

/**
 * Cache-Control for a content response. Password-protected and ghost content must never be
 * stored by shared/proxy caches; public content may be cached briefly at the edge.
 * @param {boolean} privateContent
 * @param {number} [maxAge]
 */
export function cacheControl(privateContent, maxAge = 60) {
  return privateContent ? 'private, no-store' : `public, max-age=${maxAge}`;
}

/**
 * @param {Request} request
 * @param {string | null | undefined} etag
 */
export function isNotModified(request, etag) {
  if (!request || !etag) return false;
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  const stripWeak = (value) => value.trim().replace(/^W\//, '');
  const candidate = stripWeak(etag);
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || stripWeak(value) === candidate);
}

/**
 * @param {string} html
 * @param {{ method?: string, cache?: string, etag?: string | null, security?: Record<string,string>, extra?: Record<string,string> }} [options]
 */
export function htmlResponse(html, options = {}) {
  const { method = 'GET', cache = 'public, max-age=60', etag = null, security = shellSecurity(), extra = {} } = options;
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': cache, ...security, ...extra });
  if (etag) headers.set('etag', etag);
  return new Response(method === 'HEAD' ? null : html, { status: 200, headers });
}

/**
 * @param {string} body
 * @param {number} [status]
 * @param {{ cache?: string, security?: Record<string,string> }} [options]
 */
export function textResponse(body, status = 200, options = {}) {
  const { cache = 'no-store', security = artifactSecurity() } = options;
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache, ...security },
  });
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string,string>} [extra]
 */
export function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...NOSNIFF,
      ...extra,
    },
  });
}

/**
 * @param {string} location
 * @param {number} [status]
 * @param {Record<string,string>} [extra]
 */
export function redirectResponse(location, status = 302, extra = {}) {
  return new Response(null, {
    status,
    headers: { Location: location, 'cache-control': 'no-store', ...NOSNIFF, ...extra },
  });
}
