// HTML shell templates for Function-served content pages.
// Links non-hashed /assets/site.css + /assets/viewer.js so the thin Astro shell
// and edge-rendered pages share one stylesheet.
// ASSET_V busts CDN/browser cache when shell assets change (max-age on /assets/*).
//
// Markup contract: design/prototype.html. Shared primitives (icon sprite, pre-paint theme
// bootstrap, global popovers) live in functions/_ui.js; category helpers in functions/_store.js.

import {
  ICON_SPRITE,
  THEME_BOOTSTRAP,
  DEFAULT_THEME,
  icon,
  themePickerButton,
  shellChrome,
} from './_ui.js';
import {
  categoryMode,
  categorySummary,
  entryCategories,
  categoryLabel,
} from './_store.js';

export const ASSET_V = '2674d74f';

const SITE_HOST = 'artifacts.hoangtrung.dev';

/**
 * Shared document shell. Deliberately neutral: it does NOT wrap the page body in a landmark —
 * every page provides exactly one <main> (listing .page, reader .reader, viewer .viewer-main,
 * login/ghost-auth .login-wrap).
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {string} opts.body
 * @param {boolean} [opts.fullBleed]
 * @param {string} [opts.bodyClass] extra body classes (e.g. "has-rev" for a pinned revision)
 * @param {boolean} [opts.noindex]
 * @param {boolean} [opts.includeViewerJs]
 * @param {string} [opts.headExtra] extra tags in <head> (e.g. highlight.js)
 */
export function shellLayout({
  title,
  description = '',
  body,
  fullBleed = false,
  bodyClass = '',
  noindex = false,
  includeViewerJs = true,
  headExtra = '',
}) {
  const desc = description
    ? `<meta name="description" content="${esc(description)}">`
    : '';
  const robots = noindex ? `<meta name="robots" content="noindex">` : '';
  const bodyClasses = [fullBleed ? 'bleed' : '', bodyClass].filter(Boolean).join(' ');
  const bodyAttr = bodyClasses ? ` class="${bodyClasses}"` : '';
  const viewerJs = includeViewerJs
    ? `<script src="/assets/viewer.js?v=${ASSET_V}" defer></script>`
    : '';

  return `<!doctype html>
<html lang="en" data-theme="${DEFAULT_THEME}" data-scheme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0a1119">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script>${THEME_BOOTSTRAP}</script>
  <link rel="stylesheet" href="/assets/site.css?v=${ASSET_V}">
  ${headExtra}
  <title>${esc(title)}</title>
  ${desc}
  ${robots}
</head>
<body${bodyAttr}>
  ${ICON_SPRITE}
  ${body}
  ${shellChrome()}
  ${viewerJs}
</body>
</html>`;
}

/* ------------------------------------------------------------------ helpers */

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-25T09:12:00.000Z" | "2026-09-25" → "25 Sep 2026" (stable, UTC-based). */
function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function artifactCount(n) {
  return `${n} artifact${n === 1 ? '' : 's'}`;
}

