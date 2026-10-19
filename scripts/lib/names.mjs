// Shared validation for project names and artifact file paths.
// Used by the CLI scripts so a typo (or a hostile value) can never create a catalog entry that
// the Functions cannot address safely.

export const RESERVED_PROJECTS = new Set([
  'api',
  'assets',
  'login',
  'logout',
  'ghost',
  'share',
  's',
  '_astro',
  'sitemap-index.xml',
  'sitemap-0.xml',
  'favicon.svg',
  'robots.txt',
]);

const PROJECT_RE = /^[a-z0-9][a-z0-9._-]*$/;
const EXT_RE = /\.(html|md)$/i;
const CONTROL_OR_UNSAFE = /[\\?#%\u0000-\u001f]/;

/** @param {string} project */
export function projectNameError(project) {
  const name = String(project ?? '');
  if (!name) return 'project name is required';
  if (name.length > 64) return 'project name must be 64 characters or fewer';
  if (!PROJECT_RE.test(name)) {
    return 'project name must be lowercase letters, digits, dot, dash or underscore (start alphanumeric)';
  }
  if (name.includes('..') || name === '.' || name === '..') return 'project name cannot contain ".."';
  if (RESERVED_PROJECTS.has(name)) return `"${name}" is reserved for the shell/API`;
  return null;
}

/** @param {string} file */
export function filePathError(file) {
  const value = String(file ?? '');
  if (!value) return 'file path is required';
  if (value.length > 200) return 'file path must be 200 characters or fewer';
  if (value.startsWith('/')) return 'file path must be project-relative (no leading slash)';
  if (CONTROL_OR_UNSAFE.test(value)) return 'file path contains an unsafe character (\\ ? # % or control)';
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'file path cannot contain empty, "." or ".." segments';
  }
  if (!EXT_RE.test(value)) return 'file path must end in .html or .md';
  return null;
}

/** @param {string} project */
export function assertProjectName(project) {
  const error = projectNameError(project);
  if (error) throw new Error(error);
  return String(project);
}

/** @param {string} file */
export function assertFilePath(file) {
  const error = filePathError(file);
  if (error) throw new Error(error);
  return String(file);
}
