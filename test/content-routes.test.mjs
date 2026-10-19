import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/[[path]].js';
import { resetStoreCaches } from '../functions/_store.js';
import { MemoryBucket, makeContext } from './helpers/fakes.mjs';

const SECRET = 'test-cookie-secret';

function catalog() {
  return {
    version: 1,
    updatedAt: '2026-10-18T00:00:00.000Z',
    projects: {
      guides: {
        files: [
          {
            project: 'guides',
            file: 'reports/new.html',
            routePath: 'guides/reports/new',
            type: 'html',
            title: 'New reliable report',
            description: 'freshly delivered',
            tags: [],
            date: null,
            sortDate: '2026-10-18',
            artifactDate: null,
            uploadedAt: '2026-10-18T04:00:00.000Z',
            uploadedAtReliable: true,
            uploadSource: 'deliver',
            createdAt: '2026-10-18T04:00:00.000Z',
          },
          {
            project: 'guides',
            file: 'old/report.html',
            routePath: 'guides/old/report',
            type: 'html',
            title: 'Old moved report',
            description: 'legacy',
            tags: [],
            date: null,
            sortDate: '2026-05-01',
            artifactDate: '2026-05-01',
            uploadedAt: '2026-07-21T04:30:00.000Z',
            uploadedAtReliable: false,
            uploadSource: 'bulk-migration',
            createdAt: '2026-07-21T04:30:00.000Z',
          },
          {
            project: 'guides',
            file: 'notes.md',
            routePath: 'guides/notes',
            type: 'md',
            title: 'Notes from the field',
            description: 'md entry',
            tags: ['notes'],
            date: null,
            sortDate: '2026-10-17',
            artifactDate: null,
            uploadedAt: '2026-10-17T02:00:00.000Z',
            uploadedAtReliable: true,
            uploadSource: 'deliver',
            createdAt: '2026-10-17T02:00:00.000Z',
          },
        ],
      },
    },
  };
}

function bucket() {
  const memory = new MemoryBucket({
    'meta/catalog.json': catalog(),
    'meta/protected.json': [],
    'meta/ghost.json': [],
    'content/guides/reports/new.html': '<!doctype html><title>New</title><p>new body</p>',
    'content/guides/old/report.html': '<!doctype html><title>Old</title><p>old body</p>',
    'content/guides/notes.md': '# Hello\n\nBody text with a [link](https://example.test).\n',
    'content/guides/orphan/lost.html': '<!doctype html><title>Lost</title>',
    'content/guides/external/probe.html': '<!doctype html><title>Probe</title>',
    'content/guides/protected/secret.html': '<!doctype html><title>Secret</title>',
    'content/guides/protected/secret.md': '# Secret doc\n',
  });
  const uploaded = {
    'content/guides/reports/new.html': '2026-10-18T04:00:00.000Z',
    'content/guides/old/report.html': '2026-07-21T04:30:00.000Z',
    'content/guides/notes.md': '2026-10-17T02:00:00.000Z',
    'content/guides/orphan/lost.html': '2026-09-09T09:09:09.000Z',
    'content/guides/external/probe.html': '2026-09-30T06:00:00.000Z',
    'content/guides/protected/secret.html': '2026-08-01T00:00:00.000Z',
    'content/guides/protected/secret.md': '2026-08-01T00:00:00.000Z',
  };
  for (const [key, iso] of Object.entries(uploaded)) {
    memory.objects.get(key).uploaded = new Date(iso);
  }
  return memory;
}

function envWith(overrides = {}) {
  return {
    ARTIFACTS: bucket(),
    COOKIE_SECRET: SECRET,
    ...overrides,
  };
}

async function run(path, { env = envWith(), method = 'GET', headers = {} } = {}) {
  resetStoreCaches();
  const context = makeContext({
    url: 'https://artifacts.example.test/' + path,
    method,
    headers,
    env,
    path,
  });
  const response = await onRequest(context);
  return { response, context };
}

test('listing renders every file with a time, sorted newest first', async () => {
  const { response } = await run('guides/');
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /public, max-age=60/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.ok(response.headers.get('etag'));

  // Reliable upload shows its upload date; legacy row shows its artifact date; catalog-less R2
  // object is still surfaced with its upload date.
  assert.match(html, /2026-10-18/);
  assert.match(html, /2026-05-01/);
  assert.match(html, /2026-09-09/);

  assert.ok(html.indexOf('New reliable report') < html.indexOf('lost'));
  assert.ok(html.indexOf('lost') < html.indexOf('Old moved report'));

  // Sort metadata for the client: primary resolved time + artifact-date tie-break.
  assert.match(html, /data-date="2026-10-18T04:00:00.000Z"/);
  assert.match(html, /data-artifact-date="2026-05-01T00:00:00.000Z"/);
});