function encodeProject(project) {
  return encodeURIComponent(String(project || ''));
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

function dateSpan(f, className = 'file-date') {
  const title = timeTitle(f);
  const titleAttr = title ? ` title="${escAttr(title)}"` : '';
  if (f.displaySource === 'missing') return `<span class="${className}"${titleAttr}>—</span>`;
  const display = formatDate(f.displayDate);
  // Always emit the cell so the row grid keeps its columns even when no timestamp exists.
  return `<span class="${className}"${titleAttr}>${display ? esc(display) : '—'}</span>`;
}

function brandTopbar(actions = themePickerButton(), pill = '') {
  return `<header class="topbar" data-topbar>
  <div class="topbar-inner">
    <a class="brand" href="/" aria-label="Artifacts — home">
      <span class="brand-mark" aria-hidden="true">A</span>
      <span>Artifacts</span>
      <span class="brand-host">${SITE_HOST}</span>
    </a>
    ${pill}
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">${actions}</div>
  </div>
</header>`;
}

/** Theme trigger for viewer/reader bars: same primitive, plus .bar-secondary so mobile hides it. */
function barThemeButton() {
  return `<button class="icon-btn bar-secondary" type="button" data-theme-picker data-tip="Theme" aria-label="Choose theme" aria-haspopup="listbox" aria-expanded="false">${icon('contrast')}</button>`;
}

function modePill() {
  return `<span class="mode-pill">${icon('ghost')} Ghost mode</span>`;
}

function skipLink(id) {
  return `<a class="skip-link" href="#${id}">Skip to content</a>`;
}

/* -------------------------------------------------------------- file rows */

/** One artifact row (li carries the viewer.js filter/sort dataset). */
function fileRow(f, mode) {
  const type = f.type === 'md' ? 'md' : 'html';
  const cats = entryCategories(f, mode);
  const categoryLabelText = cats.map((slug) => categoryLabel(slug)).join(', ');
  const search = [f.title, f.routePath, f.description, f.folder, ...cats]
    .join(' ')
    .toLowerCase();
  const description = f.description
    ? `<span class="file-desc">${esc(f.description)}</span>`
    : '';
  return `<li data-search="${escAttr(search)}" data-type="${type}" data-cats="${escAttr(cats.join(' '))}" data-category-label="${escAttr(categoryLabelText)}" data-date="${escAttr(f.sortDate || '')}" data-artifact-date="${escAttr(f.artifactDate || '')}" data-title="${escAttr((f.title || '').toLowerCase())}">
        <a class="file-row" href="/${escAttr(f.routePath)}">
          <span class="type-tag">${type.toUpperCase()}</span>
          <span class="file-main">
            <span class="file-title">${esc(f.title || f.routePath)}</span>
            ${description}
          </span>
          <span class="file-cat">${esc(categoryLabel(cats[0] || 'general'))}</span>
          ${dateSpan(f)}
          ${icon('chevron-right', 'icon chev')}
        </a>
      </li>`;
}

function fileList(items, mode) {
  return `<ul class="file-list">
${items.map((item) => fileRow(item, mode)).join('\n')}
</ul>`;
}

/* ------------------------------------------------------------- folder tree */

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
        node.children.set(part, {
          name: part,
          path: curPath,
          files: [],
          children: new Map(),
          count: 0,
          date: '',
        });
      }
      node = node.children.get(part);
    }
    node.files.push(it);
  }
  const finalize = (node) => {
    const kids = [...node.children.values()].map(finalize);
    const dates = [...node.files.map((f) => f.sortDate || ''), ...kids.map((c) => c.date)].filter(
      Boolean,
    );
    node.date = dates.length ? dates.reduce((m, d) => (d > m ? d : m)) : '';
    kids.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
    node.files.sort((a, b) => {
      const da = a.sortDate || '';
      const db = b.sortDate || '';
      if (da !== db) return db.localeCompare(da);
      return (a.title || '').localeCompare(b.title || '');
    });
    node.children = kids;
    node.count = node.files.length + kids.reduce((sum, child) => sum + child.count, 0);
    return node;
  };
  return finalize(root);
}

/** Folder group: <details> with data-folder/data-depth; nested groups stay inside the parent. */
function folderGroup(node, depth, mode) {
  const files = node.files.length ? fileList(node.files, mode) : '';
  const children = node.children
    .map((child) => folderGroup(child, depth + 1, mode))
    .join('\n');
  return `<details class="proj-group" data-folder="${escAttr(node.path)}" data-depth="${depth}" style="--depth: ${depth}" open>
      <summary class="proj-group-title">
        ${icon('chevron-right', 'icon grp-chevron')}
        <span class="grp-name">${esc(node.name)}</span>
        <span class="grp-count">${node.count}</span>
      </summary>
      ${files}
      ${children}
    </details>`;
}

/* ---------------------------------------------------------------- topbars */

function projectTopbar(project, locked) {
  const share = locked
    ? `<button class="btn" type="button" data-share data-share-project="${escAttr(project)}" data-share-path="/${escAttr(encodeProject(project))}/" data-tip="Create share link" aria-label="Create share link">${icon('share')}<span>Share</span></button>`
    : '';
  const signout = locked
    ? `<a class="icon-btn" href="/logout?project=${escAttr(encodeProject(project))}" data-tip="Sign out" aria-label="Sign out">${icon('logout')}</a>`
    : '';
  return `<header class="topbar" data-topbar>
  <div class="topbar-inner">
    <a class="icon-btn" href="/" data-tip="All projects" aria-label="All projects">${icon('arrow-left')}</a>
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Artifacts</a>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <span class="crumb-current crumb-project" aria-current="page">${esc(project)}</span>
    </nav>
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">${share}${signout}${themePickerButton()}</div>
  </div>
</header>`;
}

function barMeta(type, date, readMinutes, time = null) {
  const parts = [`<span class="bar-type">${type.toUpperCase()}</span>`];
  if (date) {
    const provenance = time ? timeTitle(time) : '';
    const titleAttr = provenance ? ` title="${escAttr(provenance)}"` : '';
    parts.push(`<span class="bar-dot">·</span><span${titleAttr}>${esc(date)}</span>`);
  }
  if (readMinutes) parts.push(`<span class="bar-dot">·</span><span>${readMinutes} min read</span>`);
  return `<span class="bar-meta">${parts.join('')}</span>`;
}

/**
 * Viewer/reader 48px bar: identity cluster (back, crumb, meta), spacer, action cluster
 * (neutral Download, copy, share-if-locked, theme, More).
 */
