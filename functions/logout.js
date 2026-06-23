// GET /logout?project=<project>[&next=<path>] — clear the project's auth cookie and redirect.
// GET /logout?ghost=1[&next=<path>] — clear the ghost mode cookie (cf_ghost).
//
// Expires cf_auth_<SNAKE(project)> (Max-Age=0, same attributes used to set it so the browser
// matches and drops it), then 302 to a sanitized same-origin target (default the home page).

import { cookieName, safeNext, GHOST_COOKIE_NAME } from './_auth.js';

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const project = String(url.searchParams.get('project') || '').trim();
  const ghost = url.searchParams.get('ghost') === '1';
  const dest = new URL(safeNext(url.searchParams.get('next') || '', '/'), url).href;

  const headers = { Location: dest, 'Cache-Control': 'no-store' };
  if (project) {
    headers['Set-Cookie'] =
      `${cookieName(project)}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }
  if (ghost) {
    headers['Set-Cookie'] = `${GHOST_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }
  return new Response(null, { status: 302, headers });
};
