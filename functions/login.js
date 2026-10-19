// POST /login — verify a project password and issue a signed auth cookie.
//
// Only onRequestPost is exported, so GET /login falls through to the static Astro login page
// (dist/login/index.html) per Pages routing (method-specific handlers; unmatched verb -> static
// asset). The static page reads project/next/error from the query string client-side and posts
// the form back here.
//
// Body (application/x-www-form-urlencoded): password, project, next.
// Success: Set-Cookie cf_auth_<SNAKE(project)>=<signed token>; HttpOnly; Secure; SameSite=Lax;
//          Path=/; Max-Age=180d  -> 302 to the sanitized next (or /<project>/).
// Failure: 302 back to /login?error=1&project=<project>&next=<next> (no cookie set).

import {
  pwKey,
  cookieName,
  signToken,
  passwordMatches,
  safeNext,
  pwVersion,
  authCookie,
  TOKEN_TTL_SECONDS,
} from './_auth.js';
import { redirectResponse } from './_http.js';

function backToLogin(url, project, next, extra = {}) {
  const u = new URL('/login', url);
  if (project) u.searchParams.set('project', project);
  if (next) u.searchParams.set('next', next);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return redirectResponse(u.href, 302);
}

export const onRequestPost = async ({ request, env }) => {
  const url = new URL(request.url);

  let form;
  try {
    form = await request.formData();
  } catch {
    return backToLogin(url, '', '', { error: '1' });
  }

  const project = String(form.get('project') || '').trim();
  const password = String(form.get('password') || '').slice(0, 4096);
  const next = safeNext(String(form.get('next') || ''), project ? `/${project}/` : '/');

  // No project, or no signing key configured -> cannot authenticate. Fail-closed.
  if (!project || !env.COOKIE_SECRET) {
    return backToLogin(url, project, form.get('next') || '', { error: '1' });
  }

  const expected = env[pwKey(project)];
  // A missing PW_<project> secret can never authenticate (fail-closed); otherwise compare the
  // submitted password against a hash of both values (constant-time, length-independent).
  // Protection status is already public (gallery lock badge), so the short-circuit leaks
  // nothing a visitor cannot already observe.
  const ok = await passwordMatches(env.COOKIE_SECRET, password, expected);
  if (!ok) {
    return backToLogin(url, project, form.get('next') || '', { error: '1' });
  }

  const version = await pwVersion(env.COOKIE_SECRET, expected);
  const token = await signToken(env.COOKIE_SECRET, project, TOKEN_TTL_SECONDS, version);
  const dest = new URL(next, url).href; // next is already same-origin-sanitized
  return redirectResponse(dest, 302, {
    'set-cookie': authCookie(cookieName(project), token, TOKEN_TTL_SECONDS),
  });
};
