// Catch-all content routes served from R2.
//
// URL contract (preserved):
//   /<project>/              → project listing (from catalog + R2 upload times)
//   /<project>/<file>        → viewer (HTML iframe or MD edge-render)
//   /<project>/<file>.html   → raw HTML from R2
//   /<project>/<file>.md     → raw Markdown from R2
//
// Cache/security headers are set here because public/_headers only applies to static assets.
// Password-protected and ghost content is never cacheable by shared caches; raw bytes support
// ETag revalidation (304) so repeat views do not re-download the artifact.
//
// Shell paths (login, assets, api, …) call next() so the thin Astro shell / other
// functions handle them. Auth is enforced by _middleware.js before this runs.

import {
  SHELL_SEGMENTS,
  loadCatalog,
  loadRegistry,
  loadUploadTimes,
  listProjectFiles,
  findByRoutePath,
  contentKey,
  getObject,
  safeDecode,
  resolveArtifactTime,
} from './_store.js';
import { renderMarkdownDoc } from './_markdown.js';
import { projectListingPage, htmlViewerPage, mdViewerPage, ASSET_V } from './_render.js';
import { pwKey } from './_auth.js';
import {
  artifactSecurity,
  cacheControl,
  htmlResponse,
  isNotModified,
  shellSecurity,
  textResponse,
} from './_http.js';

