// Shared fixtures for the feedback tests.
//
// A node:sqlite-backed D1 shim (same prepare/bind/first/all/run/batch contract the Workers D1
// binding exposes) plus generic demo artifacts. The shim executes migrations/0001_feedback.sql
// verbatim, so the committed schema is what these tests exercise.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { MemoryBucket } from './helpers/fakes.mjs';
import { signToken, pwVersion, cookieName, GHOST_COOKIE_NAME, GHOST_PROJECT } from '../functions/_auth.js';
import { artifactIdFor, sha256Hex } from '../functions/_feedback-revisions.js';

export const TEST_SECRET = 'test-cookie-secret';

/** @type {string} */
const SCHEMA = fs.readFileSync(new URL('../migrations/0001_feedback.sql', import.meta.url), 'utf8');

class BoundStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new BoundStatement(this.db, this.sql, params);
  }

  async first() {
    const statement = this.db.prepare(this.sql);
    return statement.get(...this.params) ?? null;
  }

  async all() {
    const statement = this.db.prepare(this.sql);
    return { results: statement.all(...this.params), success: true, meta: {} };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const statement = this.db.prepare(this.sql);
    const result = statement.run(...this.params);
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }
}

/**
 * Create an in-memory D1-compatible database with the feedback schema applied.
 * @returns {{ binding: object, db: DatabaseSync }}
 */
export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return {
    db,
    binding: {
      prepare(sql) {
        return new BoundStatement(db, sql);
      },
      async batch(statements) {
        db.exec('BEGIN');
        try {
          const results = statements.map((statement) => statement.runSync());
          db.exec('COMMIT');
          return results;
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* the transaction may already be gone */
          }
          throw error;
        }
      },
    },
  };
}

/** One catalog file entry for the demo project. */
function catalogEntry(file) {
  const type = file.toLowerCase().endsWith('.md') ? 'md' : 'html';
  return {
    project: 'demo',
    file,
    routePath: `demo/${file.replace(/\.(html|md)$/i, '')}`,
    type,
    title: 'Demo sample artifact',
    description: 'generic test fixture',
    tags: [],
    date: null,
    sortDate: '2026-10-01',
    artifactDate: null,
    uploadedAt: '2026-10-01T00:00:00.000Z',
    uploadedAtReliable: true,
    uploadSource: 'deliver',
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

/** Generic R2 objects shared by the feedback tests (public demo project, no revisions yet). */
export function demoObjects() {
  return {
    'meta/catalog.json': {
      version: 1,
      updatedAt: '2026-10-18T00:00:00.000Z',
      projects: { demo: { files: [catalogEntry('sample.html')] } },
    },
    'meta/protected.json': [],
    'meta/ghost.json': [],
    'content/demo/sample.html': '<!doctype html><title>Demo</title><p>Hello reviewers.</p>',
  };
}

/**
 * Build a revisioned artifact fixture: registry + one immutable snapshot per version.
 * @param {{ project?: string, file?: string, versions: string[] }} input oldest first
 */
export async function revisionedArtifact({ project = 'demo', file = 'sample.html', versions }) {
  const type = file.toLowerCase().endsWith('.md') ? 'md' : 'html';
  const contentType = type === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
  const artifactId = await artifactIdFor(project, file);
  const revisions = [];
  for (let index = 0; index < versions.length; index++) {
    const revisionId = await sha256Hex(versions[index]);
    revisions.push({
      revisionId,
      number: index + 1,
      size: Buffer.byteLength(versions[index], 'utf8'),
      contentType,
      createdAt: `2026-10-0${index + 1}T00:00:00.000Z`,
      createdBy: 'deliver',
    });
  }
  const latest = revisions[revisions.length - 1];
  const registry = {
    schemaVersion: 1,
    artifactId,
    project,
    file,
    type,
    createdAt: revisions[0].createdAt,
    updatedAt: latest.createdAt,
    latestRevisionId: latest.revisionId,
    latestRevisionNumber: latest.number,
    revisions,
  };
  const objects = { [`meta/revisions/${artifactId}.json`]: registry };
  revisions.forEach((revision, index) => {
    objects[`revisions/${artifactId}/${revision.revisionId}/source.${type}`] = versions[index];
  });
  return { artifactId, project, file, type, registry, latest, revisions, objects };
}

/**
 * Env with an in-memory R2 bucket and a working D1 shim.
 * @param {Record<string, unknown>} objects extra/overriding R2 objects
 * @param {Record<string, unknown>} overrides extra env values (PW_*, FEEDBACK_ADMIN_TOKEN, …)
 */
export function makeFeedbackEnv(objects = {}, overrides = {}) {
  const bucket = new MemoryBucket({ ...demoObjects(), ...objects });
  return {
    ARTIFACTS: bucket,
    COOKIE_SECRET: TEST_SECRET,
    FEEDBACK_DB: createD1().binding,
    ...overrides,
  };
}

/** Signed project cookie header value. */
export async function projectCookie(project, password, { secret = TEST_SECRET, ttl = 3600 } = {}) {
  const version = await pwVersion(secret, password);
  const token = await signToken(secret, project, ttl, version);
  return `${cookieName(project)}=${token}`;
}

/** Signed ghost cookie header value. */
export async function ghostCookieToken(masterPassword, { secret = TEST_SECRET } = {}) {
  const version = await pwVersion(secret, masterPassword);
  const token = await signToken(secret, GHOST_PROJECT, 3600, version);
  return `${GHOST_COOKIE_NAME}=${token}`;
}

/** Build the context object a Pages Function expects. */
export function makeApiContext({ url, method = 'GET', headers = {}, env, body, path = '' }) {
  const request = new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { request, env, params: { path }, data: {}, next: async () => new Response('next') };
}
