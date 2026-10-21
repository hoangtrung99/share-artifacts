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

/* ------------------------------------------------ async race policy (unit) */

test('race 1: a fetch response is discarded when any draft appeared while it was in flight', () => {
  assert.equal(review.refreshBlocked({}), false);
  assert.equal(review.refreshBlocked({ popupReplyDraft: true }), true);
  assert.equal(review.refreshBlocked({ panelReplyDraft: true }), true);
  assert.equal(review.refreshBlocked({ inlineDraft: true }), true);
  assert.equal(review.refreshBlocked({ composerDraft: true }), true);
  assert.equal(review.refreshBlocked({ replySubmitting: true }), true);
});

test('race 2: refresh never replaces the popup thread while a reply is being drafted/sent', () => {
  assert.equal(review.shouldReplacePopupThread('th_1', 'th_1', true, ''), false);
  assert.equal(review.shouldReplacePopupThread('th_1', 'th_1', false, 'draft'), false);
  assert.equal(review.shouldReplacePopupThread('th_1', 'th_1', false, ''), true);
  assert.equal(review.shouldReplacePopupThread('th_1', 'th_2', false, ''), true);
  assert.equal(review.shouldReplacePopupThread('', 'th_1', false, ''), false);
});

test('race 3: status/render churn keeps the in-flight draft and only the replied thread owns it', () => {
  // Re-render of the same thread preserves the textarea (even mid-submit).
  assert.equal(review.shouldPreservePopupReplyText('th_1', 'th_1'), true);
  assert.equal(review.shouldPreservePopupReplyText('th_1', 'th_2'), false);
  assert.equal(review.shouldPreservePopupReplyText(null, 'th_1'), false);
  // Success/failure UI applies only to the replied thread, by stable id.
  assert.equal(review.replyOwnsPopup('th_1', 'th_1'), true);
  assert.equal(review.replyOwnsPopup('th_2', 'th_1'), false);
  assert.equal(review.replyOwnsPopup(null, 'th_1'), false);
});