/** Small non-crypto hash — only used to derive ETags from a few strings. */
function hashString(value) {
  let h = 2166136261 >>> 0;
  const str = String(value);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

function notModifiedResponse(etag, cache, security) {
  return new Response(null, {
    status: 304,
    headers: { etag, 'cache-control': cache, ...security },
  });
}

/** R2 metadata timestamp as ISO string, or null. */
function uploadedIso(object) {
  if (!object || !object.uploaded) return null;
  const date = object.uploaded instanceof Date ? object.uploaded : new Date(object.uploaded);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Upload time for catalog entries that predate the uploadedAt field. */
async function headUploadedAt(env, project, file) {
  if (!env.ARTIFACTS?.head) return null;
  try {
    return uploadedIso(await env.ARTIFACTS.head(contentKey(project, file)));
  } catch {
    return null;
  }
}

export const onRequest = async (context) => {
  const { request, env, next, params } = context;

  // Only handle GET/HEAD for content.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return next();
  }

  const url = new URL(request.url);
  const rawPath = params.path;
  // [[path]] may be string or string[] depending on runtime; normalize.
  const pathStr = Array.isArray(rawPath) ? rawPath.join('/') : rawPath == null ? '' : String(rawPath);
  const segments = pathStr.split('/').filter(Boolean);

  if (segments.length === 0) return next(); // home → static index

  const first = safeDecode(segments[0]);
  if (SHELL_SEGMENTS.has(first) || first.startsWith('_')) return next();

  // Known static file extensions that are not artifact content
  const last = segments[segments.length - 1] || '';
  if (
    /\.(css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|txt|xml|json)$/i.test(last) &&
    !/\.(html|md)$/i.test(last)
  ) {
    return next();
  }

  if (!env.ARTIFACTS) {
    return textResponse('Content store not configured (R2 binding ARTIFACTS missing).', 503);
  }

  const project = first;
  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);
  const locked = protectedFolders.has(project) || !!env[pwKey(project)];
  const ghost = ghostFolders.has(project);

  // /project or /project/ → listing
  if (segments.length === 1) {
    const catalog = await loadCatalog(env);
    const uploads = await loadUploadTimes(env, project);
    const files = listProjectFiles(catalog, project, uploads);
    const knownProject = !!catalog.projects?.[project];
    // Unknown empty project with no catalog entry and not in registries → 404
    if (!files.length && !knownProject && !locked && !ghost) {
      return textResponse('Not found', 404);
    }
    const cache = cacheControl(locked || ghost, 60);
    // Include the newest effective time so a re-upload refreshes the listing even when the
    // catalog's updatedAt did not change (e.g. an object updated directly in R2).
    const latest = files.reduce((max, file) => (file.sortDate > max ? file.sortDate : max), '');
    const etag = `"l-${hashString(`${catalog.updatedAt || ''}|${project}|${files.length}|${latest}|${locked}|${ghost}|${ASSET_V}`)}"`;
    if (isNotModified(request, etag)) return notModifiedResponse(etag, cache, shellSecurity());

    const html =
      request.method === 'HEAD'
        ? ''
        : projectListingPage({ project, files, locked, ghost });
    return htmlResponse(html, { method: request.method, cache, etag });
  }

  const rest = segments.slice(1).map(safeDecode).join('/');
  const lower = rest.toLowerCase();

  // Raw HTML / Markdown bytes — no catalog read needed on this path.
  if (lower.endsWith('.html') || lower.endsWith('.md')) {
    const isMd = lower.endsWith('.md');
    const obj = await getObject(env.ARTIFACTS, contentKey(project, rest));
    if (!obj) return textResponse('Not found', 404);
    const cache = cacheControl(locked || ghost, 300);
    const etag = obj.httpEtag || null;
    if (isNotModified(request, etag)) return notModifiedResponse(etag, cache, artifactSecurity());

    const headers = new Headers();
    headers.set('content-type', isMd ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8');
    headers.set('cache-control', cache);
    for (const [key, value] of Object.entries(artifactSecurity())) headers.set(key, value);
    if (etag) headers.set('etag', etag);
    return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
  }

  // Extensionless viewer
  const routePath = `${project}/${rest}`;
  const catalog = await loadCatalog(env);
  let entry = findByRoutePath(catalog, routePath);

  // Catalog miss: probe R2 for .html then .md
  if (!entry) {
    for (const ext of ['html', 'md']) {
      const key = contentKey(project, `${rest}.${ext}`);
      const obj = await getObject(env.ARTIFACTS, key);
      if (obj) {
        entry = {
          type: ext === 'md' ? 'md' : 'html',
          title: rest.split('/').pop(),
          description: '',
          tags: [],
          date: null,
          sortDate: '',
          uploadedAt: uploadedIso(obj),
          file: `${rest}.${ext}`,
          routePath,
        };
        // Stash body for the MD path
        if (ext === 'md') entry._body = await obj.text();
        break;
      }
    }
  }

  if (!entry) return textResponse('Not found', 404);

  const type = entry.type === 'md' ? 'md' : 'html';
  const file = entry.file || `${rest}.${type === 'md' ? 'md' : 'html'}`;
  const rawUrl = `/${project}/${file}`;
  const downloadName = file.split('/').pop();
  const cache = cacheControl(locked || ghost, 60);

  if (type === 'html') {
    const uploadIso = entry.uploadedAt || (await headUploadedAt(env, project, file));
    const time = resolveArtifactTime(entry, uploadIso);
    const etag = `"v-${hashString(`${routePath}|${time.sortDate || ''}|${locked}|${ghost}|${ASSET_V}`)}"`;
    if (isNotModified(request, etag)) return notModifiedResponse(etag, cache, shellSecurity());
    const html =
      request.method === 'HEAD'
        ? ''
        : htmlViewerPage({
            title: entry.title || downloadName,
            description: entry.description || '',
            project,
            routePath,
            rawUrl,
            downloadName,
            time,
            locked,
            ghost,
          });
    return htmlResponse(html, { method: request.method, cache, etag });
  }

  // MD viewer — edge render
  let mdBody = entry._body;
  let uploadIso = entry.uploadedAt || null;
  if (mdBody == null) {
    const obj = await getObject(env.ARTIFACTS, contentKey(project, file));
    if (!obj) return textResponse('Not found', 404);
    uploadIso = uploadedIso(obj) || uploadIso;
    mdBody = await obj.text();
  }
  if (mdBody == null) return textResponse('Not found', 404);
  const time = resolveArtifactTime(entry, uploadIso);

  const etag = `"m-${hashString(`${routePath}|${time.sortDate || ''}|${mdBody.length}|${locked}|${ghost}|${ASSET_V}`)}"`;
  if (isNotModified(request, etag)) return notModifiedResponse(etag, cache, shellSecurity());

  const html =
    request.method === 'HEAD'
      ? ''
      : (() => {
          const doc = renderMarkdownDoc(mdBody);
          return mdViewerPage({
            title: entry.title || downloadName.replace(/\.md$/, ''),
            description: entry.description || '',
            project,
            routePath,
            rawUrl,
            downloadName,
            date: entry.date || null,
            tags: entry.tags || [],
            htmlBody: doc.html,
            headings: doc.headings,
            time,
            locked,
            ghost,
          });
        })();
  return htmlResponse(html, { method: request.method, cache, etag });
};
