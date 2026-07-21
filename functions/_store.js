// R2 content store helpers for Pages Functions.
//
// Bucket layout (binding: ARTIFACTS → bucket artifacts-content):
//   content/<project>/<path>.html|md   — artifact bytes
//   meta/catalog.json                  — project/file index
//   meta/protected.json                — protected project names (array)
//   meta/ghost.json                    — ghost project names (array)
//
// Registry (protected/ghost) is cached in-memory with a short TTL so auth checks
// do not hit R2 on every request. Fail-closed when the binding is missing.

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
  'pagefind',
  'assets',
  'favicon.svg',
  'robots.txt',
  'sitemap-index.xml',
  'sitemap-0.xml',
]);

const REGISTRY_TTL_MS = 45_000;

/** @type {{ at: number, protected: Set<string>, ghost: Set<string> } | null} */
let registryCache = null;

/** Empty catalog shape used when meta/catalog.json is missing. */
export function emptyCatalog() {
  return { version: 1, updatedAt: null, projects: {} };
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
 * Load catalog from R2. Returns empty catalog if missing/unreadable.
 * @param {{ ARTIFACTS?: R2Bucket }} env
 */
export async function loadCatalog(env) {
  const raw = await getText(env.ARTIFACTS, CATALOG_KEY);
  if (!raw) return emptyCatalog();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyCatalog();
    if (!data.projects || typeof data.projects !== 'object') data.projects = {};
    return data;
  } catch {
    return emptyCatalog();
  }
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

  const protectedNames = parseNameArray(protRaw);
  const ghostNames = parseNameArray(ghostRaw);
  registryCache = {
    at: now,
    protected: new Set(protectedNames),
    ghost: new Set(ghostNames),
  };
  return { protected: registryCache.protected, ghost: registryCache.ghost };
}

/** Force the next loadRegistry call to re-fetch from R2. */
export function invalidateRegistryCache() {
  registryCache = null;
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
 * List files for a project from the catalog (lean fields for listing pages / API).
 * @param {object} catalog
 * @param {string} project
 */
export function listProjectFiles(catalog, project) {
  const proj = catalog.projects?.[project];
  if (!proj?.files) return [];
  return proj.files.map((f) => {
    const rest = f.routePath.split('/').slice(1);
    const folder = rest.slice(0, -1).join('/');
    return {
      title: f.title,
      routePath: f.routePath,
      type: f.type,
      date: f.date ?? null,
      sortDate: f.sortDate ?? '',
      folder,
      description: f.description || '',
      tags: Array.isArray(f.tags) ? f.tags : [],
    };
  });
}
