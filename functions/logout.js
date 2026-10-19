// GET /logout?project=<project>[&next=<path>] — clear the project's auth cookie and redirect.
// GET /logout?ghost=1[&next=<path>] — clear the ghost mode cookie (cf_ghost).
//
// Expires cf_auth_<SNAKE(project)> and/or cf_ghost (Max-Age=0, same attributes used to set them
// so the browser matches and drops them), then 302 to a sanitized same-origin target
// (default the home page). Both cookies can be cleared in one request.

import { cookieName, safeNext, clearAuthCookie, GHOST_COOKIE_NAME } from './_auth.js';

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const project = String(url.searchParams.get('project') || '').trim();
  const ghost = url.searchParams.get('ghost') === '1';
  const dest = new URL(safeNext(url.searchParams.get('next') || '', '/'), url).href;

  const headers = new Headers({
    Location: dest,
    'Cache-Control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (project) headers.append('Set-Cookie', clearAuthCookie(cookieName(project)));
  if (ghost) headers.append('Set-Cookie', clearAuthCookie(GHOST_COOKIE_NAME));
  return new Response(null, { status: 302, headers });
};
