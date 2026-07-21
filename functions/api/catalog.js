// GET /api/catalog — public project list + optional per-project file list.
//
// Public (no query): list projects.
//   - Ghost projects omitted unless valid cf_ghost cookie.
//   - Protected projects: name + lock badge only (no file titles/count).
//   - Public projects: name + file count.
//
// ?project=X : full file list for that project.
//   - Ghost → require cf_ghost; Protected → require cf_auth_X. Fail-closed 401/403.

import {
  loadCatalog,
  loadRegistry,
  listProjectFiles,
} from '../_store.js';
import {
  pwKey,
  cookieName,
  verifyToken,
  readCookie,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
} from '../_auth.js';

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const projectQ = String(url.searchParams.get('project') || '').trim();

  const catalog = await loadCatalog(env);
  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);

  const ghostToken = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
  const hasGhost =
    !!env.COOKIE_SECRET &&
    !!env.GHOST_MASTER_PW &&
    (await verifyToken(env.COOKIE_SECRET, ghostToken, GHOST_PROJECT));

  if (projectQ) {
    return projectDetail(request, env, catalog, projectQ, protectedFolders, ghostFolders, hasGhost);
  }

  // Public gallery list
  const projects = [];
  for (const name of Object.keys(catalog.projects || {}).sort()) {
    const isGhost = ghostFolders.has(name);
    if (isGhost && !hasGhost) continue;
    const isProtected = protectedFolders.has(name) || !!env[pwKey(name)];
    const files = listProjectFiles(catalog, name);
    projects.push({
      name,
      protected: isProtected,
      ghost: isGhost,
      // Never leak file count for protected projects on the public list.
      count: isProtected ? null : files.length,
    });
  }

  // Also surface protected/ghost names that have no catalog entries yet (empty projects).
  for (const name of protectedFolders) {
    if (projects.some((p) => p.name === name)) continue;
    if (ghostFolders.has(name) && !hasGhost) continue;
    projects.push({
      name,
      protected: true,
      ghost: ghostFolders.has(name),
      count: null,
    });
  }
  for (const name of ghostFolders) {
    if (!hasGhost) continue;
    if (projects.some((p) => p.name === name)) continue;
    projects.push({
      name,
      protected: protectedFolders.has(name) || !!env[pwKey(name)],
      ghost: true,
      count: null,
    });
  }

  projects.sort((a, b) =>
    a.protected === b.protected ? a.name.localeCompare(b.name) : a.protected ? 1 : -1,
  );

  return json({ projects });
};

async function projectDetail(request, env, catalog, project, protectedFolders, ghostFolders, hasGhost) {
  const isGhost = ghostFolders.has(project);
  if (isGhost) {
    if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) {
      return json({ error: 'Ghost not configured.' }, 403);
    }
    if (!hasGhost) return json({ error: 'Ghost access required.' }, 401);
  }

  const expected = env[pwKey(project)];
  const isProtected = protectedFolders.has(project) || !!expected;
  if (isProtected) {
    if (!expected || !env.COOKIE_SECRET) {
      return json({ error: 'Project not fully configured.' }, 403);
    }
    const token = readCookie(request.headers.get('Cookie'), cookieName(project));
    if (!(await verifyToken(env.COOKIE_SECRET, token, project))) {
      return json({ error: 'Authentication required.' }, 401);
    }
  }

  const files = listProjectFiles(catalog, project);
  return json({
    project,
    protected: isProtected,
    ghost: isGhost,
    files,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