function viewerBar({
  project,
  title,
  routePath,
  rawUrl,
  downloadName,
  type,
  time,
  locked,
  reader = false,
  readMinutes = 0,
  displayDate = '',
  review = null,
}) {
  const projHref = `/${escAttr(encodeProject(project))}/`;
  const sharePath = routePath ? `/${escAttr(routePath)}` : projHref;
  const downloadLabel = type === 'md' ? 'markdown' : 'HTML';
  const date = displayDate || formatDate(time?.displayDate || time?.artifactDate || '');

  const crumbs = reader
    ? `<nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Artifacts</a>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <a class="crumb-project" href="${projHref}">${esc(project)}</a>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <span class="crumb-current" aria-current="page">${esc(title)}</span>
    </nav>`
    : `<nav class="crumbs" aria-label="Breadcrumb">
      <a class="crumb-project" href="${projHref}">${esc(project)}</a>
      <span class="crumb-sep" aria-hidden="true">/</span>
      <span class="crumb-current" aria-current="page">${esc(title)}</span>
    </nav>`;

  const share = locked
    ? `<button class="icon-btn" type="button" data-share data-share-path="${sharePath}" data-share-project="${escAttr(project)}" data-tip="Create share link" aria-label="Create share link">${icon('share')}</button>`
    : '';
  const signoutAttr = locked
    ? ` data-signout-url="/logout?project=${escAttr(encodeProject(project))}"`
    : '';
  // Only the HTML viewer exposes "Open raw file" (the MD reader's More menu prints instead).
  const rawAttr = type === 'html' ? ` data-raw-url="${escAttr(rawUrl)}"` : '';

  return `<header class="topbar viewer-topbar" data-topbar>
  <div class="topbar-inner">
    <a class="icon-btn" href="${projHref}" data-tip="Back to project" aria-label="Back to project">${icon('arrow-left')}</a>
    ${crumbs}
    ${barMeta(type, date, readMinutes, time)}
    <span class="topbar-spacer"></span>
    <div class="topbar-actions bar-actions">
      <a class="btn bar-download" href="${escAttr(rawUrl)}" download="${escAttr(downloadName)}" data-tip="Download the ${downloadLabel} file" aria-label="Download the ${downloadLabel} file">${icon('download')}<span>Download</span></a>
      ${review ? versionsBarButton(review) : ''}
      ${review ? reviewBarButton() : ''}
      <button class="icon-btn bar-secondary" type="button" data-copy data-tip="Copy link" aria-label="Copy link">${icon('link')}</button>
      ${share}
      ${barThemeButton()}
      <button class="icon-btn" type="button" data-more data-tip="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="false"${rawAttr}${signoutAttr}>${icon('more')}</button>
    </div>
  </div>
  ${reader ? '<div class="read-progress" aria-hidden="true"><i id="read-progress-bar"></i></div>' : ''}
</header>`;
}

/* ------------------------------------------------------------ listing page */

/**
 * Compact category dropdown for the project tools row. Rendered only when the project has more
 * than one category. In folder mode Root ("no category", folder === '') is always listed first
 * after All — even at count 0 — and the remaining categories follow by count. Keyword-mode
 * projects have no Root entry; their categories are all keyword slugs.
 */
function categoryFilterHtml(list, categories, mode) {
  if (categories.length < 2) return '';
  const isFolderMode = mode === 'folder';
  const root = isFolderMode ? categories.find((category) => category.slug === 'root') : null;
  const options = [
    `<button type="button" class="cat-option" data-cat="all" aria-pressed="true">All <span class="cat-count">${list.length}</span></button>`,
    isFolderMode
      ? `<button type="button" class="cat-option" data-cat="root" aria-pressed="false">Root <span class="cat-count">${root ? root.count : 0}</span></button>`
      : '',
    ...categories
      .filter((category) => !(isFolderMode && category.slug === 'root'))
      .map(
        (category) =>
          `<button type="button" class="cat-option" data-cat="${escAttr(category.slug)}" aria-pressed="false">${esc(category.label)} <span class="cat-count">${category.count}</span></button>`,
      ),
  ].filter(Boolean);

  return `<div class="cat-filter" data-cat-filter>
        <button class="cat-trigger" type="button" data-cat-trigger aria-expanded="false" aria-haspopup="true">
          ${icon('chevron-down')}
          <span data-cat-label>Category: All</span>
        </button>
        <div class="cat-popover" data-cat-popover hidden>
          <p class="micro">Category</p>
          <div class="cat-options" data-cat-chips role="group" aria-label="Filter by category">
            ${options.join('\n            ')}
          </div>
        </div>
      </div>`;
}

