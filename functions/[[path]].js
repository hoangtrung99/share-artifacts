// Catch-all content routes served from R2.
//
// URL contract (preserved):
//   /<project>/              → project listing (from catalog + R2 upload times)
//   /<project>/<file>        → viewer (HTML iframe or MD edge-render)
//   /<project>/<file>.html   → raw HTML from R2
//   /<project>/<file>.md     → raw Markdown from R2
//
// Version layer (additive): `?rev=<revisionId>` serves an immutable snapshot from
// revisions/<artifactId>/<revisionId>/source.* instead of the mutable current bytes. The default
// (no rev) serves the latest registered revision when the artifact has a registry, and falls back
// to today's mutable `content/` behavior for legacy artifacts. Unknown revisions are a 404 — never
// a silent fallback, because a review must stay bound to the bytes it was written against.
//
// Cache/security headers are set here because public/_headers only applies to static assets.
// Password-protected and ghost content is never cacheable by shared caches; raw bytes support
// ETag revalidation (304) so repeat views do not re-download the artifact. Immutable snapshots are
// cacheable forever when public, and no-store when protected/ghost (auth is enforced before this).
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
import { projectListingPage, htmlViewerPage, mdViewerPage, notFoundPage, ASSET_V } from './_render.js';
import { pwKey } from './_auth.js';
import {
  artifactIdFor,
  loadRevisionRegistryState,
  isTombstoned,
  latestRevision,
  findRevision,
  revisionKey,
  readSnapshotText,
} from './_feedback-revisions.js';
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

/**
 * Revision registry for one content path, verified to describe this exact artifact.
 * A mismatched/missing registry means "legacy artifact": callers fall back to content/.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {string} project
 * @param {string} file
 * @param {'html'|'md'} type
 */
async function contentRevisionRegistry(env, project, file, type, { fresh = false } = {}) {
  const artifactId = await artifactIdFor(project, file);
  let state = await loadRevisionRegistryState(env, artifactId, { fresh });
  // Refresh one cached miss: a just-published manifest must not 404 behind the isolate cache.
  if (!fresh && !state.registry && !state.malformed) {
    state = await loadRevisionRegistryState(env, artifactId, { fresh: true });
  }
  const registry = state.registry
    && state.registry.project === project
    && state.registry.file === file
    && state.registry.type === type
    ? state.registry
    : null;
  return { artifactId, registry, tombstoned: isTombstoned(registry) };
}

/**
 * Revision context handed to the viewer shell (frontend adds optional render params).
 * @param {object} registry
 * @param {object} revision
 * @param {boolean} isLatest
 */
