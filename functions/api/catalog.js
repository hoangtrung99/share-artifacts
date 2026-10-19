// GET /api/catalog — public project list + optional per-project file list.
//
// Public (no query): list projects.
//   - Ghost projects omitted unless valid cf_ghost cookie.
//   - Protected projects: name + lock badge only (no file titles/count).
//   - Public projects: name + file count.
//
// ?project=X : full file list for that project (recent upload times included).
//   - Ghost → require cf_ghost; Protected → require cf_auth_X. Fail-closed 401/403.

import {
  categoryLabel,
  categoryMode,
  categorySummary,
  entryCategories,
  loadCatalog,
  loadRegistry,
  loadUploadTimes,
  listProjectFiles,
  resolveArtifactTime,
} from '../_store.js';
import {
  pwKey,
  cookieName,
  verifyToken,
  readCookie,
  pwVersion,
  GHOST_COOKIE_NAME,
  GHOST_PROJECT,
} from '../_auth.js';
import { jsonResponse } from '../_http.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    return await handle(request, env);
  } catch (error) {
    console.error('[catalog] unhandled error:', error.message);
    return jsonResponse({ error: 'Catalog is temporarily unavailable.' }, 503);
  }
};

async function handle(request, env) {
  const url = new URL(request.url);
  const projectQ = String(url.searchParams.get('project') || '').trim();

  const catalog = await loadCatalog(env);
  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);

  const hasGhost = await hasGhostAccess(request, env);

  if (projectQ) {
    return projectDetail(request, env, catalog, projectQ, protectedFolders, ghostFolders, hasGhost);
  }

  // Public gallery list + a small "recently added" feed for the home index.
  const projects = [];
  const recent = [];

  const describe = (name, files, { protected: isProtected, ghost: isGhost }) => {
    if (isProtected) {
      // Never leak file counts, titles, timestamps or categories for protected projects.
      return { name, protected: true, ghost: isGhost, count: null, updatedAt: null, categories: [] };
    }
    const times = files
      .map((file) => resolveArtifactTime(file).sortDate)
      .filter(Boolean)
      .sort();
    const updatedAt = times.length ? times[times.length - 1] : null;
    const categories = categorySummary(files).map((category) => category.slug);
    return { name, protected: false, ghost: isGhost, count: files.length, updatedAt, categories };
  };

  const addRecent = (projectName, files) => {
    // Recent rows follow the same category model as the project listing (folder vs keywords).
    const mode = categoryMode(files);
    for (const file of files) {
      const time = resolveArtifactTime(file);
      if (!time.sortDate) continue;
      const category = entryCategories(file, mode)[0];
      recent.push({
        sortDate: time.sortDate,
        item: {
          project: projectName,
          title: file.title || file.routePath,
          routePath: file.routePath,
          type: file.type,
          date: time.displayDate || time.sortDate.slice(0, 10),
          category: categoryLabel(category),
          description: file.description || '',
        },
      });
    }
  };

  for (const name of Object.keys(catalog.projects || {}).sort()) {
    const isGhost = ghostFolders.has(name);
    if (isGhost && !hasGhost) continue;
    const isProtected = protectedFolders.has(name) || !!env[pwKey(name)];
    const files = Array.isArray(catalog.projects[name]?.files) ? catalog.projects[name].files : [];
    projects.push(describe(name, files, { protected: isProtected, ghost: isGhost }));
    if (!isProtected) addRecent(name, files);
  }

  // Also surface protected/ghost names that have no catalog entries yet (empty projects).
  for (const name of protectedFolders) {
    if (projects.some((p) => p.name === name)) continue;
    if (ghostFolders.has(name) && !hasGhost) continue;
    projects.push({ name, protected: true, ghost: ghostFolders.has(name), count: null, updatedAt: null, categories: [] });
  }
  for (const name of ghostFolders) {
    if (!hasGhost) continue;
    if (projects.some((p) => p.name === name)) continue;
    const isProtected = protectedFolders.has(name) || !!env[pwKey(name)];
    const files = Array.isArray(catalog.projects?.[name]?.files) ? catalog.projects[name].files : [];
    projects.push(describe(name, files, { protected: isProtected, ghost: true }));
    if (!isProtected) addRecent(name, files);
  }

  projects.sort((a, b) =>
    a.protected === b.protected ? a.name.localeCompare(b.name) : a.protected ? 1 : -1,
  );

  recent.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.item.title.localeCompare(b.item.title));
  return jsonResponse({ projects, recent: recent.slice(0, 6).map((entry) => entry.item) });
}

async function hasGhostAccess(request, env) {
  if (!env.COOKIE_SECRET || !env.GHOST_MASTER_PW) return false;
  const version = await pwVersion(env.COOKIE_SECRET, env.GHOST_MASTER_PW);
  const token = readCookie(request.headers.get('Cookie'), GHOST_COOKIE_NAME);
  return verifyToken(env.COOKIE_SECRET, token, GHOST_PROJECT, version);
}

async function projectDetail(request, env, catalog, project, protectedFolders, ghostFolders, hasGhost) {
  const isGhost = ghostFolders.has(project);
  if (isGhost) {
    if (!env.GHOST_MASTER_PW || !env.COOKIE_SECRET) {
      return jsonResponse({ error: 'Ghost not configured.' }, 403);
    }
    if (!hasGhost) return jsonResponse({ error: 'Ghost access required.' }, 401);
  }

  const expected = env[pwKey(project)];
  const isProtected = protectedFolders.has(project) || !!expected;
  if (isProtected) {
    if (!expected || !env.COOKIE_SECRET) {
      return jsonResponse({ error: 'Project not fully configured.' }, 403);
    }
    const version = await pwVersion(env.COOKIE_SECRET, expected);
    const token = readCookie(request.headers.get('Cookie'), cookieName(project));
    if (!(await verifyToken(env.COOKIE_SECRET, token, project, version))) {
      return jsonResponse({ error: 'Authentication required.' }, 401);
    }
  }

  const uploads = await loadUploadTimes(env, project);
  const files = listProjectFiles(catalog, project, uploads);
  return jsonResponse({
    project,
    protected: isProtected,
    ghost: isGhost,
    files,
  });
}
