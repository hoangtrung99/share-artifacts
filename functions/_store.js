// R2 content store helpers for Pages Functions.
//
// Bucket layout (binding: ARTIFACTS → bucket artifacts-content):
//   content/<project>/<path>.html|md   — artifact bytes
//   meta/catalog.json                  — project/file index
//   meta/protected.json                — protected project names (array)
//   meta/ghost.json                    — ghost project names (array)
//
// The catalog, protected/ghost registries and per-project upload times are cached in-memory
// with a short TTL so anonymous traffic does not hit R2 on every request (and so the 100KB
// catalog is not fetched + parsed per page view). Registers fail closed when the binding is
// missing. Upload times come from R2 object metadata (ListObjects), so "Recent" reflects the
// real upload/update time instead of a guessed date extracted from the artifact content.

export const BUCKET_NAME = 'artifacts-content';
export const CATALOG_KEY = 'meta/catalog.json';
export const PROTECTED_KEY = 'meta/protected.json';
export const GHOST_KEY = 'meta/ghost.json';

// First-path segments that belong to the thin shell / API — not content projects.
// Catch-all content handler calls next() for these so static assets / other functions serve them.
export const SHELL_SEGMENTS = new Set([
  'login',
  'logout',
  'ghost',
  'share',
  's',
  'api',
  '_astro',
  'assets',
  'favicon.svg',
  'robots.txt',
  'sitemap-index.xml',
  'sitemap-0.xml',
]);

export const REGISTRY_TTL_MS = 45_000;
export const CATALOG_TTL_MS = 30_000;
export const UPLOAD_TTL_MS = 30_000;

/** @type {{ at: number, protected: Set<string>, ghost: Set<string> } | null} */
let registryCache = null;
/** @type {{ at: number, data: object } | null} */
let catalogCache = null;
/** @type {Map<string, { at: number, map: Map<string, string> }>} */
const uploadCache = new Map();

/** Drop every in-memory cache. Used by tests and after intentional registry writes. */
export function resetStoreCaches() {
  registryCache = null;
  catalogCache = null;
  uploadCache.clear();
}

/** Empty catalog shape used when meta/catalog.json is missing. */
export function emptyCatalog() {
  return { version: 1, updatedAt: null, projects: {} };
}

/**
 * Decode a URL path segment without throwing on malformed percent-encoding.
 * @param {string | null | undefined} value
 */
export function safeDecode(value) {
  if (value == null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {R2Bucket | undefined} bucket
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function getText(bucket, key) {
  if (!bucket) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.text();
}

/**
 * @param {R2Bucket | undefined} bucket
 * @param {string} key
 * @returns {Promise<R2ObjectBody | null>}
 */
export async function getObject(bucket, key) {
  if (!bucket) return null;
  return bucket.get(key);
}

/**
 * Load catalog from R2 (in-memory TTL). Returns empty catalog if missing/unreadable.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 */
export async function loadCatalog(env) {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.data;

  const raw = await getText(env.ARTIFACTS, CATALOG_KEY);
  let data = emptyCatalog();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.projects || typeof parsed.projects !== 'object') parsed.projects = {};
        data = parsed;
      } else {
        console.error('[store] catalog is not a JSON object; serving an empty catalog');
      }
    } catch (error) {
      console.error('[store] catalog JSON parse failed:', error.message);
    }
  }
  catalogCache = { at: now, data };
  return data;
}

/** Force the next loadCatalog call to re-fetch from R2. */
export function invalidateCatalogCache() {
  catalogCache = null;
}

/**
 * Load protected + ghost registries from R2 with a short in-memory TTL.
 * Fail-closed: missing binding or read errors → empty sets (secrets still gate via PW_*).
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @returns {Promise<{ protected: Set<string>, ghost: Set<string> }>}
 */
