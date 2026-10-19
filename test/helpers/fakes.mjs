// Shared in-memory fakes for node:test suites. No wrangler/network is involved.

export class MemoryBucket {
  constructor(objects = {}) {
    /** @type {Map<string, { text: string, uploaded: Date }>} */
    this.objects = new Map();
    this.gets = 0;
    this.lists = 0;
    this.heads = 0;
    for (const [key, value] of Object.entries(objects)) {
      this.putRaw(key, value);
    }
  }

  putRaw(key, value, uploaded = new Date('2026-10-01T00:00:00.000Z')) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    this.objects.set(key, { text, uploaded });
    return this;
  }

  async get(key) {
    this.gets++;
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      text: async () => object.text,
      json: async () => JSON.parse(object.text),
      body: object.text,
      uploaded: object.uploaded,
      httpEtag: `"etag-${key.length}"`,
      customMetadata: {},
    };
  }

  async head(key) {
    this.heads++;
    const object = this.objects.get(key);
    if (!object) return null;
    return { uploaded: object.uploaded, httpEtag: `"head-${key.length}"` };
  }

  async list({ prefix = '', limit = 1000, cursor } = {}) {
    this.lists++;
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    const page = keys.slice(start, start + limit);
    const truncated = start + page.length < keys.length;
    return {
      objects: page.map((key) => ({
        key,
        size: this.objects.get(key).text.length,
        uploaded: this.objects.get(key).uploaded,
      })),
      truncated,
      cursor: truncated ? String(start + page.length) : undefined,
    };
  }

  async put(key, value) {
    this.putRaw(key, value);
    return { key };
  }
}

export function catalogFixture() {
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
        ],
      },
    },
  };
}

export function makeEnv(overrides = {}) {
  const bucket =
    overrides.ARTIFACTS ||
    new MemoryBucket({
      'meta/catalog.json': catalogFixture(),
      'meta/protected.json': [],
      'meta/ghost.json': [],
    });
  return {
    ARTIFACTS: bucket,
    COOKIE_SECRET: 'test-cookie-secret',
    ...overrides,
  };
}

/** Build the context object a Pages Function expects. */
export function makeContext({ url, method = 'GET', headers = {}, env, path = '', next, body } = {}) {
  const request = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const nextCalls = [];
  const nextFn = async () => {
    nextCalls.push(true);
    return next ? next() : new Response('next', { status: 200 });
  };
  return {
    request,
    env: env || makeEnv(),
    params: { path },
    next: nextFn,
    nextCalls,
    data: {},
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
