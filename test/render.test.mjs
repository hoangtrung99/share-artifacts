import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectListingPage,
  htmlViewerPage,
  mdViewerPage,
} from '../functions/_render.js';

function listedFile(overrides = {}) {
  return {
    title: 'Report',
    routePath: 'verups/report',
    type: 'html',
    date: null,
    uploadedAt: '2026-10-18T04:00:00.000Z',
    artifactDate: '',
    sortDate: '2026-10-18T04:00:00.000Z',
    displayDate: '2026-10-18',
    displaySource: 'upload',
    uploadedAtReliable: true,
    folder: '',
    description: '',
    tags: [],
    file: 'report.html',
    ...overrides,
  };
}

test('listing escapes titles/projects and renders a date for every row', () => {
  const html = projectListingPage({
    project: 'verups',
    files: [
      listedFile({ title: '<script>alert(1)</script>', routePath: 'verups/xss' }),
      listedFile({
        title: 'Legacy report',
        routePath: 'verups/legacy',
        uploadedAt: '2026-07-21T04:30:00.000Z',
        artifactDate: '2026-05-01T00:00:00.000Z',
        sortDate: '2026-05-01T00:00:00.000Z',
        displayDate: '2026-05-01',
        displaySource: 'artifact',
        uploadedAtReliable: false,
      }),
      listedFile({
        title: 'Bulk unknown',
        routePath: 'verups/bulk',
        uploadedAt: '2026-07-21T04:31:00.000Z',
        artifactDate: '',
        sortDate: '2026-07-21T04:31:00.000Z',
        displayDate: '2026-07-21',
        displaySource: 'legacy-upload',
        uploadedAtReliable: false,
      }),
    ],
    locked: true,
    ghost: false,
  });

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /data-date="2026-10-18T04:00:00.000Z"/);
  assert.match(html, /data-artifact-date="2026-05-01T00:00:00.000Z"/);
  assert.match(html, /2026-10-18/);
  assert.match(html, /2026-05-01/);
  assert.match(html, /2026-07-21/);
  assert.match(html, /Uploaded 2026-10-18T04:00:00.000Z/);
  assert.match(html, /Artifact date 2026-05-01T00:00:00.000Z/);
  assert.match(html, /Legacy bulk upload 2026-07-21T04:31:00.000Z/);

  // Locked project shows share/sign-out affordances and a noindex-free listing.
  assert.match(html, /data-share-project="verups"/);
  assert.match(html, /\/logout\?project=verups/);
  assert.match(html, /Recent/);
});

test('listing offers multi-select category chips from tags/folders', () => {
  const html = projectListingPage({
    project: 'verups',
    files: [
      listedFile({ title: 'Report A', routePath: 'verups/reports/a', folder: 'reports' }),
      listedFile({ title: 'Report B', routePath: 'verups/reports/b', folder: 'reports' }),
      listedFile({ title: 'Sub report', routePath: 'verups/reports/sub/c', folder: 'reports/sub' }),
      listedFile({ title: 'Investigation', routePath: 'verups/investigations/d', folder: 'investigations' }),
      listedFile({ title: 'Root file', routePath: 'verups/root-file', folder: '' }),
      listedFile({ title: 'Tagged', routePath: 'verups/tagged', tags: ['infra'] }),
      listedFile({ title: 'Tailscale: Exit Node, Serve và Funnel', routePath: 'verups/tailscale', folder: '' }),
    ],
    locked: true,
    ghost: false,
  });
  assert.match(html, /data-cat-chips/);
  assert.match(html, /data-cat="all"/);
  assert.match(html, /data-cat="reports"[^>]*>Reports <span class="cat-count">3<\/span>/);
  assert.match(html, /data-cat="investigations"[^>]*>Investigations <span class="cat-count">1<\/span>/);
  assert.match(html, /data-cat="general"[^>]*>General <span class="cat-count">1<\/span>/);
  assert.match(html, /data-cat="infra"[^>]*>Infra <span class="cat-count">1<\/span>/);
  assert.match(html, /data-cats="reports"/);
  assert.match(html, /data-cats="general"/);
  // Untagged, folderless artifacts get a curated keyword fallback (explicit tags/folders win).
  assert.match(html, /data-cats="networking[^"]*"/);
  assert.match(html, /aria-pressed="true"[^>]*>All/);

  // A project with a single category does not render the filter row.
  const single = projectListingPage({
    project: 'guides',
    files: [listedFile({ title: 'Only', routePath: 'guides/only', folder: '' })],
    locked: false,
    ghost: false,
  });
  assert.doesNotMatch(single, /data-cat-chips/);
});

test('ghost listings are noindex and public listings are indexable', () => {
  const ghost = projectListingPage({ project: 'games', files: [listedFile()], locked: false, ghost: true });
  assert.match(ghost, /<meta name="robots" content="noindex">/);
  const open = projectListingPage({ project: 'guides', files: [listedFile()], locked: false, ghost: false });
  assert.doesNotMatch(open, /<meta name="robots" content="noindex">/);
});

test('HTML viewer iframes the raw artifact and shows upload time', () => {
  const html = htmlViewerPage({
    title: 'Report',
    description: 'desc',
    project: 'verups',
    routePath: 'verups/report',
    rawUrl: '/verups/report.html',
    downloadName: 'report.html',
    time: {
      uploadedAt: '2026-10-18T04:00:00.000Z',
      artifactDate: '',
      sortDate: '2026-10-18T04:00:00.000Z',
      displayDate: '2026-10-18',
      displaySource: 'upload',
      uploadedAtReliable: true,
    },
    locked: false,
    ghost: false,
  });
  assert.match(html, /src="\/verups\/report.html"/);
  assert.match(html, /class="viewer-frame"/);
  assert.match(html, /18 Oct 2026/);
  assert.match(html, /class="bleed"/);
  assert.match(html, /\/assets\/viewer.js\?v=/);
});

test('MD viewer shows artifact-date badge with both timestamps in the tooltip', () => {
  const html = mdViewerPage({
    title: 'Legacy doc',
    description: '',
    project: 'verups',
    routePath: 'verups/legacy',
    rawUrl: '/verups/legacy.md',
    downloadName: 'legacy.md',
    date: null,
    tags: ['ops'],
    htmlBody: '<h2 id="usage">Usage</h2><p>body</p>',
    headings: [{ depth: 2, text: 'Usage', id: 'usage' }],
    time: {
      uploadedAt: '2026-07-21T04:30:00.000Z',
      artifactDate: '2026-05-01T00:00:00.000Z',
      sortDate: '2026-05-01T00:00:00.000Z',
      displayDate: '2026-05-01',
      displaySource: 'artifact',
      uploadedAtReliable: false,
    },
    locked: false,
    ghost: false,
  });
  assert.match(html, /class="reader"/);
  assert.match(html, /1 May 2026/);
  assert.match(html, /Artifact date 2026-05-01T00:00:00.000Z/);
  assert.match(html, /uploaded 2026-07-21T04:30:00.000Z/);
  assert.match(html, /On this page/);
  assert.match(html, /highlight.min.js/);
});
