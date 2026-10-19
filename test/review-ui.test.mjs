import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { htmlViewerPage, mdViewerPage, projectListingPage } from '../functions/_render.js';
import { shellChrome } from '../functions/_ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/* ------------------------------------------------------------------ harness */

/**
 * viewer.js is a browser IIFE. Load it in a vm with a minimal DOM stub so the pure anchor
 * helpers are reachable via window.ArtifactsReview; the DOM boot paths are wrapped in the
 * shell's own safe() and no-op against the stub.
 */
function loadReviewHelpers() {
  const source = read('shell-assets/viewer.js');
  const noop = () => {};
  const stubElement = () => ({
    style: { setProperty: noop },
    dataset: {},
    classList: { add: noop, remove: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    focus: noop,
    remove: noop,
  });
  const doc = {
    readyState: 'complete',
    documentElement: { dataset: {}, lang: 'en' },
    head: { appendChild: noop },
    body: { appendChild: noop },
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: stubElement,
    createElementNS: stubElement,
    createTreeWalker: () => ({ nextNode: () => null }),
    contains: () => false,
  };
  const windowStub = {
    document: doc,
    location: { search: '', pathname: '/', href: 'https://example.test/', origin: 'https://example.test', hash: '' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop },
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => fn(),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    innerWidth: 1200,
    innerHeight: 800,
    scrollY: 0,
    scrollTo: noop,
    history: { replaceState: noop },
    navigator: { onLine: true },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    URL,
    URLSearchParams,
    console,
    fetch: () => Promise.reject(new Error('network disabled in unit tests')),
  };
  windowStub.window = windowStub;
  const sandbox = {
    window: windowStub,
    document: doc,
    location: windowStub.location,
    history: windowStub.history,
    navigator: windowStub.navigator,
    localStorage: windowStub.localStorage,
    sessionStorage: windowStub.sessionStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    matchMedia: windowStub.matchMedia,
    getComputedStyle: windowStub.getComputedStyle,
    URL,
    URLSearchParams,
    fetch: windowStub.fetch,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'shell-assets/viewer.js' });
  return windowStub.ArtifactsReview;
}

const review = loadReviewHelpers();

function viewerFile(overrides = {}) {
  return {
    title: 'Sample report',
    description: '',
    project: 'demo',
    routePath: 'demo/sample',
    rawUrl: '/demo/sample.html',
    downloadName: 'sample.html',
    time: null,
    locked: false,
    ghost: false,
    ...overrides,
  };
}

const REV_A = 'a'.repeat(64);
const REV_B = 'b'.repeat(64);

/* ------------------------------------------------------------ pure helpers */

function quoteBounds(found) {
  return found ? [found.start, found.end, found.score] : null;
}

test('findQuote returns the unique occurrence and its bounds', () => {
  const text = 'Run a single replica to avoid split-brain.';
  assert.deepEqual(quoteBounds(review.findQuote(text, { exact: 'single replica' })), [6, 20, 2]);
  assert.equal(review.findQuote(text, { exact: 'missing' }), null);
  assert.equal(review.findQuote('', { exact: 'x' }), null);
});

test('findQuote disambiguates duplicate text with prefix/suffix and never guesses', () => {
  const text = 'alpha beta alpha gamma';
  // Two identical quotes with no context: ambiguous, so no anchor rather than the first hit.
  assert.equal(review.findQuote(text, { exact: 'alpha' }), null);
  const second = text.lastIndexOf('alpha');
  assert.deepEqual(
    quoteBounds(review.findQuote(text, { exact: 'alpha', prefix: 'beta ', suffix: ' gamma' })),
    [second, second + 5, 4],
  );
  // Only the suffix distinguishes the first occurrence.
  const first = review.findQuote(text, { exact: 'alpha', suffix: ' beta' });
  assert.equal(first.start, 0);
});

test('findQuote keeps Vietnamese and emoji selections intact', () => {
  const text = 'Triển khai bản sửa lỗi 🚀 ngay hôm nay.';
  const found = review.findQuote(text, { exact: 'bản sửa lỗi 🚀' });
  assert.ok(found);
  assert.equal(text.slice(found.start, found.end), 'bản sửa lỗi 🚀');
});

test('findQuote never uses recorded offsets to break an ambiguous tie', () => {
  const text = 'first test and second test';
  const second = text.lastIndexOf('test');
  const anchor = { exact: 'test', start: second, end: second + 4 };
  // Context-free duplicate: unanchored even when offsets are present (trusted or not).
  assert.equal(review.findQuote(text, anchor, { trustOffsets: true }), null);
  assert.equal(review.findQuote(text, anchor), null);
  // Quote context still resolves the occurrence unambiguously.
  const resolved = review.findQuote(text, { exact: 'test', prefix: 'second ' });
  assert.equal(resolved.start, second);
});