export async function loadRegistry(env) {
  const now = Date.now();
  if (registryCache && now - registryCache.at < REGISTRY_TTL_MS) {
    return { protected: registryCache.protected, ghost: registryCache.ghost };
  }

  const [protRaw, ghostRaw] = await Promise.all([
    getText(env.ARTIFACTS, PROTECTED_KEY),
    getText(env.ARTIFACTS, GHOST_KEY),
  ]);

  registryCache = {
    at: now,
    protected: new Set(parseNameArray(protRaw)),
    ghost: new Set(parseNameArray(ghostRaw)),
  };
  return { protected: registryCache.protected, ghost: registryCache.ghost };
}

/** Force the next loadRegistry call to re-fetch from R2. */
export function invalidateRegistryCache() {
  registryCache = null;
}

/**
 * Map of project-relative file path → ISO upload timestamp, from R2 object metadata
 * (ListObjects). Cached per isolate for UPLOAD_TTL_MS. Returns an empty map on failure so
 * listing still renders (sort falls back to the catalog's stored date).
 * @param {{ ARTIFACTS?: R2Bucket }} env
 * @param {string} project
 * @returns {Promise<Map<string, string>>}
 */
export async function loadUploadTimes(env, project) {
  if (!env.ARTIFACTS) return new Map();
  const now = Date.now();
  const cached = uploadCache.get(project);
  if (cached && now - cached.at < UPLOAD_TTL_MS) return cached.map;

  const prefix = `content/${project}/`;
  const map = new Map();
  try {
    let cursor;
    do {
      const page = await env.ARTIFACTS.list({
        prefix,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      for (const object of page.objects) {
        if (!object.key.startsWith(prefix)) continue;
        const relative = object.key.slice(prefix.length);
        if (!relative) continue;
        const uploaded = object.uploaded instanceof Date ? object.uploaded : new Date(object.uploaded);
        if (!Number.isNaN(uploaded.getTime())) map.set(relative, uploaded.toISOString());
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (error) {
    console.error('[store] R2 list failed for', project, '-', error.message);
    return new Map();
  }

  uploadCache.set(project, { at: now, map });
  return map;
}

/** Drop cached upload times (all projects or one). */
export function invalidateUploadTimes(project) {
  if (project) uploadCache.delete(project);
  else uploadCache.clear();
}

/**
 * @param {string | null} raw
 * @returns {string[]}
 */
function parseNameArray(raw) {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** R2 object key for an artifact file. filePath is project-relative including extension. */
export function contentKey(project, filePath) {
  const clean = String(filePath).replace(/^\/+/, '');
  return `content/${project}/${clean}`;
}

/**
 * Find a catalog file entry by extensionless routePath ("project/a/b").
 * @param {object} catalog
 * @param {string} routePath
 */
export function findByRoutePath(catalog, routePath) {
  const project = routePath.split('/')[0];
  const proj = catalog.projects?.[project];
  if (!proj?.files) return null;
  return proj.files.find((f) => f.routePath === routePath) || null;
}

/**
 * Normalize a date-ish value to a full ISO timestamp so string sorting stays consistent.
 * Accepts YYYY-MM-DD and full ISO strings; returns '' for anything unusable.
 * @param {unknown} value
 */
export function normalizeDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw + 'T00:00:00.000Z';
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  return '';
}

/** True when two ISO timestamps denote the same instant (falls back to string equality). */
function sameInstant(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
}

/**
 * Resolve which timestamp to show/sort for one artifact.
 *
 * Time model (see README "Timestamps"):
 *  - uploadedAt          real R2 last-modified time (set on deliver, backfilled from R2)
 *  - uploadedAtReliable  false for bulk imports/moves (mass migration, reorg copies) where the
 *                        upload time says nothing about when the artifact was made
 *  - artifactDate        best-effort creation date from explicit meta/frontmatter or path/content
 *
 * Reliable uploads sort by upload time (true recency). Bulk/legacy entries sort by artifactDate
 * so a folder move does not make an old report look new. If neither is known, the raw upload
 * time is still shown (better than a blank cell) but marked as a legacy upload.
 *
 * @param {object} entry catalog entry
 * @param {string | null} [uploadIso] fresh R2 last-modified (overrides the catalog snapshot)
 */
export function resolveArtifactTime(entry, uploadIso = null) {
  const uploadedAt = uploadIso || (typeof entry.uploadedAt === 'string' ? entry.uploadedAt : null);
  const artifactDate = normalizeDateTime(entry.artifactDate || entry.date || entry.sortDate);
  let reliable = entry.uploadedAtReliable === true;
  // A changed object timestamp means a real re-upload happened after the catalog snapshot.
  // Compare parsed instants, not raw strings: the R2 REST API, the Workers binding and older
  // catalog snapshots may serialize the same moment with different precision.
  if (uploadedAt && entry.uploadedAt && !sameInstant(uploadedAt, entry.uploadedAt)) reliable = true;

  let sortDate = '';
  let displayDate = '';
  let displaySource = '';
  if (reliable && uploadedAt) {
    sortDate = uploadedAt;
    displayDate = uploadedAt.slice(0, 10);
    displaySource = 'upload';
  } else if (artifactDate) {
    sortDate = artifactDate;
    displayDate = artifactDate.slice(0, 10);
    displaySource = 'artifact';
  } else if (uploadedAt) {
    sortDate = uploadedAt;
    displayDate = uploadedAt.slice(0, 10);
    displaySource = 'legacy-upload';
  } else {
    displaySource = 'missing';
  }

  return {
    uploadedAt,
    artifactDate,
    sortDate,
    displayDate,
    displaySource,
    uploadedAtReliable: reliable,
  };
}

/**
 * Build the lean file list used by listing pages / API responses.
 * `uploads` (file → ISO upload time) is merged over the catalog; objects that exist on R2 but
 * are missing from the catalog are appended as synthetic entries so a broken catalog upsert can
 * never hide a delivered artifact.
 * @param {object} catalog
 * @param {string} project
 * @param {Map<string, string> | null} [uploads]
 */
export function listProjectFiles(catalog, project, uploads = null) {
  const proj = catalog.projects?.[project];
  const catalogFiles = Array.isArray(proj?.files) ? proj.files : [];
  const out = [];
  const seenFiles = new Set();
  const seenRoutes = new Set();

  for (const f of catalogFiles) {
    if (!f || typeof f !== 'object' || typeof f.routePath !== 'string') continue;
    const uploadIso = uploads?.get(f.file) || null;
    const time = resolveArtifactTime(f, uploadIso);
    const rest = f.routePath.split('/').slice(1);
    out.push({
      title: f.title,
      routePath: f.routePath,
      type: f.type,
      date: f.date ?? null,
      ...time,
      folder: rest.slice(0, -1).join('/'),
      description: f.description || '',
      tags: Array.isArray(f.tags) ? f.tags : [],
      file: f.file,
    });
    seenFiles.add(f.file);
    seenRoutes.add(f.routePath);
  }

  if (uploads) {
    for (const [file, uploadedAt] of uploads) {
      if (!/\.(html|md)$/i.test(file) || seenFiles.has(file)) continue;
      const isMd = file.toLowerCase().endsWith('.md');
      const routePath = `${project}/${file.replace(/\.(html|md)$/i, '')}`;
      if (seenRoutes.has(routePath)) continue;
      seenRoutes.add(routePath);
      seenFiles.add(file);
      const parts = file.split('/');
      out.push({
        title: parts[parts.length - 1].replace(/\.(html|md)$/i, ''),
        routePath,
        type: isMd ? 'md' : 'html',
        date: null,
        uploadedAt,
        artifactDate: '',
        sortDate: uploadedAt,
        displayDate: uploadedAt.slice(0, 10),
        displaySource: 'legacy-upload',
        uploadedAtReliable: false,
        folder: parts.slice(0, -1).join('/'),
        description: '',
        tags: [],
        file,
      });
    }
  }

  return out;
}

const CATEGORY_LABELS = {
  ai: 'AI',
  html: 'HTML',
  md: 'MD',
  'dev-tools': 'Dev tools',
  devtools: 'Dev tools',
  infra: 'Infra',
  networking: 'Networking',
  crypto: 'Crypto',
  personal: 'Personal',
  general: 'General',
  root: 'Root',
};

/** Normalise a tag/folder into a stable category slug. */
export function categorySlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Human label for a category slug ("dev-tools" → "Dev tools", "ai" → "AI"). */
export function categoryLabel(slug) {
  if (CATEGORY_LABELS[slug]) return CATEGORY_LABELS[slug];
  const words = String(slug || '').split('-').filter(Boolean);
  if (!words.length) return 'General';
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');
}

/**
 * Category model for a project's file list:
 *  - 'folder'   — at least one artifact lives in a folder, so folders are the categories
 *                 (root-level files become the "root" category);
 *  - 'keywords' — flat project, so curated keyword matching + tags label the artifacts.
 * @param {Array} files
 * @returns {'folder'|'keywords'}
 */
export function categoryMode(files) {
  return (files || []).some((file) => entryFolder(file)) ? 'folder' : 'keywords';
}

/**
 * Project-relative folder path for an entry ("reports/sub" or "" for root).
 * listProjectFiles already sets `folder`; raw catalog entries only have routePath (which starts
 * with the project name), so derive it there. Keeping the derivation here makes the category
 * model identical for edge listings and the catalog API.
 */
function entryFolder(entry) {
  if (typeof entry?.folder === 'string' && entry.folder) return entry.folder;
  const parts = String(entry?.routePath || '')
    .split('/')
    .filter(Boolean);
  return parts.length > 2 ? parts.slice(1, -1).join('/') : '';
}

/**
 * Curated keyword fallback for flat projects so existing untagged artifacts still get useful
 * categories. Only used in keyword mode.
 */
const CATEGORY_KEYWORDS = [
  ['networking', /tailscale|warp|clash|mihomo|proxy|squid|tunnel|funnel|cloudfront|dns|\bssh\b|\bvpn\b|exit node|serve|mạng|network/i],
  ['crypto', /crypto|indicator|\bma\b|\bema\b|\brsi\b|\bmacd\b|bollinger|\blot\b|forex|trading|vàng|bạc|chỉ báo/i],
  ['ai', /\bai\b|agent|claude|herdr|workflow|prompt|subagent|context|session|fable/i],
  ['dev-tools', /vimium|\bgit\b|mac mini|macbook|mutagen|command|terminal|script|\bbse\b|code|config|yaml|android/i],
  ['infra', /infra|terraform|aws|container|cloudfront|warp|proxy|server|deploy|\bdns\b/i],
  ['personal', /da nang|đà nẵng|asia|living|relocation|travel|du lịch/i],
  ['translations', /bản dịch|translation|dịch/i],
];

/** Curated keyword fallback so existing untagged artifacts still get useful categories. */
function keywordCategories(entry) {
  const haystack = [entry?.title, entry?.routePath, entry?.description, entryFolder(entry)]
    .filter(Boolean)
    .join(' ');
  const out = [];
  for (const [slug, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) out.push(slug);
    if (out.length === 2) break;
  }
  return out;
}

/**
 * Categories for one artifact row.
 * Explicit tags always win, in both modes. In folder mode an untagged file is categorised by
 * its top-level folder, and root-level files are "root". In keyword mode untagged files fall
 * back to curated keywords, then "general".
 * @param {object} entry
 * @param {'folder'|'keywords'} [mode]
 */
export function entryCategories(entry, mode = 'keywords') {
  const tags = Array.isArray(entry?.tags) ? entry.tags.map(categorySlug).filter(Boolean) : [];
  if (tags.length) return [...new Set(tags)];
  if (mode === 'folder') {
    const folder = entryFolder(entry).split('/')[0];
    return [folder ? categorySlug(folder) : 'root'];
  }
  const keywords = keywordCategories(entry);
  return keywords.length ? keywords : ['general'];
}

/** Category chips for a project: [{ slug, label, count }], most used first. */
export function categorySummary(files) {
  const mode = categoryMode(files);
  const counts = new Map();
  for (const file of files || []) {
    for (const slug of entryCategories(file, mode)) counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