/** Expand/collapse-all controls; only meaningful when the project has folders. */
function treeControlsHtml(list) {
  const hasFolders = list.some((file) => String(file.folder || '').trim());
  if (!hasFolders) return '';
  return `<span class="spacer"></span>
      <div class="tree-controls" data-tree-controls>
        <button class="icon-btn" type="button" data-expand-all data-tip="Expand all folders" aria-label="Expand all folders">${icon('chevrons-down')}</button>
        <button class="icon-btn" type="button" data-collapse-all data-tip="Collapse all folders" aria-label="Collapse all folders">${icon('chevrons-up')}</button>
      </div>`;
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
  const list = Array.isArray(files) ? files : [];
  const mode = categoryMode(list);
  const tree = buildTree(list);
  // Root-level files render directly (no "(root)" group), most recent first.
  tree.files.sort((a, b) => {
    const da = a.sortDate || '';
    const db = b.sortDate || '';
    if (da !== db) return db.localeCompare(da);
    return (a.title || '').localeCompare(b.title || '');
  });

  const trees = [
    ...tree.children.map((child) => folderGroup(child, 0, mode)),
    tree.files.length ? fileList(tree.files, mode) : '',
  ]
    .filter(Boolean)
    .join('\n');

  const latest = list.reduce((max, file) => ((file.sortDate || '') > max ? file.sortDate : max), '');
  const updated = formatDate(latest);
  const meta = [
    `<span>${artifactCount(list.length)}</span>`,
    updated ? `<span class="sep"></span><span>Updated ${esc(updated)}</span>` : '',
  ]
    .filter(Boolean)
    .join('\n        ');

  const categories = categorySummary(list);
  const categoryFilter = categoryFilterHtml(list, categories, mode);
  const treeControls = treeControlsHtml(list);

  const emptyText = list.length ? 'No artifacts match this filter.' : 'No artifacts in this project yet.';
  const body = `${skipLink('main-project')}
${projectTopbar(project, locked)}
<main class="page" id="main-project" tabindex="-1">
  <header class="project-head">
    <h1>${esc(project)}</h1>
    <div class="project-meta">
        ${meta}
    </div>

    <div class="project-tools">
      <label class="search">
        ${icon('search')}
        <input id="project-search" type="search" data-proj-filter placeholder="Filter artifacts…" autocomplete="off" spellcheck="false" aria-label="Filter artifacts in this project">
        <span class="kbd" aria-hidden="true">/</span>
      </label>
      <div class="segmented" role="group" aria-label="Filter by type" data-type-filter>
        <button type="button" data-type="all" aria-pressed="true">All</button>
        <button type="button" data-type="html" aria-pressed="false">HTML</button>
        <button type="button" data-type="md" aria-pressed="false">MD</button>
      </div>
      <label class="select-wrap">
        <span class="sr-only">Sort artifacts</span>
        <select class="select" id="project-sort" data-sort-filter>
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
        </select>
        ${icon('chevron-down')}
      </label>
      ${categoryFilter}
      ${treeControls}
    </div>
  </header>

  <section class="file-index" aria-labelledby="files-label">
    <div class="section-head">
      <h2 class="micro" id="files-label">All artifacts</h2>
      <span class="section-meta" id="project-count" data-filter-count aria-live="polite">${artifactCount(list.length)}</span>
    </div>
    <div data-proj-tree>
      ${trees}
    </div>
    <p class="empty-state" data-no-results${list.length ? ' hidden' : ''}>${icon('inbox')}<br><span data-no-results-text>${emptyText}</span></p>
  </section>

  <footer class="site-footer">
    <span>${artifactCount(list.length)} in this project.</span>
    <span aria-hidden="true">·</span>
    <a href="/">All projects</a>
  </footer>
</main>
${locked ? shareModalHtml(project) : ''}`;

  return shellLayout({
    title: project,
    description: `Files in ${project}`,
    body,
    noindex: ghost,
  });
}

/* ---------------------------------------------------------------- review UI */

/**
 * Review context for the current viewer/reader page. `artifact`/`revision` are optional and
 * only supplied once the revision registry exists (backend-contract.md §4), so legacy
 * artifacts render the same review UI with path-derived context and no version history.
 */
