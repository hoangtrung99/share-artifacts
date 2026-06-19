// Single source of truth for artifact enumeration + metadata.
//
// Used by BOTH the gallery (src/pages/index.astro) and the viewer
// (src/pages/[...path].astro) so titles/tags/dates can never drift between them.
//
// IMPORTANT — HTML artifacts are enumerated with fs.readdirSync, NOT import.meta.glob.
// Importing *.html through Vite (even `?url`) makes it emit a hashed copy into
// dist/_astro/ at an UNPROTECTED public path the first-segment middleware cannot gate.
// Reading the bytes directly keeps every HTML artifact off Vite's asset graph, so the
// only public copies are the ones prepare-static.mjs places under /<project>/... where
// the middleware can fail-closed on protected projects.
import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS_ROOT = path.resolve(process.cwd(), 'src', 'artifacts');
const PROTECTED_LIST = path.resolve(process.cwd(), 'protected.list');

/** Recursively collect every *.html under src/artifacts (no Vite import → no emitted asset). */
function collectHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectHtml(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) out.push(full);
  }
  return out;
}

/** Build route param + raw-file metadata from a project-relative path "<project>/<path>.<ext>". */
function fromRel(rel) {
  const ext = path.extname(rel); // ".md" | ".html"
  const routePath = rel.slice(0, -ext.length); // strip extension
  const project = routePath.split('/')[0];
  return {
    routePath,
    project,
    ext,
    rawUrl: '/' + routePath + ext,
    downloadName: path.basename(rel),
    absFile: path.join(ARTIFACTS_ROOT, rel),
  };
}
const fromGlobKey = (key) => fromRel(key.replace(/^\.\.\/artifacts\//, ''));

/**
 * Extract plain body text from a self-contained HTML artifact for full-text search.
 *
 * HTML artifacts are iframed in the viewer (their text never enters the viewer DOM), so
 * Pagefind cannot see their content. We strip the raw file down to indexable text and embed
 * it into the PUBLIC viewer's indexed region (see [...path].astro). Protected artifacts never
 * get this text rendered, so it never reaches the public Pagefind index — fail-closed.
 */
function htmlToSearchText(raw) {
  return raw
    .replace(/<head[\s\S]*?<\/head>/i, ' ') // drop head (title/desc already captured separately)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ') // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a frontmatter date (Date | string) to YYYY-MM-DD, or undefined. */
export function isoDate(v) {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

/** Set of protected project names, read directly from protected.list (fail-closed registry). */
export function protectedProjects() {
  if (!fs.existsSync(PROTECTED_LIST)) return new Set();
  const names = fs
    .readFileSync(PROTECTED_LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(names);
}

/**
 * Enumerate every artifact with full metadata.
 *
 * @param {Record<string, any>} mdModules - result of import.meta.glob('../artifacts/**\/*.md', { eager: true }).
 *   Must be passed in by the caller: import.meta.glob only resolves relative to the importing file.
 * @returns {Promise<Array>} artifact records (md + html), each carrying the same shape.
 */
export async function loadArtifacts(mdModules) {
  const records = [];
  const locked = protectedProjects();

  // --- Markdown artifacts (frontmatter + compiled HTML + headings from Astro's compiler) ---
  for (const [key, mod] of Object.entries(mdModules)) {
    const meta = fromGlobKey(key);
    const fm = mod.frontmatter ?? {};
    const html = await mod.compiledContent();
    const headings = (await mod.getHeadings?.()) ?? [];
    records.push({
      type: 'md',
      project: meta.project,
      protected: locked.has(meta.project),
      routePath: meta.routePath,
      rawUrl: meta.rawUrl,
      downloadName: meta.downloadName,
      title: fm.title || meta.downloadName.replace(/\.md$/, ''),
      description: fm.description || '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      date: isoDate(fm.date),
      html,
      // MD body is inlined into the viewer DOM, so Pagefind already sees it; no extra text.
      searchText: '',
      headings,
    });
  }

  // --- HTML artifacts (metadata from <title>/<meta name=description>, body iframed not inlined) ---
  for (const absFile of collectHtml(ARTIFACTS_ROOT)) {
    const meta = fromRel(path.relative(ARTIFACTS_ROOT, absFile));
    const raw = fs.readFileSync(meta.absFile, 'utf8');
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = raw.match(/<meta[^>]+name=["']description["'][^>]*>/i);
    const descContent = descMatch ? descMatch[0].match(/content=["']([\s\S]*?)["']/i) : null;
    const isLocked = locked.has(meta.project);
    records.push({
      type: 'html',
      project: meta.project,
      protected: isLocked,
      routePath: meta.routePath,
      rawUrl: meta.rawUrl,
      downloadName: meta.downloadName,
      title: (titleMatch ? titleMatch[1] : '').trim() || meta.downloadName.replace(/\.html$/, ''),
      description: descContent ? descContent[1].trim() : '',
      tags: [],
      date: undefined,
      html: null,
      // The iframed body text is invisible to Pagefind. For PUBLIC artifacts we extract it so
      // the viewer can embed it in the indexed region. For PROTECTED artifacts we leave it empty
      // so protected body text never reaches the public index — fail-closed.
      searchText: isLocked ? '' : htmlToSearchText(raw),
      headings: [],
    });
  }

  return records;
}