test('author labels: anonymous guests are Guest, typed names win', () => {
  assert.equal(review.authorLabel({ kind: 'guest', name: 'Guest', unverified: true }), 'Guest');
  assert.equal(review.authorLabel({ kind: 'guest', name: 'An', unverified: true }), 'An');
  assert.equal(review.authorLabel({ kind: 'guest' }), 'Guest');
  assert.equal(review.authorLabel({ kind: 'owner' }), 'Anonymous');
  assert.equal(review.authorLabel(null), 'Anonymous');
  // Every author surface renders the unverified marker through the shared helper.
  const viewer = read('shell-assets/viewer.js');
  assert.match(viewer, /function reviewAppendAuthorMeta/);
  assert.match(viewer, /value\.kind === 'guest' \? 'Guest'/);
  const uses = (viewer.match(/reviewAppendAuthorMeta\(/g) || []).length;
  assert.ok(uses >= 5, 'expected definition + 4 author surfaces, got ' + uses);
});

test('escapeMarkdown mirrors backend mdText escaping', () => {
  assert.equal(review.escapeMarkdown('# heading'), '\\# heading');
  assert.equal(review.escapeMarkdown('---'), '\\---');
  assert.equal(review.escapeMarkdown('1. ordered'), '1\\. ordered');
  assert.equal(review.escapeMarkdown('a <b> [x](y)'), 'a &lt;b\\> \\[x\\]\\(y\\)');
  assert.equal(review.escapeMarkdown('back\\slash'), 'back\\\\slash');
  // Setext underlines: 2+ hyphens or 1+ equals after content become literal text.
  assert.equal(review.escapeMarkdown('Approved\n--'), 'Approved\n\\--');
  assert.equal(review.escapeMarkdown('Title\n==='), 'Title\n\\===');
  assert.equal(review.escapeMarkdown('Mixed prose\nand more\n--\nAfter'), 'Mixed prose\nand more\n\\--\nAfter');
  // Fence selection grows past the longest backtick run so content can never close it.
  assert.equal(review.markdownFence('plain text'), '```');
  assert.equal(review.markdownFence('a ``` b'), '````');
  assert.equal(review.markdownFence('a ```` b'), '`````');
});

test('markdown export escapes hostile open-mode comment fields', () => {
  const quote = '# heading\n---\n[x](url)\n![img](url)\n**bold**\n<script>alert(1)</script>\n- item\n+ plus\n1. ordered\n> quote';
  const md = review.buildMarkdown({
    title: 'Feedback — demo',
    artifact: { project: 'demo', file: 'sample.html', routePath: 'demo/sample' },
    revisionNumber: 2,
    counts: { open: 1, addressed: 0, resolved: 0 },
    totalThreads: 1,
    exportedAt: 'Oct 21, 2026',
    threads: [
      {
        kind: 'comment',
        status: 'open',
        revisionNumber: 2,
        author: { name: '# owner', kind: 'guest', unverified: true },
        createdAt: '2026-10-21T00:00:00.000Z',
        anchor: { type: 'text', exact: quote },
        messages: [
          {
            body: 'Body [x](url) ![img](url) **bold** <script>alert(2)</script>\n# heading\n1. ordered\n- item',
            replacement: '# heading\n---\n<script>x</script>',
          },
        ],
        replies: [{ author: { name: '[evil](url)' }, body: 'Reply --- \n> quote' }],
      },
    ],
  });
  const beforeReplacement = md.slice(0, md.indexOf('Suggested replacement:'));
  // Our own structural line is the only bare horizontal rule outside the raw code fence.
  assert.equal(beforeReplacement.split('\n').filter((line) => line === '---').length, 1);
  // No user text becomes a heading, link, image, HTML, list, rule or blockquote.
  assert.ok(!/^# heading$/m.test(beforeReplacement));
  assert.ok(!beforeReplacement.includes('[x](url)'));
  assert.ok(!beforeReplacement.includes('![img](url)'));
  assert.ok(!beforeReplacement.includes('<script>'));
  assert.ok(!/^1\. ordered$/m.test(beforeReplacement));
  assert.ok(!/^- item$/m.test(md));
  assert.ok(!/^> quote$/m.test(md));
  // Structural characters survive escaped (including inside the quote block and fence).
  assert.ok(md.includes('\\# heading'));
  assert.ok(md.includes('\\[x\\]\\(url\\)'));
  assert.ok(md.includes('!\\[img\\]\\(url\\)'));
  assert.ok(md.includes('\\*\\*bold\\*\\*'));
  assert.ok(md.includes('&lt;script\\>'));
  assert.ok(md.includes('\\- item'));
  assert.ok(md.includes('\\+ plus'));
  assert.ok(md.includes('1\\. ordered'));
  assert.ok(md.includes('\\> quote'));
  assert.ok(md.includes('> \\# heading'));
  // The replacement is code: raw inside a fence, never inline-escaped.
  assert.ok(md.includes('Suggested replacement:'));
  assert.ok(md.includes('```\n# heading\n---\n<script>x</script>\n```'));
  // The author name and reply author cannot inject Markdown.
  assert.ok(!md.includes('[evil](url)'));
  assert.ok(md.includes('\\[evil\\]\\(url\\)'));
});

test('markdown export neutralizes setext heading underlines', () => {
  const md = review.buildMarkdown({
    title: 'Setext check',
    artifact: { project: 'demo', file: 'sample.html' },
    revisionNumber: 2,
    counts: { open: 1, addressed: 0, resolved: 0 },
    totalThreads: 1,
    exportedAt: 'Oct 21, 2026',
    threads: [
      {
        kind: 'comment',
        status: 'open',
        author: { name: 'Guest', kind: 'guest', unverified: true },
        createdAt: '2026-10-21T00:00:00.000Z',
        anchor: { type: 'text', exact: 'Title\n===' },
        messages: [{ body: 'Approved\n--\nMixed prose line\nand another line\n---' }],
        replies: [{ author: { name: 'Guest' }, body: 'Nope\n--' }],
      },
    ],
  });
  // The quote block escapes its own setext underlines; user body/reply lines never become one.
  assert.ok(md.includes('> Title'));
  assert.ok(md.includes('> \\==='));
  assert.ok(md.includes('Approved'));
  assert.ok(md.includes('\\--'));
  assert.ok(!/\n--\n/.test(md));
  assert.ok(!/\n===\n/.test(md));
  const lines = md.split('\n');
  assert.equal(lines.filter((line) => line === '---').length, 1);
});

test('markdown export keeps replacement raw inside a longer fence', () => {
  const replacement = 'Use this snippet:\n```js\nconst value = [1];\n```\n# heading\n---\n<script>alert(1)</script>';
  const md = review.buildMarkdown({
    title: 'Fence check',
    artifact: { project: 'demo', file: 'sample.html' },
    revisionNumber: 2,
    counts: { open: 1, addressed: 0, resolved: 0 },
    totalThreads: 1,
    exportedAt: 'Oct 21, 2026',
    threads: [
      {
        kind: 'replace',
        status: 'open',
        author: { name: 'Guest', kind: 'guest', unverified: true },
        createdAt: '2026-10-21T00:00:00.000Z',
        anchor: { type: 'document' },
        messages: [{ body: 'Suggested code fix.', replacement: replacement }],
        replies: [],
      },
    ],
  });
  // One backtick longer than the inner ``` run; content stays raw (no added backslashes).
  assert.ok(md.includes('````\n' + replacement + '\n````'));
  assert.ok(!md.includes('\\# heading'));
  assert.ok(!md.includes('\\`\\`\\`js'));
  const replacementBlock = md.slice(md.indexOf('Suggested replacement:'));
  assert.ok(replacementBlock.includes('# heading'));
  assert.ok(replacementBlock.includes('<script>alert(1)</script>'));
});

test('markdown export keeps ordinary prose readable', () => {
  const md = review.buildMarkdown({
    title: 'Quarterly capacity review',
    artifact: { project: 'demo', file: 'sample.html' },
    revisionNumber: 2,
    counts: { open: 1, addressed: 0, resolved: 0 },
    totalThreads: 1,
    exportedAt: 'Oct 21, 2026',
    threads: [
      {
        kind: 'comment',
        status: 'open',
        author: { name: 'An Nguyen', kind: 'guest', unverified: true },
        createdAt: '2026-10-21T00:00:00.000Z',
        anchor: { type: 'document' },
        messages: [
          {
            body: 'The rollback failed twice (expected). Check the logs before retrying.',
            replacement: 'kubectl rollout restart deploy/api -n demo',
          },
        ],
        replies: [{ author: { name: 'An Nguyen' }, body: 'Confirmed: retry after the check.' }],
      },
    ],
  });
  assert.ok(md.includes('# Feedback — Quarterly capacity review'));
  assert.ok(md.includes('> Whole document'));
  assert.ok(md.includes('- An Nguyen · 2026-10-21T00:00:00.000Z'));
  assert.ok(md.includes('The rollback failed twice \\(expected\\). Check the logs before retrying.'));
  assert.ok(md.includes('**Reply — An Nguyen:** Confirmed: retry after the check.'));
  assert.ok(md.includes('kubectl rollout restart deploy/api -n demo'));
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
  // Revisioned artifacts render a visible History button in the bar.
  assert.match(html, /data-versions-toggle[^>]*><svg class="icon"/);
  assert.doesNotMatch(html, /data-versions-toggle[^>]*hidden/);
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
  // Version history is an explicit bar button; hidden for legacy (no revision context).
  assert.match(html, /data-versions-toggle/);
  // Thread popup (highlight click with the panel closed) ships with the shell.
  assert.match(html, /data-review-thread-pop/);
  assert.match(html, /data-review-thread-pop-reply/);
  assert.match(html, /data-review-thread-pop-open/);
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
  // Highlight paint + themed artifact-scrollbar rules are injected into the target document.
  assert.match(read('shell-assets/viewer.js'), /::highlight\(review-open\)/);
  assert.match(read('shell-assets/viewer.js'), /CSS\.highlights/);
  assert.match(css, /\.review-thread-pop \{/);
  assert.match(css, /\.thread\.is-flash \{/);
  assert.match(css, /::-webkit-scrollbar-thumb/);
  assert.match(read('shell-assets/viewer.js'), /caretRangeFromPoint/);
  assert.match(read('shell-assets/viewer.js'), /scrollbar-color/);
  assert.match(read('shell-assets/viewer.js'), /reviewHitThread/);
  // Theme tokens only — the review block must not introduce raw palette hex values.
  const block = css.slice(css.indexOf('.bar-feedback'));
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(block, /rgba?\(/);
});
