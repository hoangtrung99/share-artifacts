// Minimal Markdown → HTML renderer (pure JS, no dependencies).
// Supports: ATX headers, fenced code, ordered/unordered lists, GFM task lists,
// links, images, bold/italic, inline code, blockquotes, horizontal rules,
// paragraphs, simple tables.
// Authors are trusted (content is not sandboxed) — same trust model as raw HTML artifacts.

/**
 * @param {string} md
 * @returns {string} HTML fragment (no outer <html>)
 */
export function renderMarkdown(md) {
  return renderMarkdownDoc(md).html;
}

/**
 * @param {string} md
 * @returns {{ html: string, headings: Array<{ depth: number, text: string, id: string }> }}
 */
export function renderMarkdownDoc(md) {
  if (!md) return { html: '', headings: [] };
  // Strip YAML frontmatter
  let src = md;
  if (src.startsWith('---')) {
    const end = src.indexOf('\n---', 3);
    if (end !== -1) {
      const after = src.indexOf('\n', end + 4);
      src = after === -1 ? '' : src.slice(after + 1);
    }
  }

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const slugCounts = Object.create(null);
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];
  let listType = null; // 'ul' | 'ol'
  let listBuf = []; // items: { html, task?, checked? }
  let quoteBuf = [];
  let paraBuf = [];
  let tableBuf = [];

  const uniqueSlug = (text) => {
    let base = slugify(text) || 'section';
    const n = slugCounts[base] || 0;
    slugCounts[base] = n + 1;
    return n === 0 ? base : `${base}-${n}`;
  };

  const flushPara = () => {
    if (!paraBuf.length) return;
    const text = paraBuf.join('\n').trim();
    paraBuf = [];
    if (text) out.push(`<p>${inline(text)}</p>`);
  };
  const flushList = () => {
    if (!listType || !listBuf.length) {
      listType = null;
      listBuf = [];
      return;
    }
    const tag = listType;
    const hasTask = listBuf.some((li) => li.task);
    const ulClass = hasTask && tag === 'ul' ? ' class="task-list"' : '';
    out.push(
      `<${tag}${ulClass}>${listBuf
        .map((li) => {
          if (li.task) {
            const checked = li.checked ? ' checked' : '';
            return `<li class="task-list-item"><input type="checkbox" disabled${checked}> ${li.html}</li>`;
          }
          return `<li>${li.html}</li>`;
        })
        .join('')}</${tag}>`,
    );
    listType = null;
    listBuf = [];
  };
  const flushQuote = () => {
    if (!quoteBuf.length) return;
    out.push(`<blockquote>${quoteBuf.map((l) => `<p>${inline(l)}</p>`).join('')}</blockquote>`);
    quoteBuf = [];
  };
  const flushTable = () => {
    if (tableBuf.length < 2) {
      for (const row of tableBuf) paraBuf.push(row);
      tableBuf = [];
      return;
    }
    const rows = tableBuf.map(parseTableRow);
    tableBuf = [];
    const bodyStart = rows.length > 1 && rows[1].every((c) => /^:?-+:?$/.test(c.trim())) ? 2 : 1;
    const head = rows[0];
    let html = '<div class="x-scroll"><table><thead><tr>';
    html += head.map((c) => `<th>${inline(c.trim())}</th>`).join('');
    html += '</tr></thead><tbody>';
    for (let r = bodyStart; r < rows.length; r++) {
      html += '<tr>' + rows[r].map((c) => `<td>${inline(c.trim())}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table></div>';
    out.push(html);
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
    flushTable();
  };

  /** Parse list item text; detect GFM task list `- [ ]` / `- [x]`. */
  const parseListItem = (raw) => {
    const task = raw.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      return {
        task: true,
        checked: task[1].toLowerCase() === 'x',
        html: inline(task[2]),
      };
    }
    return { task: false, checked: false, html: inline(raw) };
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      if (inCode) {
        out.push(
          `<pre><code${codeLang ? ` class="language-${escapeAttr(codeLang)}"` : ''}>${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
        );
        inCode = false;
        codeLang = '';
        codeBuf = [];
      } else {
        flushAll();
        inCode = true;
        codeLang = fence[1] || '';
        codeBuf = [];
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      i++;
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (hm) {
      flushAll();
      const level = hm[1].length;
      const text = hm[2].trim();
      const id = uniqueSlug(text);
      headings.push({ depth: level, text, id });
      out.push(`<h${level} id="${escapeAttr(id)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      flushPara();
      flushList();
      flushTable();
      quoteBuf.push(line.replace(/^ {0,3}>\s?/, ''));
      i++;
      continue;
    }
    if (quoteBuf.length) flushQuote();

    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && line.includes('|')) {
      flushPara();
      flushList();
      tableBuf.push(line);
      i++;
      continue;
    }
    if (tableBuf.length) flushTable();

    const ulm = line.match(/^ {0,3}[-*+]\s+(.+)$/);
    const olm = line.match(/^ {0,3}(\d+)[.)]\s+(.+)$/);
    if (ulm || olm) {
      flushPara();
      flushQuote();
      const type = ulm ? 'ul' : 'ol';
      const item = ulm ? ulm[1] : olm[2];
      if (listType && listType !== type) flushList();
      listType = type;
      listBuf.push(parseListItem(item));
      i++;
      continue;
    }
    if (listType && line.match(/^ {2,}\S/)) {
      const last = listBuf[listBuf.length - 1];
      if (last) last.html += ' ' + inline(line.trim());
      i++;
      continue;
    }
    if (listType) flushList();

    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    paraBuf.push(line);
    i++;
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  flushAll();
  return { html: out.join('\n'), headings };
}

function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|');
}

/**
 * Inline markdown. Bold before italic; no lookbehind (Safari older-compatible).
 */
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url) => `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy">`,
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, label, url) => `<a href="${escapeAttr(url)}">${label}</a>`,
  );
  // Bold first so italic patterns don't eat `**…**`
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic: single * or _ not adjacent to another (no lookbehind)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Autolink bare URLs not already inside an attribute or tag
  s = s.replace(/(^|[^"'>=])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return s;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
