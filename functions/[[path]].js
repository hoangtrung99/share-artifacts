// Catch-all content routes served from R2.
//
// URL contract (preserved):
//   /<project>/              → project listing (from catalog)
//   /<project>/<file>        → viewer (HTML iframe or MD edge-render)
//   /<project>/<file>.html   → raw HTML from R2
//   /<project>/<file>.md     → raw Markdown from R2
//
// Shell paths (login, assets, api, …) call next() so the thin Astro shell / other
// functions handle them. Auth is enforced by _middleware.js before this runs.

import {
  SHELL_SEGMENTS,
  loadCatalog,
  loadRegistry,
  listProjectFiles,
  findByRoutePath,
  contentKey,
  getObject,
  getText,
} from './_store.js';
import { renderMarkdownDoc } from './_markdown.js';
import { projectListingPage, htmlViewerPage, mdViewerPage } from './_render.js';
import { pwKey } from './_auth.js';

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

  const first = decodeURIComponent(segments[0]);
  if (SHELL_SEGMENTS.has(first) || first.startsWith('_')) return next();

  // Known static file extensions that are not artifact content
  const last = segments[segments.length - 1] || '';
  if (/\.(css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|txt|xml|json)$/i.test(last) &&
      !/\.(html|md)$/i.test(last)) {
    return next();
  }

  if (!env.ARTIFACTS) {
    return new Response('Content store not configured (R2 binding ARTIFACTS missing).', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const project = first;
  const catalog = await loadCatalog(env);
  const { protected: protectedFolders, ghost: ghostFolders } = await loadRegistry(env);
  const locked = protectedFolders.has(project) || !!env[pwKey(project)];
  const ghost = ghostFolders.has(project);

  // /project or /project/ → listing
  if (segments.length === 1) {
    // Canonicalize trailing slash optional — both OK
    const files = listProjectFiles(catalog, project);
    // Unknown empty project with no catalog entry and not in registries → 404
    if (!files.length && !catalog.projects?.[project] && !locked && !ghost) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const html = projectListingPage({ project, files, locked, ghost });
    return htmlResponse(html, request.method);
  }

  const rest = segments.slice(1).map(decodeURIComponent).join('/');
  const lower = rest.toLowerCase();

  // Raw HTML
  if (lower.endsWith('.html')) {
    const filePath = rest;
    const obj = await getObject(env.ARTIFACTS, contentKey(project, filePath));
    if (!obj) return notFound();
    return rawResponse(obj, 'text/html; charset=utf-8', request.method);
  }

  // Raw Markdown
  if (lower.endsWith('.md')) {
    const filePath = rest;
    const obj = await getObject(env.ARTIFACTS, contentKey(project, filePath));
    if (!obj) return notFound();
    return rawResponse(obj, 'text/markdown; charset=utf-8', request.method);
  }

  // Extensionless viewer
  const routePath = `${project}/${rest}`;
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
          file: `${rest}.${ext}`,
          routePath,
        };
        // Stash body for MD path
        if (ext === 'md') entry._body = await obj.text();
        else entry._exists = true;
        break;
      }
    }
  }

  if (!entry) return notFound();

  const type = entry.type === 'md' ? 'md' : 'html';
  const file = entry.file || `${rest}.${type === 'md' ? 'md' : 'html'}`;
  const rawUrl = `/${project}/${file}`;
  const downloadName = file.split('/').pop();

  if (type === 'html') {
    const html = htmlViewerPage({
      title: entry.title || downloadName,
      description: entry.description || '',
      project,
      routePath,
      rawUrl,
      downloadName,
      locked,
      ghost,
    });
    return htmlResponse(html, request.method);
  }

  // MD viewer — edge render
  let mdBody = entry._body;
  if (mdBody == null) {
    mdBody = await getText(env.ARTIFACTS, contentKey(project, file));
  }
  if (mdBody == null) return notFound();

  const doc = renderMarkdownDoc(mdBody);
  let rendered = doc.html;
  // Wrap tables for horizontal scroll (renderer already wraps tables; double-safe)
  rendered = rendered
    .replace(/<table>/g, '<div class="x-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
  // Avoid double-wrap if renderer already wrapped
  rendered = rendered.replace(/<div class="x-scroll"><div class="x-scroll">/g, '<div class="x-scroll">')
    .replace(/<\/div><\/div>/g, '</div>');

  const html = mdViewerPage({
    title: entry.title || downloadName.replace(/\.md$/, ''),
    description: entry.description || '',
    project,
    routePath,
    rawUrl,
    downloadName,
    date: entry.date || null,
    tags: entry.tags || [],
    htmlBody: rendered,
    headings: doc.headings,
    locked,
    ghost,
  });
  return htmlResponse(html, request.method);
};

function htmlResponse(html, method) {
  return new Response(method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}

async function rawResponse(obj, contentType, method) {
  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('cache-control', 'public, max-age=300');
  if (obj.httpEtag) headers.set('etag', obj.httpEtag);
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