test('listing for a protected project is never publicly cacheable', async () => {
  const { response } = await run('guides/', { env: envWith({ PW_GUIDES: 'secret' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});

test('protected listing 304 responses keep private cache headers', async () => {
  const env = envWith({ PW_GUIDES: 'secret' });
  const first = await run('guides/', { env });
  const etag = first.response.headers.get('etag');
  await first.response.text();
  const second = await run('guides/', { env, headers: { 'If-None-Match': etag } });
  assert.equal(second.response.status, 304);
  assert.match(second.response.headers.get('cache-control'), /private, no-store/);
});

test('listing answers If-None-Match with 304 and HEAD with no body', async () => {
  const first = await run('guides/');
  const etag = first.response.headers.get('etag');
  await first.response.text();

  const second = await run('guides/', { headers: { 'If-None-Match': etag } });
  assert.equal(second.response.status, 304);
  assert.equal(await second.response.text(), '');

  const head = await run('guides/', { method: 'HEAD' });
  assert.equal(head.response.status, 200);
  assert.equal(await head.response.text(), '');
});

test('raw artifacts stream from R2 with public caching and ETag revalidation', async () => {
  const first = await run('guides/reports/new.html');
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get('content-type'), /text\/html/);
  assert.match(first.response.headers.get('cache-control'), /public, max-age=300/);
  const etag = first.response.headers.get('etag');
  assert.ok(etag);
  assert.match(await first.response.text(), /new body/);

  const second = await run('guides/reports/new.html', { headers: { 'If-None-Match': etag } });
  assert.equal(second.response.status, 304);
});

test('raw markdown is served as text/markdown and protected content is not cacheable', async () => {
  const markdown = await run('guides/notes.md');
  assert.equal(markdown.response.status, 200);
  assert.match(markdown.response.headers.get('content-type'), /text\/markdown/);

  const protectedRaw = await run('guides/protected/secret.html', {
    env: envWith({ PW_GUIDES: 'secret' }),
  });
  assert.equal(protectedRaw.response.status, 200);
  assert.match(protectedRaw.response.headers.get('cache-control'), /private, no-store/);
});

test('unknown raw paths return 404', async () => {
  const { response } = await run('guides/missing.html');
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('markdown viewer renders at the edge with the upload time', async () => {
  const { response } = await run('guides/notes');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Notes from the field/);
  // The shell header owns the H1 now; the Markdown body starts at the first H2.
  assert.doesNotMatch(html, /<h1 id="hello">Hello<\/h1>/);
  assert.match(html, /17 Oct 2026/);
  assert.match(html, /class="reader-body"/);
  assert.match(response.headers.get('cache-control'), /public, max-age=60/);
});

test('HTML viewer iframes the raw URL and shows upload time', async () => {
  const { response } = await run('guides/reports/new');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /src="\/guides\/reports\/new.html"/);
  assert.match(html, /18 Oct 2026/);
  assert.match(html, /New reliable report/);
});

test('viewer falls back to an R2 probe for files missing from the catalog', async () => {
  const { response } = await run('guides/external/probe');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /probe/);
  assert.match(html, /30 Sep 2026/);
});

test('catalog entries whose R2 object disappeared render a stale marker', async () => {
  const stale = new MemoryBucket({
    'meta/catalog.json': {
      version: 1,
      updatedAt: '2026-10-18T00:00:00.000Z',
      projects: {
        stale: {
          files: [{ file: 'gone.html', routePath: 'stale/gone', type: 'html', title: 'Gone file', tags: [] }],
        },
      },
    },
    'meta/protected.json': [],
    'meta/ghost.json': [],
  });
  const { response } = await run('stale/', { env: { ARTIFACTS: stale, COOKIE_SECRET: SECRET } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Object missing from R2/);
});

test('unknown project and shell/static paths are handled correctly', async () => {
  const missing = await run('nope/');
  assert.equal(missing.response.status, 404);

  for (const path of ['api/catalog', 'assets/site.css', 'login', '_astro/x.css']) {
    const shell = await run(path);
    assert.equal(shell.response.status, 200, path);
    assert.equal(shell.context.nextCalls.length, 1, path);
  }
});

test('malformed percent-encoding returns 404 instead of throwing', async () => {
  const { response } = await run('%%%/report');
  assert.equal(response.status, 404);
});

test('non-GET/HEAD methods fall through to next()', async () => {
  const { response, context } = await run('guides/', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(context.nextCalls.length, 1);
});