test('findQuote checks prefix/suffix before offsets so reordered duplicates stay unanchored', () => {
  // Context identifies the second occurrence in the original ordering.
  const original = 'A X X B';
  const anchor = { exact: 'X', prefix: 'X ', suffix: ' B' };
  assert.equal(review.findQuote(original, anchor).start, 4);
  // Identical context on both occurrences: no unique candidate, so unanchored.
  const ambiguous = 'A X A X A';
  const ambiguousAnchor = { exact: 'X', prefix: 'A ', suffix: ' A' };
  assert.equal(review.findQuote(ambiguous, ambiguousAnchor), null);
  // Offsets never break an ambiguity tie, even when the caller trusts them.
  assert.equal(
    review.findQuote(ambiguous, { ...ambiguousAnchor, start: 6 }, { trustOffsets: true }),
    null,
  );
  // An offset pointing at one tied occurrence still cannot win.
  assert.equal(review.findQuote(original, { exact: 'X', start: 2 }, { trustOffsets: true }), null);
});

test('relative time, bytes, clip and revision-id helpers', () => {
  const now = Date.parse('2026-10-19T06:00:00.000Z');
  assert.equal(review.relativeTime('2026-10-19T05:59:30.000Z', now), 'just now');
  assert.equal(review.relativeTime('2026-10-19T05:57:00.000Z', now), '3 min ago');
  assert.equal(review.relativeTime('2026-10-19T04:00:00.000Z', now), '2 h ago');
  assert.equal(review.relativeTime('2026-10-16T06:00:00.000Z', now), '3 d ago');
  assert.match(review.relativeTime('2026-10-01T06:00:00.000Z', now), /1 Oct 2026/);
  assert.equal(review.relativeTime('not-a-date', now), '');

  assert.equal(review.formatBytes(512), '512 B');
  assert.equal(review.formatBytes(2048), '2.0 KB');
  assert.equal(review.formatBytes(1048576), '1.0 MB');

  assert.equal(review.clip('  a   b  ', 10), 'a b');
  assert.equal(review.clip('abcdefghij', 5), 'abcdefghij'.slice(0, 4) + '…');
  assert.equal(review.clip('line one\nline two', 40), 'line one line two');

  assert.equal(review.isRevisionId('a'.repeat(64)), true);
  assert.equal(review.isRevisionId('a'.repeat(63)), false);
  assert.equal(review.isRevisionId('Z'.repeat(64)), false);
  assert.equal(review.STATUS_LABEL.addressed, 'Addressed');
  assert.equal(review.KIND_LABEL.replace, 'Replace');
});

/* --------------------------------------------------------- server markup */

test('HTML viewer renders the Feedback action, review panel and version dialog', () => {
  const html = htmlViewerPage(viewerFile());
  assert.match(html, /data-review-toggle/);
  assert.match(html, /data-review-badge/);
  assert.match(html, /aria-controls="review-panel"/);
  assert.match(html, /id="review-panel"/);
  assert.match(html, /data-review-popover/);
  assert.match(html, /data-review-scrim/);
  assert.match(html, /data-review-pill/);
  assert.match(html, /data-versions-modal/);
  assert.match(html, /data-review-status/);
  assert.match(html, /data-review-composer/);
  assert.match(html, /data-review-artifact=""/);
  assert.match(html, /data-review-project="demo"/);
  assert.match(html, /data-review-file="sample.html"/);
  assert.match(html, /data-review-route="demo\/sample"/);
});

test('MD reader renders the same review contract and accepts artifact/revision context', () => {
  const html = mdViewerPage({
    title: 'Sample doc',
    description: '',
    project: 'demo',
    routePath: 'demo/doc',
    rawUrl: '/demo/doc.md',
    downloadName: 'doc.md',
    date: null,
    tags: [],
    htmlBody: '<h2 id="one">One</h2><p>body</p>',
    headings: [{ depth: 2, text: 'One', id: 'one' }],
    locked: false,
    ghost: false,
    artifact: { artifactId: 'abc123', project: 'demo', file: 'doc.md', routePath: 'demo/doc' },
    revision: {
      revisionId: REV_B,
      number: 3,
      total: 4,
      latestNumber: 4,
      isLatest: true,
      revisioningEnabled: true,
      latestRevisionId: REV_B,
    },
  });
  assert.match(html, /data-review-toggle/);
  assert.match(html, /data-review-artifact="abc123"/);
  assert.match(html, /data-review-file="doc.md"/);
  assert.match(html, /data-review-revision="b{64}"/);
  assert.match(html, /data-review-revision-number="3"/);
  assert.match(html, /data-review-is-latest="true"/);
  // Latest view: no read-only banner.
  assert.doesNotMatch(html, /data-rev-banner/);
  assert.doesNotMatch(html, /class="bleed has-rev"/);
});