function reviewContext({ project, routePath, rawUrl, title, type, artifact = null, revision = null }) {
  const file =
    (artifact && artifact.file) ||
    (rawUrl ? String(rawUrl).replace(/^\/+/, '').replace(/^[^/]+\//, '') : '');
  const hasRevision = !!(revision && revision.revisionId);
  return {
    artifactId: (artifact && artifact.artifactId) || '',
    project: (artifact && artifact.project) || project || '',
    file,
    route: (artifact && artifact.routePath) || routePath || '',
    title: title || '',
    type: type === 'md' ? 'md' : 'html',
    revisionId: hasRevision ? revision.revisionId : '',
    revisionNumber: hasRevision ? revision.number || '' : '',
    revisionTotal: hasRevision ? revision.total || '' : '',
    revisionLatestNumber: hasRevision ? revision.latestNumber || '' : '',
    hasRevision,
    isLatest: hasRevision ? revision.isLatest !== false : true,
  };
}

function versionsBarButton(review) {
  const known = !!(review && review.hasRevision);
  return `<button class="icon-btn bar-history" type="button" data-versions-toggle data-tip="Version history" aria-label="Version history" aria-haspopup="dialog" aria-controls="versions-modal"${
    known ? '' : ' hidden'
  }>${icon('history')}</button>`;
}

function reviewBarButton() {
  return `<button class="icon-btn bar-feedback" type="button" data-review-toggle data-tip="Feedback" aria-label="Feedback" aria-haspopup="dialog" aria-controls="review-panel" aria-expanded="false">${icon('comment')}<span class="review-badge" data-review-badge hidden></span></button>`;
}

function reviewDataAttrs(ctx) {
  return [
    `data-review-project="${escAttr(ctx.project)}"`,
    `data-review-file="${escAttr(ctx.file)}"`,
    `data-review-route="${escAttr(ctx.route)}"`,
    `data-review-title="${escAttr(ctx.title)}"`,
    `data-review-artifact="${escAttr(ctx.artifactId)}"`,
    `data-review-revision="${escAttr(ctx.revisionId)}"`,
    `data-review-revision-number="${escAttr(ctx.revisionNumber)}"`,
    `data-review-is-latest="${ctx.hasRevision ? (ctx.isLatest ? 'true' : 'false') : ''}"`,
  ].join('\n  ');
}

/** Read-only "viewing revision N of M" banner; absent for latest and legacy artifacts. */
function revisionBannerHtml(ctx) {
  if (!ctx.hasRevision || ctx.isLatest) return '';
  return `<div class="rev-banner" data-rev-banner role="status">
  <span class="rev-banner-text">${icon('history')}<span>Viewing revision ${esc(ctx.revisionNumber)} of ${esc(ctx.revisionTotal)} — latest is v${esc(ctx.revisionLatestNumber)}</span></span>
  <a class="rev-banner-link" href="/${escAttr(ctx.route)}">Back to latest</a>
</div>`;
}

function versionsDialogHtml() {
  return `<div class="modal-overlay review-versions" id="versions-modal" data-versions-modal hidden>
  <div class="modal-card versions-card" role="dialog" aria-modal="true" aria-labelledby="versions-title" tabindex="-1" data-versions-card>
    <div class="modal-head">
      <div>
        <h2 id="versions-title">Version history</h2>
        <p class="modal-lede">Every publish is kept. Older revisions are read-only.</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-versions-close aria-label="Close" data-tip="Close">${icon('close')}</button>
    </div>
    <div class="versions-body">
      <div class="skeleton-list versions-loading" data-versions-loading hidden aria-hidden="true">
        <div class="skeleton-row skeleton-row--proj"><span class="sk"></span><span class="sk sk--short"></span></div>
        <div class="skeleton-row skeleton-row--proj"><span class="sk"></span><span class="sk sk--short"></span></div>
      </div>
      <p class="versions-error" data-versions-error role="alert" hidden></p>
      <ol class="version-list" data-versions-list></ol>
      <p class="versions-empty" data-versions-empty hidden>No published revisions yet for this artifact.</p>
    </div>
  </div>
</div>`;
}

/**
 * Review sidebar/sheet, selection popover and mobile reopen pill. Server-rendered so the
 * shell owns the layout contract; viewer.js only fills user text (textContent) at runtime.
 */
function reviewUiHtml(ctx) {
  return `<aside class="review-panel" id="review-panel" role="dialog" aria-modal="false" aria-labelledby="review-panel-title" tabindex="-1" hidden
  ${reviewDataAttrs(ctx)}>
  <header class="review-head">
    <div class="review-head-main">
      <p class="micro">Review</p>
      <h2 class="review-title" id="review-panel-title">Feedback</h2>
      <p class="review-hint" data-review-hint hidden>Select text in the artifact to add feedback.</p>
    </div>
    <div class="review-head-actions">
      <button class="icon-btn review-document-action" type="button" data-review-document-action aria-label="Comment on whole document" data-tip="Comment on whole document" hidden>${icon('comment')}</button>
      <button class="icon-btn review-back" type="button" data-review-back aria-label="Back to selection" data-tip="Back to selection">${icon('chevron-down')}</button>
      <button class="icon-btn" type="button" data-review-close aria-label="Close feedback" data-tip="Close">${icon('close')}</button>
    </div>
  </header>
  <div class="review-filters">
    <div class="segmented review-status" role="group" aria-label="Filter feedback by status" data-review-status>
      <button type="button" data-review-filter="open" aria-pressed="true">Open<span class="review-count" data-review-count="open">0</span></button>
      <button type="button" data-review-filter="addressed" aria-pressed="false">Addressed<span class="review-count" data-review-count="addressed">0</span></button>
      <button type="button" data-review-filter="resolved" aria-pressed="false">Resolved<span class="review-count" data-review-count="resolved">0</span></button>
    </div>
    <label class="review-scope" data-review-scope-wrap hidden><input type="checkbox" data-review-scope> <span>All revisions</span></label>
  </div>
  <p class="review-note" data-review-note hidden></p>
  <p class="review-note review-frame-note" data-review-frame-note hidden>This embedded page navigated away from the artifact. Reload to add feedback.</p>
  <p class="sr-only" data-review-live aria-live="polite"></p>
  <div class="review-body" data-review-body>
    <div class="skeleton-list review-loading" data-review-loading hidden aria-hidden="true">
      <div class="skeleton-row"><span class="sk sk--short"></span></div>
      <div class="skeleton-row"><span class="sk"></span></div>
      <div class="skeleton-row"><span class="sk sk--short"></span></div>
    </div>
    <div class="review-state" data-review-error role="alert" hidden>
      ${icon('alert')}
      <p data-review-error-text></p>
      <button class="btn" type="button" data-review-retry>Retry</button>
    </div>
    <div class="review-state" data-review-empty hidden>
      ${icon('comment')}
      <p data-review-empty-text></p>
      <button class="btn" type="button" data-review-document-empty hidden>${icon('comment')}<span>Comment on whole document</span></button>
    </div>
    <ol class="thread-list" data-review-list></ol>
  </div>
  <form class="review-composer" data-review-composer hidden novalidate>
    <p class="micro review-composer-kicker" data-review-composer-kicker>New comment</p>
    <blockquote class="review-quote" data-review-composer-quote></blockquote>
    <div class="review-kind" role="group" aria-label="Feedback type" data-review-kind hidden>
      <button type="button" data-review-kind-value="comment" aria-pressed="true">Comment</button>
      <button type="button" data-review-kind-value="replace" aria-pressed="false">Replace</button>
      <button type="button" data-review-kind-value="remove" aria-pressed="false">Remove</button>
    </div>
    <label class="sr-only" for="review-author">Your name (optional)</label>
    <input class="review-input review-name" id="review-author" data-review-name type="text" maxlength="80" placeholder="Your name (optional)" autocomplete="nickname" hidden>
    <label class="sr-only" for="review-body-input">Feedback</label>
    <textarea class="review-input" id="review-body-input" data-review-input rows="4" maxlength="8000" placeholder="Write feedback…"></textarea>
    <label class="sr-only" for="review-replacement">Suggested replacement</label>
    <textarea class="review-input" id="review-replacement" data-review-replacement rows="3" maxlength="8000" placeholder="Suggested replacement…" hidden></textarea>
    <p class="review-form-error" data-review-form-error role="alert" hidden></p>
    <div class="review-composer-actions">
      <button class="btn" type="button" data-review-cancel>Cancel</button>
      <button class="btn btn--primary" type="submit" data-review-submit>Add comment</button>
    </div>
    <p class="review-composer-hint">Ctrl/Cmd + Enter to submit</p>
  </form>
  <footer class="review-foot" data-review-foot hidden>
    <div class="segmented review-format" role="group" aria-label="Export format">
      <button type="button" data-review-format="md" aria-pressed="true">MD</button>
      <button type="button" data-review-format="json" aria-pressed="false">JSON</button>
    </div>
    <span class="review-foot-spacer"></span>
    <button class="btn review-foot-btn" type="button" data-review-copy>${icon('link')}<span>Copy</span></button>
    <button class="btn review-foot-btn" type="button" data-review-download>${icon('download')}<span>Download</span></button>
  </footer>
</aside>
<div class="review-scrim" data-review-scrim hidden></div>
<div class="review-popover" data-review-popover role="toolbar" aria-label="Add feedback" hidden>
  <button class="review-pop-btn" type="button" data-review-kind="comment">Comment</button>
  <button class="review-pop-btn" type="button" data-review-kind="replace">Replace</button>
  <button class="review-pop-btn" type="button" data-review-kind="remove">Remove</button>
</div>
<form class="review-inline" data-review-inline hidden novalidate>
  <div class="review-inline-head">
    <p class="micro review-inline-kicker" data-review-inline-kicker>New comment</p>
    <button class="icon-btn review-inline-close" type="button" data-review-inline-close aria-label="Cancel feedback" data-tip="Cancel">${icon('close')}</button>
  </div>
  <blockquote class="review-quote review-inline-quote" data-review-inline-quote></blockquote>
  <label class="sr-only" for="review-inline-name">Your name (optional)</label>
  <input class="review-input review-name" id="review-inline-name" data-review-inline-name type="text" maxlength="80" placeholder="Your name (optional)" autocomplete="nickname">
  <label class="sr-only" for="review-inline-body">Feedback</label>
  <textarea class="review-input" id="review-inline-body" data-review-inline-body rows="3" maxlength="8000" placeholder="Write feedback…"></textarea>
  <label class="sr-only" for="review-inline-replacement">Suggested replacement</label>
  <textarea class="review-input" id="review-inline-replacement" data-review-inline-replacement rows="2" maxlength="8000" placeholder="Suggested replacement…" hidden></textarea>
  <p class="review-form-error" data-review-inline-error role="alert" hidden></p>
  <div class="review-inline-actions">
    <button class="btn" type="button" data-review-inline-cancel>Cancel</button>
    <button class="btn btn--primary" type="submit" data-review-inline-submit>Add comment</button>
  </div>
</form>
<div class="review-thread-pop" data-review-thread-pop role="dialog" aria-label="Comment thread" tabindex="-1" hidden>
  <div class="review-thread-pop-head">
    <span class="review-thread-pop-chips" data-review-thread-pop-chips></span>
    <button class="icon-btn review-inline-close" type="button" data-review-thread-pop-close aria-label="Close thread" data-tip="Close">${icon('close')}</button>
  </div>
  <blockquote class="review-quote review-thread-pop-quote" data-review-thread-pop-quote></blockquote>
  <p class="thread-meta" data-review-thread-pop-meta></p>
  <div class="review-thread-pop-body" data-review-thread-pop-body></div>
  <ol class="review-thread-pop-replies" data-review-thread-pop-replies></ol>
  <p class="review-form-error" data-review-thread-pop-error role="alert" hidden></p>
  <form class="review-thread-pop-reply" data-review-thread-pop-reply hidden>
    <label class="sr-only" for="review-thread-reply">Reply</label>
    <textarea class="review-input" id="review-thread-reply" data-review-thread-pop-input rows="2" maxlength="8000" placeholder="Reply…"></textarea>
    <div class="review-inline-actions">
      <button class="btn btn--primary" type="submit" data-review-thread-pop-send>Reply</button>
    </div>
  </form>
  <div class="review-thread-pop-actions">
    <span class="review-thread-pop-actions-main" data-review-thread-pop-actions></span>
    <button class="btn review-thread-pop-open" type="button" data-review-thread-pop-open>Open in panel</button>
  </div>
</div>
<button class="review-pill" data-review-pill type="button" hidden>${icon('comment')}<span data-review-pill-text>Feedback</span></button>
${versionsDialogHtml()}`;
}

/* -------------------------------------------------------------- HTML viewer */

/** HTML artifact viewer — full-bleed iframe of the raw URL behind the 48px bar. */
export function htmlViewerPage({
  title,
  description,
  project,
  routePath,
  rawUrl,
  downloadName,
  time = null,
  locked,
  ghost,
  artifact = null,
  revision = null,
}) {
  const ctx = reviewContext({ project, routePath, rawUrl, title, type: 'html', artifact, revision });
  const banner = revisionBannerHtml(ctx);
  const body = `${skipLink('main-viewer')}
${viewerBar({ project, title, routePath, rawUrl, downloadName, type: 'html', time, locked, review: ctx })}
${banner}
<main class="viewer-main" id="main-viewer" tabindex="-1">
  <iframe class="viewer-frame" src="${escAttr(rawUrl)}" title="${escAttr(title)}"></iframe>
</main>
${reviewUiHtml(ctx)}
${locked ? shareModalHtml(project) : ''}`;

  return shellLayout({
    title,
    description,
    body,
    fullBleed: true,
    bodyClass: banner ? 'has-rev' : '',
    noindex: ghost,
  });
}

/* ---------------------------------------------------------------- MD reader */

/** Strip a leading <h1> from rendered Markdown (the shell renders the title instead). */
function stripLeadingH1(html) {
  return String(html || '').replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '');
}

/** Rough read time in minutes (~220 wpm) from the rendered body; 0 when there is no text. */
function readMinutesFor(html) {
  const text = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 0;
  const words = text.split(' ').length;
  return Math.max(1, Math.round(words / 220));
}

function tocItems(headings) {
  // First entry starts marked, as in the prototype; the client scrollspy takes over on scroll.
  return headings
    .map(
      (h, index) =>
        `<li><a href="#${escAttr(h.id)}" data-toc-link${index === 0 ? ' aria-current="true"' : ''}>${esc(h.text)}</a></li>`,
    )
    .join('\n');
}

/** Markdown artifact reader — edge-rendered body + 48px bar + progress + TOC. */
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
  artifact = null,
  revision = null,
}) {
  const reviewCtx = reviewContext({ project, routePath, rawUrl, title, type: 'md', artifact, revision });
  const reviewBanner = revisionBannerHtml(reviewCtx);
  const bodyHtml = stripLeadingH1(htmlBody);
  const tocHeadings = (Array.isArray(headings) ? headings : []).filter(
    (h) => h && (h.depth === 2 || h.depth === 3) && h.id && h.text,
  );
  const hasToc = tocHeadings.length > 0;
  const tocList = hasToc
    ? `<ul>
${tocItems(tocHeadings)}
      </ul>`
    : '';

  const tocHtml = hasToc
    ? `<aside class="toc" aria-label="Table of contents">
        <p class="micro">On this page</p>
        ${tocList}
      </aside>`
    : '';
  const tocMobile = hasToc
    ? `<details class="toc-mobile">
          <summary><span>On this page</span>${icon('chevron-down')}</summary>
          ${tocList}
        </details>`
    : '';

  const readMinutes = readMinutesFor(bodyHtml);
  const shownDate = formatDate(time?.displayDate || time?.artifactDate || date || '');
  const kickerParts = [`<span class="type-tag">MD</span>`];
  if (shownDate) kickerParts.push(`<span>${esc(shownDate)}</span>`);
  if (readMinutes) {
    kickerParts.push(
      `<span aria-hidden="true">·</span><span>${readMinutes} min read</span>`,
    );
  }
  const tagHtml =
    Array.isArray(tags) && tags.length
      ? `<p class="tags" aria-label="Tags">${tags
          .map((tag) => `<span class="tag">${esc(tag)}</span>`)
          .join('')}</p>`
      : '';

  const headExtra = `
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css" media="(prefers-color-scheme: light)">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js" defer></script>`;

  const body = `${skipLink('main-reader')}
${viewerBar({ project, title, routePath, rawUrl, downloadName, type: 'md', time, locked, reader: true, readMinutes, displayDate: shownDate, review: reviewCtx })}
${reviewBanner}
<main class="reader" id="main-reader" tabindex="-1">
  <div class="reader-grid">
    ${tocHtml}
    <article>
      <header class="reader-head">
        <p class="reader-kicker">${kickerParts.join('\n          ')}</p>
        <h1>${esc(title)}</h1>
        ${description ? `<p class="reader-lede">${esc(description)}</p>` : ''}
        ${tagHtml}
        <div class="reader-meta">
          <span>${esc(project)}</span>
          <span aria-hidden="true">·</span>
          <span>Markdown</span>
        </div>
      </header>

      ${tocMobile}

      <div class="reader-body">${bodyHtml}</div>
    </article>
  </div>
</main>
${reviewUiHtml(reviewCtx)}
${locked ? shareModalHtml(project) : ''}`;

  return shellLayout({
    title,
    description,
    body,
    fullBleed: true,
    bodyClass: reviewBanner ? 'has-rev' : '',
    noindex: ghost,
    headExtra,
  });
}

