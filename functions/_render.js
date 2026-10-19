// HTML shell templates for Function-served content pages.
// Links non-hashed /assets/site.css + /assets/viewer.js so the thin Astro shell
// and edge-rendered pages share one stylesheet.
// ASSET_V busts CDN/browser cache when shell assets change (max-age on /assets/*).

export const ASSET_V = '867ba07d';

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} opts.body
 * @param {boolean} [opts.fullBleed]
 * @param {boolean} [opts.noindex]
 * @param {boolean} [opts.includeViewerJs]
 * @param {string} [opts.headExtra] extra tags in <head> (e.g. highlight.js)
 */
export function shellLayout({
  title,
  description = '',
  body,
  fullBleed = false,
  noindex = false,
  includeViewerJs = true,
  headExtra = '',
}) {
  const desc = description
    ? `<meta name="description" content="${esc(description)}">`
    : '';
  const robots = noindex ? `<meta name="robots" content="noindex">` : '';
  const bodyClass = fullBleed ? ' class="bleed"' : '';
  const wrapOpen = fullBleed ? '' : '<main class="container">';
  const wrapClose = fullBleed ? '' : '</main>';
  const viewerJs = includeViewerJs
    ? `<script src="/assets/viewer.js?v=${ASSET_V}" defer></script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/assets/site.css?v=${ASSET_V}">
  ${headExtra}
  <title>${esc(title)}</title>
  ${desc}
  ${robots}
</head>
<body${bodyClass}>
  ${wrapOpen}
  ${body}
  ${wrapClose}
  ${viewerJs}
</body>
</html>`;
}


