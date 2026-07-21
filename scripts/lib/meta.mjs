// Extract artifact metadata from HTML / Markdown source bytes.
// Ported from the former src/lib/artifacts.mjs (no filesystem coupling).

/** Decode common HTML entities in <title>/<meta> text. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Normalize a date value to YYYY-MM-DD, or undefined. */
export function isoDate(v) {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

/** Extract YYYY-MM-DD from a relative path. */
export function extractDateFromPath(rel) {
  let m = String(rel).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = String(rel).match(/(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?:[^0-9]|$)/);
  if (m) {
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return undefined;
}

/** Extract YYYY-MM-DD from raw content (keyword-anchored first). */
export function extractDateFromContent(raw) {
  if (!raw) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  const inRange = (d) => d >= '2025-01-01' && d <= today;
  const kw = raw.match(
    /\b(?:generated|build\s*date|updated|created|date)\b[^0-9\n]{0,10}(20\d{2}-\d{2}-\d{2})/i,
  );
  if (kw && inRange(kw[1])) return kw[1];
  const dates = raw.match(/20\d{2}-\d{2}-\d{2}/g);
  if (dates) {
    const valid = dates.filter(inRange);
    if (valid.length) return valid[0];
  }
  return undefined;
}

/** Parse simple YAML frontmatter block at the start of a Markdown file. */
export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: raw };
  const block = raw.slice(3, end).replace(/^\n/, '');
  const after = raw.indexOf('\n', end + 4);
  const body = after === -1 ? '' : raw.slice(after + 1);
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      try {
        fm[key] = JSON.parse(val.replace(/'/g, '"'));
        continue;
      } catch {
        fm[key] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        continue;
      }
    }
    fm[key] = val;
  }
  return { fm, body };
}

/**
 * Extract metadata for a catalog entry.
 * @param {string} raw - file contents
 * @param {string} project
 * @param {string} filePath - project-relative path including extension (e.g. "guides/foo.html")
 */
export function extractMeta(raw, project, filePath) {
  const ext = filePath.toLowerCase().endsWith('.md') ? 'md' : 'html';
  const baseName = filePath.split('/').pop() || filePath;
  const routePath = `${project}/${filePath.replace(/\.(html|md)$/i, '')}`;
  const pathDate = extractDateFromPath(filePath) || extractDateFromPath(routePath);

  if (ext === 'md') {
    const { fm } = parseFrontmatter(raw);
    const date = isoDate(fm.date);
    const contentDate = extractDateFromContent(raw);
    return {
      project,
      file: filePath,
      routePath,
      type: 'md',
      title: fm.title || baseName.replace(/\.md$/i, ''),
      description: fm.description || '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      date: date || null,
      sortDate: date || contentDate || pathDate || '',
    };
  }

  // HTML
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = raw.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  const descContent = descMatch ? descMatch[0].match(/content=["']([\s\S]*?)["']/i) : null;
  const dateMatch = raw.match(/<meta[^>]+name=["']date["'][^>]*>/i);
  const dateContent = dateMatch ? dateMatch[0].match(/content=["']([\s\S]*?)["']/i) : null;
  const metaDate = dateContent ? isoDate(dateContent[1].trim()) : undefined;
  const contentDate = extractDateFromContent(raw);

  return {
    project,
    file: filePath,
    routePath,
    type: 'html',
    title:
      decodeEntities((titleMatch ? titleMatch[1] : '').trim()) ||
      baseName.replace(/\.html$/i, ''),
    description: descContent ? decodeEntities(descContent[1].trim()) : '',
    tags: [],
    date: metaDate || null,
    sortDate: metaDate || contentDate || pathDate || '',
  };
}
