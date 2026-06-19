// GET /logout?project=<project>[&next=<path>] — clear the project's auth cookie and redirect.
//
// Expires cf_auth_<SNAKE(project)> (Max-Age=0, same attributes used to set it so the browser
// matches and drops it), then 302 to a sanitized same-origin target (default the home page).

import { cookieName, safeNext } from './_auth.js';

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const project = String(url.searchParams.get('project') || '').trim();
  const dest = new URL(safeNext(url.searchParams.get('next') || '', '/'), url).href;

  const headers = { Location: dest, 'Cache-Control': 'no-store' };
  if (project) {
    headers['Set-Cookie'] =
      `${cookieName(project)}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }
  return new Response(null, { status: 302, headers });
};