test('pinned old revision renders a read-only banner and has-rev body class', () => {
  const html = mdViewerPage({
    title: 'Sample doc',
    description: '',
    project: 'demo',
    routePath: 'demo/doc',
    rawUrl: '/demo/doc.md?rev=' + REV_A,
    downloadName: 'doc.md',
    date: null,
    tags: [],
    htmlBody: '<p>body</p>',
    headings: [],
    locked: false,
    ghost: false,
    artifact: { artifactId: 'abc123', project: 'demo', file: 'doc.md', routePath: 'demo/doc' },
    revision: {
      revisionId: REV_A,
      number: 2,
      total: 4,
      latestNumber: 4,
      isLatest: false,
      revisioningEnabled: true,
      latestRevisionId: REV_B,
    },
  });
  assert.match(html, /data-rev-banner/);
  assert.match(html, /Viewing revision 2 of 4 — latest is v4/);
  assert.match(html, /class="bleed has-rev"/);
  assert.match(html, /Back to latest/);
  assert.match(html, /data-review-is-latest="false"/);
});

test('the empty feedback state offers a whole-document comment action', () => {
  const html = htmlViewerPage(viewerFile());
  assert.match(html, /data-review-document-empty/);
  assert.match(html, /data-review-document-action/);
  assert.match(html, /Comment on whole document/);
  // Stale-index guard note ships in the panel (hidden until an in-iframe navigation).
  assert.match(html, /data-review-frame-note/);
  // Inline selection composer ships with the shell so feedback never requires opening the panel.
  assert.match(html, /data-review-inline/);
  assert.match(html, /data-review-inline-body/);
  assert.match(html, /data-review-inline-submit/);
});

test('review context values are escaped in data attributes', () => {
  const html = htmlViewerPage(
    viewerFile({
      title: '<script>alert(1)</script>',
      project: 'demo',
      artifact: { artifactId: 'x', project: 'demo', file: 'a"b.html', routePath: 'demo/a"b' },
    }),
  );
  assert.doesNotMatch(html, /data-review-title="<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /data-review-file="a&quot;b.html"/);
});

test('the project listing does not mount review UI', () => {
  const html = projectListingPage({
    project: 'demo',
    files: [],
    locked: false,
    ghost: false,
  });
  assert.doesNotMatch(html, /data-review-toggle/);
  assert.doesNotMatch(html, /id="review-panel"/);
});

test('shared shell chrome exposes one More-menu entry for Versions', () => {
  const chrome = shellChrome();
  assert.match(chrome, /data-action="versions"/);
  assert.match(chrome, /#i-history/);
});

test('user text in the review controller is textContent-only (no HTML injection path)', () => {
  const viewer = read('shell-assets/viewer.js');
  const start = viewer.indexOf('/* ---------------------------------------------------------------- review */');
  const end = viewer.indexOf('/* -------------------------------------------------------------------- boot */');
  assert.ok(start > 0 && end > start, 'review controller section must exist in viewer.js');
  const section = viewer.slice(start, end);
  assert.doesNotMatch(section, /innerHTML/);
  assert.doesNotMatch(section, /insertAdjacentHTML/);
  assert.doesNotMatch(section, /document\.write/);
  // reviewEl is the single text sink and always assigns through textContent.
  assert.match(section, /node\.textContent = String\(text\)/);
});

test('server markup escapes hostile titles and descriptions', () => {
  const html = htmlViewerPage(
    viewerFile({
      title: '<img src=x onerror=alert(1)>',
      description: 'javascript:alert(1)',
    }),
  );
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<title><img/);
});

test('site.css ships the review components on theme tokens', () => {
  const css = read('shell-assets/site.css');
  assert.match(css, /\.review-panel \{/);
  assert.match(css, /\.review-popover \{/);
  assert.match(css, /\.thread-quote \{/);
  assert.match(css, /\.review-pill \{/);
  assert.match(css, /\.versions-card \{/);
  assert.match(css, /\.rev-banner \{/);
  // Highlight paint rules are injected into the target document by viewer.js at runtime.
  assert.match(read('shell-assets/viewer.js'), /::highlight\(review-open\)/);
  assert.match(read('shell-assets/viewer.js'), /CSS\.highlights/);
  // Theme tokens only — the review block must not introduce raw palette hex values.
  const block = css.slice(css.indexOf('.bar-feedback'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(block, /rgba?\(/);
});