/** Build nested folder tree from flat file items (each has .folder, .sortDate, …). */
function buildTree(items) {
  const root = { name: '', path: '', files: [], children: new Map(), count: 0, date: '' };
  for (const it of items) {
    const parts = it.folder ? String(it.folder).split('/').filter(Boolean) : [];
    let node = root;
    let curPath = '';
    for (const part of parts) {
      curPath = curPath ? `${curPath}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: curPath, files: [], children: new Map(), count: 0, date: '' });
      }
      node = node.children.get(part);
    }
    node.files.push(it);
  }
  const finalize = (node) => {
    const kids = [...node.children.values()].map(finalize);
    const dates = [
      ...node.files.map((f) => f.sortDate || ''),
      ...kids.map((c) => c.date),
    ].filter(Boolean);
    node.date = dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : '';
    kids.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
    node.files.sort((a, b) => {
      const da = a.sortDate || '';
      const db = b.sortDate || '';
      if (da !== db) return db.localeCompare(da);
      return (a.title || '').localeCompare(b.title || '');
    });
    node.children = kids;
    node.count = node.files.length + kids.reduce((s, c) => s + c.count, 0);
    return node;
  };
  return finalize(root);
}

/** Tooltip explaining where a timestamp came from (upload vs artifact date). */
function timeTitle(time) {
  if (!time) return '';
  if (time.displaySource === 'missing') return 'Object missing from R2 (stale catalog entry)';
  const parts = [];
  if (time.displaySource === 'upload') {
    parts.push(`Uploaded ${time.uploadedAt}`);
  } else if (time.displaySource === 'artifact') {
    parts.push(`Artifact date ${time.artifactDate}`);
    if (time.uploadedAt) parts.push(`uploaded ${time.uploadedAt}`);
  } else if (time.displaySource === 'legacy-upload') {
    parts.push(`Legacy bulk upload ${time.uploadedAt}`);
    parts.push(time.artifactDate ? `artifact date ${time.artifactDate}` : 'artifact date unknown');
  }
  return parts.join(' · ');
}

function timeBadge(time, className = 'date') {
  if (!time || !time.displayDate) return '';
  const arrow = time.displaySource === 'artifact' ? '◆' : '↑';
  return `<span class="${className}" title="${escAttr(timeTitle(time))}">${arrow} ${esc(time.displayDate)}</span>`;
}

function fileLi(f) {
  const type = f.type || 'html';
  // Every row shows the best-known time: real upload time for fresh deliveries, artifact date
  // for legacy/bulk imports where the R2 timestamp only reflects a migration or move.
  const displayDate = f.displayDate || '';
  const dateTitle = timeTitle(f) ? ` title="${escAttr(timeTitle(f))}"` : '';
  const date =
    f.displaySource === 'missing'
      ? `<span class="file-date"${dateTitle}>—</span>`
      : displayDate
        ? `<span class="file-date"${dateTitle}>${esc(displayDate)}</span>`
        : '';
  const folder = f.folder || '';
  const category = String(folder).split('/')[0] || '';
  const search = `${f.title || ''} ${f.routePath || ''}`.toLowerCase();
  return `<li data-search="${esc(search)}" data-type="${esc(type)}" data-folder="${esc(folder)}" data-category="${escAttr(category)}" data-date="${esc(f.sortDate || '')}" data-artifact-date="${esc(f.artifactDate || '')}" data-title="${esc((f.title || '').toLowerCase())}">
        <a class="file-link" href="/${escAttr(f.routePath)}">
          <span class="badge badge-${esc(type)}">${esc(type.toUpperCase())}</span>
          <span class="file-title">${esc(f.title || f.routePath)}</span>
          ${date}
        </a>
      </li>`;
}

function renderTreeNodes(nodes, depth = 0) {
  return nodes
    .map((node) => {
      const filesHtml =
        node.files.length > 0
          ? `<ul class="file-list">${node.files.map(fileLi).join('\n')}</ul>`
          : '';
      const kids = node.children.length ? renderTreeNodes(node.children, depth + 1) : '';
      return `<details class="proj-group" data-folder="${escAttr(node.path)}" data-name="${escAttr(node.name.toLowerCase())}" data-date="${escAttr(node.date || '')}" data-depth="${depth}" style="--depth: ${depth}" open>
    <summary class="proj-group-title">
      <span class="grp-chevron" aria-hidden="true">▸</span>
      <span class="grp-name">${esc(node.name)}</span>
      <span class="grp-count">${node.count}</span>
    </summary>
    ${filesHtml}
    ${kids}
  </details>`;
    })
    .join('\n');
}

/**
 * Project file listing page.
 * @param {object} opts
 * @param {string} opts.project
 * @param {Array} opts.files
 * @param {boolean} opts.locked
 * @param {boolean} opts.ghost
 */
export function projectListingPage({ project, files, locked, ghost }) {
  const tree = buildTree(files || []);
  // Sort root-level files (recent first, name tiebreak) — same as old Astro listing.
  tree.files.sort((a, b) => {
    const da = a.sortDate || '';
    const db = b.sortDate || '';
    if (da !== db) return db.localeCompare(da);
    return (a.title || '').localeCompare(b.title || '');
  });
  const rootDate = tree.files.reduce((m, f) => ((f.sortDate || '') > m ? f.sortDate || '' : m), '');
  const folderHtml = tree.children.length ? renderTreeNodes(tree.children, 0) : '';
  const rootFilesHtml = tree.files.length
    ? `<details class="proj-group" data-folder="" data-name="" data-date="${escAttr(rootDate)}" data-depth="0" style="--depth: 0" open>
        <summary class="proj-group-title">
          <span class="grp-chevron" aria-hidden="true">▸</span>
          <span class="grp-name">(root)</span>
          <span class="grp-count">${tree.files.length}</span>
        </summary>
        <ul class="file-list">${tree.files.map(fileLi).join('\n')}</ul>
      </details>`
    : '';
  const treeHtml = (folderHtml + rootFilesHtml) || '<p class="no-results">No files in this project yet.</p>';

  // Category = top-level folder. The select filters the (already server-rendered) tree
  // client-side, so it works together with the text/type/sort controls without a round-trip.
  const categoryCounts = new Map();
  for (const file of files || []) {
    const key = String(file.folder || '').split('/')[0] || '';
    categoryCounts.set(key, (categoryCounts.get(key) || 0) + 1);
  }
  const categories = [...categoryCounts.entries()]
    .map(([key, count]) => ({
      value: key || '__root__',
      // Match the tree's CSS capitalize() so the option labels read like the folder groups.
      label: key ? key.charAt(0).toUpperCase() + key.slice(1) : '(Root)',
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const categoryOptions = [
    `<option value="">Category: all (${files.length})</option>`,
    ...categories.map(
      (category) =>
        `<option value="${escAttr(category.value)}">${esc(category.label)} (${category.count})</option>`,
    ),
  ].join('');

  const lockBadge = locked
    ? `<span class="lock"><span aria-hidden="true">🔒</span> Protected</span>`
    : '';
  const ghostBadge = ghost
    ? `<span class="lock"><span aria-hidden="true">👻</span> Ghost</span>`
    : '';
  const shareBtn = locked
    ? `<button class="share-link" type="button" data-share data-share-project="${escAttr(project)}" data-share-path="/${escAttr(encodeURIComponent(project))}/" data-tip="Create share link for this project">📤 Share</button>`
    : '';
  const signout = locked
    ? `<a class="signout" href="/logout?project=${escAttr(encodeURIComponent(project))}">⎋ Sign out</a>`
    : '';

  const body = `
    <header class="proj-head">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">🏠 Artifacts</a>
        <span class="crumb-sep" aria-hidden="true">/</span>
        <span class="proj-name">${esc(project)}</span>
        ${lockBadge}
        ${ghostBadge}
        ${shareBtn}
        ${signout}
      </nav>
      <h1 class="proj-h1">${esc(project)}</h1>
      <div class="proj-controls">
        <input type="search" class="proj-filter" data-proj-filter placeholder="Fuzzy filter files (title or folder path)…" aria-label="Filter files in this project" autocomplete="off" spellcheck="false">
        <select class="cat-select" data-cat-filter aria-label="Filter by category (top-level folder)" title="Filter by category (top-level folder)">
          ${categoryOptions}
        </select>
        <div class="type-chips" role="group" aria-label="Filter by type" data-type-filter>
          <button type="button" class="chip is-active" data-type="all">All</button>
          <button type="button" class="chip" data-type="md">MD</button>
          <button type="button" class="chip" data-type="html">HTML</button>
        </div>
        <div class="sort-chips" role="group" aria-label="Sort by" data-sort-filter>
          <button type="button" class="chip is-active" data-sort="recent" title="Most recently uploaded first">Recent</button>
          <button type="button" class="chip" data-sort="name">Name</button>
          <button type="button" class="chip" data-sort="type">Type</button>
        </div>
        <div class="expand-controls">
          <button type="button" class="chip" data-expand-all>Expand all</button>
          <button type="button" class="chip" data-collapse-all>Collapse all</button>
        </div>
      </div>
      <p class="count" data-filter-count>${files.length} file${files.length === 1 ? '' : 's'}</p>
    </header>
    <div class="proj-tree" data-proj-tree>
      ${treeHtml}
    </div>
    <p class="no-results" data-no-results hidden>No files match your filter.</p>
    ${locked ? shareModalHtml() : ''}
  `;

  return shellLayout({
    title: project,
    description: `Files in ${project}`,
    body,
    noindex: ghost,
  });
}

/** HTML artifact viewer — iframe of raw URL + toolbar. */
export function htmlViewerPage({ title, description, project, routePath, rawUrl, downloadName, time = null, locked, ghost }) {
  const body = `
    <div class="viewer-bleed">
      <iframe class="bleed-frame" src="${escAttr(rawUrl)}" title="${escAttr(title)}"></iframe>
    </div>
    ${viewerBar({ project, title, rawUrl, downloadName, type: 'html', time, locked, routePath })}
    ${locked ? shareModalHtml() : ''}
  `;
  return shellLayout({
    title,
    description,
    body,
    fullBleed: true,
    noindex: ghost,
  });
}

/** Markdown artifact viewer — edge-rendered body + toolbar + optional TOC + hljs. */
export function mdViewerPage({
  title,
  description,
  project,
  routePath,
  rawUrl,
  downloadName,
  date,
  tags,
  htmlBody,
  headings = [],
  time = null,
  locked,
  ghost,
}) {
  const tagHtml =
    Array.isArray(tags) && tags.length
      ? `<p class="tags" aria-label="Tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>`
      : '';
  const timeHtml = time
    ? timeBadge(time)
    : (date ? `<span class="date" title="Artifact date">${esc(date)}</span>` : '');

  // TOC from h2/h3 only (h1 is usually the page title).
  const tocHeadings = (Array.isArray(headings) ? headings : []).filter(
    (h) => h && (h.depth === 2 || h.depth === 3) && h.id && h.text,
  );
  const hasToc = tocHeadings.length > 0;
  const tocHtml = hasToc
    ? `<aside class="toc" aria-label="Table of contents">
        <p class="toc-title">On this page</p>
        <ul>
          ${tocHeadings
            .map(
              (h) =>
                `<li class="toc-d${h.depth}"><a href="#${escAttr(h.id)}">${esc(h.text)}</a></li>`,
            )
            .join('\n')}
        </ul>
      </aside>`
    : '';

  const headExtra = `
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css" media="(prefers-color-scheme: light)">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js" defer></script>`;

  const body = `
    <div class="md-shell">
      <article class="md-view">
        <header class="viewer-head">
          <p class="type-line">
            <span class="badge badge-md">MD</span>
            ${timeHtml}
          </p>
          <h1>${esc(title)}</h1>
          ${description ? `<p class="lede">${esc(description)}</p>` : ''}
          ${tagHtml}
        </header>
        <div class="md-layout" data-has-toc="${hasToc ? 'true' : 'false'}">
          ${tocHtml}
          <div class="md-body">${htmlBody}</div>
        </div>
      </article>
    </div>
    ${viewerBar({ project, title, rawUrl, downloadName, type: 'md', time, locked, routePath })}
    ${locked ? shareModalHtml() : ''}
  `;
  return shellLayout({
    title,
    description,
    body,
    fullBleed: true,
    noindex: ghost,
    headExtra,
  });
}

function viewerBar({ project, title, rawUrl, downloadName, type, time = null, locked, routePath }) {
  const proj = encodeURIComponent(project);
  const sharePath = routePath ? `/${routePath}` : `/${proj}`;
  const shareBtn = locked
    ? `<button class="vb-btn" type="button" data-share data-share-path="${escAttr(sharePath)}" data-share-project="${escAttr(project)}" data-tip="Create share link" aria-label="Create share link"><span aria-hidden="true">📤</span></button>`
    : '';
  const printBtn =
    type === 'md'
      ? `<button class="vb-btn" type="button" data-print data-tip="Print or save as PDF" aria-label="Print or save as PDF"><span aria-hidden="true">🖨</span></button>`
      : '';
  const signout = locked
    ? `<a class="vb-btn" href="/logout?project=${escAttr(proj)}" data-tip="Sign out of this project" aria-label="Sign out of this project"><span aria-hidden="true">⎋</span></a>`
    : '';

  const uploadedBadge = timeBadge(time, 'vb-uploaded');
  return `<header class="viewer-bar">
  <div class="vb-left">
    <a class="vb-btn" href="/${escAttr(proj)}" data-tip="Back to project" aria-label="Back to project"><span aria-hidden="true">←</span></a>
    <span class="vb-crumb">
      <span class="vb-proj">${esc(project)}</span>
      ${title ? `<span class="vb-sep" aria-hidden="true">/</span><span class="vb-title">${esc(title)}</span>` : ''}
    </span>
    ${uploadedBadge}
  </div>
  <div class="vb-right">
    <a class="vb-btn vb-primary" href="${escAttr(rawUrl)}" download="${escAttr(downloadName)}" data-tip="Download ${escAttr(downloadName)}" aria-label="Download ${escAttr(downloadName)}">
      <span aria-hidden="true">⬇</span><span class="vb-label">Download</span>
    </a>
    <button class="vb-btn" type="button" data-copy-link data-tip="Copy link to this artifact" aria-label="Copy link to this artifact">
      <span aria-hidden="true">🔗</span>
    </button>
    ${shareBtn}
    <a class="vb-btn" href="${escAttr(rawUrl)}" target="_blank" rel="noopener" data-tip="Open raw file in a new tab" aria-label="Open raw file in a new tab">
      <span aria-hidden="true">⤢</span>
    </a>
    ${printBtn}
    <a class="vb-btn" href="/" data-tip="Home — all projects" aria-label="Home — all projects">
      <span aria-hidden="true">🏠</span>
    </a>
    ${signout}
  </div>
</header>`;
}

function shareModalHtml() {
  return `<div class="share-overlay" id="share-modal" hidden>
  <div class="share-card" role="dialog" aria-modal="true" aria-labelledby="share-title">
    <button class="share-close" type="button" data-share-close aria-label="Close">×</button>
    <h2 id="share-title">Create share link</h2>
    <p class="share-lede">Anyone with this link can view this project without a password.</p>
    <div class="share-ttl-row">
      <label class="share-label" for="share-ttl">Link duration</label>
      <select class="share-select" id="share-ttl" data-share-ttl>
        <option value="24h">24 hours</option>
        <option value="7d">7 days</option>
        <option value="30d" selected>30 days</option>
        <option value="180d">180 days</option>
      </select>
    </div>
    <div class="share-url-row" data-share-result hidden>
      <input class="share-url-input" id="share-url" readonly aria-label="Share URL">
      <button class="btn btn-primary share-copy-btn" type="button" data-share-copy>Copy</button>
    </div>
    <p class="share-error" data-share-error hidden></p>
    <button class="btn btn-primary share-generate-btn" type="button" data-share-generate>Generate link</button>
    <p class="share-note">The chosen duration controls both link validity and how long the recipient's access lasts. Changing the project password or rotating the site secret revokes outstanding links; individual revocation is not supported.</p>
  </div>
</div>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}