/* -------------------------------------------------------------------- 404 */

/**
 * Shared in-shell 404 card (used by the content router for unknown content routes).
 * `project` is accepted for routing context but the card always links home.
 * @param {object} [opts]
 * @param {string} [opts.project]
 */
export function notFoundPage({ project = '' } = {}) {
  const body = `${skipLink('main-not-found')}
${brandTopbar()}
<main class="login-wrap" id="main-not-found" tabindex="-1">
  <section class="login-card" aria-labelledby="notfound-title">
    <p class="login-kicker">404</p>
    <h1 id="notfound-title">That page doesn’t exist.</h1>
    <p class="login-lede">The link may be stale, or the artifact was unpublished.</p>
    <a class="btn btn--primary btn--block login-submit" href="/">Back to the gallery</a>
  </section>
</main>`;

  return shellLayout({
    title: 'Not found — Artifacts',
    description: 'Page not found.',
    body,
    noindex: true,
  });
}

/* ------------------------------------------------------------- share modal */

function shareModalHtml(project) {
  return `<div class="modal-overlay" id="share-modal" hidden>
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="share-title" aria-describedby="share-lede" tabindex="-1">
    <div class="modal-head">
      <div>
        <h2 id="share-title">Create share link</h2>
        <p class="modal-lede" id="share-lede">Anyone with this link can view <strong>${esc(project)}</strong> without a password.</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-share-close data-tip="Close" aria-label="Close">${icon('close')}</button>
    </div>

    <div class="field" style="margin-top:0">
      <span class="field-label" id="ttl-label">Link duration</span>
      <div class="ttl-group" role="group" aria-labelledby="ttl-label">
        <button type="button" data-ttl="24h" aria-pressed="false">24 hours</button>
        <button type="button" data-ttl="7d" aria-pressed="false">7 days</button>
        <button type="button" data-ttl="30d" aria-pressed="true">30 days</button>
        <button type="button" data-ttl="180d" aria-pressed="false">180 days</button>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn btn--primary btn--block" type="button" id="share-generate">Create link</button>
    </div>

    <div class="share-result" id="share-result" hidden>
      <div class="share-url-row">
        <code class="share-url" id="share-url" tabindex="0" aria-label="Share URL"></code>
        <button class="btn" type="button" data-copy data-copy-target="#share-url">${icon('link')}<span>Copy link</span></button>
      </div>
    </div>

    <p class="form-error" data-share-error role="alert" hidden></p>
    <p class="modal-note">Expires automatically. Individual links can’t be revoked; changing the project password revokes all of them.</p>
  </div>
</div>`;
}

/** Brand header markup shared with the auth-style pages (ghost unlock, expired share, 404). */
export function brandHeader(actions = themePickerButton(), pill = '') {
  return brandTopbar(actions, pill);
}

/** Ghost-mode pill for auth/gallery-style edge pages. */
export function ghostModePill() {
  return modePill();
}