function revisionView(registry, revision, isLatest) {
  return {
    revisionId: revision.revisionId,
    number: revision.number,
    total: registry.revisions.length,
    latestNumber: registry.latestRevisionNumber,
    latestRevisionId: registry.latestRevisionId,
    isLatest,
    revisioningEnabled: true,
  };
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
  if (first === 'r' && segments.length >= 2) return next(); // /r/<token> review redemption route

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

  /** Shared HTML 404 shell (never plain text on document routes). */
  const notFound = (projectName = project) =>
    htmlResponse(notFoundPage({ project: projectName }), {
      method: request.method,
      cache: 'no-store',
      status: 404,
    });

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
      return notFound(project);
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
    const type = isMd ? 'md' : 'html';
    const revParam = url.searchParams.get('rev');
    const isPrivate = locked || ghost;
    let object = null;
    let servedRevision = null;

    if (revParam !== null) {
      // Pinned revision: immutable snapshot, 404 when unknown (never fall back to latest).
      const { artifactId, registry, tombstoned } = await contentRevisionRegistry(env, project, rest, type, { fresh: true });
      if (tombstoned) return notFound(project);
      const revision = registry ? findRevision(registry, revParam) : null;
      if (!revision) return notFound(project);
      object = await getObject(env.ARTIFACTS, revisionKey(artifactId, revision.revisionId, type));
      if (!object) return notFound(project);
      servedRevision = revision;
    } else {
      const { artifactId, registry, tombstoned } = await contentRevisionRegistry(env, project, rest, type);
      if (tombstoned) return notFound(project); // unpublished: never fall back to content/
      if (registry) {
        const latest = latestRevision(registry);
        if (latest) {
          object = await getObject(env.ARTIFACTS, revisionKey(artifactId, latest.revisionId, type));
          if (object) servedRevision = latest;
          else console.error('[content] revision snapshot missing; falling back to mutable content');
        }
      }
      if (!object) object = await getObject(env.ARTIFACTS, contentKey(project, rest));
    }
    if (!object) return notFound(project);

    // Immutable snapshots never change: cache them forever when public, never when protected.
    // Snapshots are content-addressed but unpublish must take effect promptly: cap public caching
    // at 300s (same as today's raw bytes) instead of immutable. Protected content is never cached.
    const cache = servedRevision
      ? cacheControl(isPrivate, 300)
      : cacheControl(isPrivate, 300);
    const etag = servedRevision ? `"r-${servedRevision.revisionId}"` : object.httpEtag || null;
    if (isNotModified(request, etag)) return notModifiedResponse(etag, cache, artifactSecurity());

    const headers = new Headers();
    headers.set('content-type', isMd ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8');
    headers.set('cache-control', cache);
    for (const [key, value] of Object.entries(artifactSecurity())) headers.set(key, value);
    if (etag) headers.set('etag', etag);
    if (servedRevision) headers.set('x-artifact-revision', servedRevision.revisionId);
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
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

  if (!entry) return notFound(project);

  const type = entry.type === 'md' ? 'md' : 'html';
  const file = entry.file || `${rest}.${type === 'md' ? 'md' : 'html'}`;
  const rawUrlBase = `/${project}/${file}`;
  const downloadName = file.split('/').pop();
  const cache = cacheControl(locked || ghost, 60);

  // --- revision context (additive): registry latest by default, pinned when ?rev= is present ---
  // A pinned viewer request must not 404 behind a warm isolate: refresh the manifest first.
  const revParam = url.searchParams.get('rev');
  const { artifactId, registry, tombstoned } = await contentRevisionRegistry(env, project, file, type, {
    fresh: revParam !== null,
  });
  if (tombstoned) return notFound(project); // unpublished: never render a stale shell
  const artifactContext = { artifactId, project, file, routePath };
  let revisionContext = null;
  let rawUrl = rawUrlBase;
  if (revParam !== null) {
    const revision = registry ? findRevision(registry, revParam) : null;
    if (!revision) return notFound(project);
    revisionContext = revisionView(registry, revision, revision.revisionId === registry.latestRevisionId);
    rawUrl = `${rawUrlBase}?rev=${encodeURIComponent(revision.revisionId)}`;
  } else if (registry) {
    const latest = latestRevision(registry);
    if (latest) {
      // Pin every view to the latest immutable revision: iframe/raw/download and the feedback
      // context must never load bytes that the review was not written against. The address bar URL
      // stays canonical (no rev).
      revisionContext = revisionView(registry, latest, true);
      rawUrl = `${rawUrlBase}?rev=${encodeURIComponent(latest.revisionId)}`;
    }
  }

  if (type === 'html') {
    const uploadIso = entry.uploadedAt || (await headUploadedAt(env, project, file));
    const time = resolveArtifactTime(entry, uploadIso);
    const etag = `"v-${hashString(`${routePath}|${revisionContext ? revisionContext.revisionId : time.sortDate || ''}|${locked}|${ghost}|${ASSET_V}`)}"`;
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
            artifact: artifactContext,
            revision: revisionContext,
          });
    return htmlResponse(html, { method: request.method, cache, etag });
  }

  // MD viewer — edge render. Prefer the immutable snapshot bytes when revisioned.
  let mdBody = entry._body ?? null;
  let uploadIso = entry.uploadedAt || null;
  if (revisionContext) {
    const snapshot = await readSnapshotText(env, artifactId, revisionContext.revisionId, 'md');
    if (snapshot != null) {
      mdBody = snapshot;
    } else if (revParam !== null) {
      return notFound(project);
    } else {
      // Registry points at a snapshot that is missing: degrade to legacy mutable content.
      console.error('[content] MD snapshot missing; falling back to mutable content');
      revisionContext = null;
      rawUrl = rawUrlBase;
    }
  }
  if (mdBody == null) {
    const obj = await getObject(env.ARTIFACTS, contentKey(project, file));
    if (!obj) return notFound(project);
    uploadIso = uploadedIso(obj) || uploadIso;
    mdBody = await obj.text();
  }
  if (mdBody == null) return notFound(project);
  const time = resolveArtifactTime(entry, uploadIso);

  const etag = `"m-${hashString(`${routePath}|${revisionContext ? revisionContext.revisionId : mdBody.length}|${locked}|${ghost}|${ASSET_V}`)}"`;
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
            artifact: artifactContext,
            revision: revisionContext,
          });
        })();
  return htmlResponse(html, { method: request.method, cache, etag });
};
