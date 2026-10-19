import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/feedback/[[path]].js';
import { onRequest as redeemRoute } from '../functions/r/[token].js';
import { resetRateLimits } from '../functions/_feedback.js';
import { resetRevisionCache } from '../functions/_feedback-revisions.js';
import { resetStoreCaches } from '../functions/_store.js';
import {
  makeApiContext,
  makeFeedbackEnv,
  projectCookie,
  revisionedArtifact,
} from './feedback-sqlite-helper.mjs';

const ORIGIN = 'https://artifacts.example.test';
const ADMIN = { 'x-feedback-admin': 'admin-secret' };
const V1 = '<!doctype html><title>Demo v1</title><p>Hello reviewers.</p>';
const V2 = '<!doctype html><title>Demo v2</title><p>Hello reviewers. Run one replica.</p>';

async function publicFixture(overrides = {}) {
  const fixture = await revisionedArtifact({ project: 'demo', file: 'sample.html', versions: [V1, V2] });
  const env = makeFeedbackEnv(
    { ...fixture.objects, 'content/demo/sample.html': V2 },
    { FEEDBACK_ADMIN_TOKEN: 'admin-secret', ...overrides },
  );
  return { fixture, env };
}

function buildContext(segments, { method = 'GET', env, headers = {}, body, query } = {}) {
  const search = query ? `?${new URLSearchParams(query)}` : '';
  const path = Array.isArray(segments) ? segments.join('/') : segments || '';
  const requestHeaders = { ...headers };
  if (method !== 'GET' && method !== 'HEAD') requestHeaders.origin = requestHeaders.origin || ORIGIN;
  if (body !== undefined) requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
  return makeApiContext({
    url: `${ORIGIN}/api/feedback${path ? `/${path}` : ''}${search}`,
    method,
    headers: requestHeaders,
    env,
    body,
    path,
  });
}

async function call(segments, options = {}) {
  resetRateLimits();
  resetStoreCaches();
  resetRevisionCache();
  const response = await onRequest(buildContext(segments, options));
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { response, payload, text };
}

async function redeem(token, env) {
  resetStoreCaches();
  resetRevisionCache();
  const request = new Request(`${ORIGIN}/r/${encodeURIComponent(token)}`);
  const response = await redeemRoute({ request, env, params: { token }, data: {}, next: async () => new Response('next') });
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';
  return { response, setCookie, cookie };
}

function commentBody(fixture, overrides = {}) {
  return {
    artifactId: fixture.artifactId,
    revisionId: fixture.latest.revisionId,
    kind: 'comment',
    anchor: {
      version: 1,
      type: 'text',
      exact: 'Hello reviewers.',
      prefix: '',
      suffix: '',
      start: 0,
      end: 16,
      heading: 'Demo',
    },
    body: 'Who restarts the process?',
    idempotencyKey: 'create-key-0001',
    ...overrides,
  };
}

const identity = (fixture) => ({ artifact: fixture.artifactId, project: 'demo', file: 'sample.html' });

test('feedback API fails safe with 503 when FEEDBACK_DB is not bound', async () => {
  const { fixture, env } = await publicFixture();
  delete env.FEEDBACK_DB;
  const listed = await call('', { env, headers: ADMIN, query: identity(fixture) });
  assert.equal(listed.response.status, 503);
  assert.equal(listed.payload.code, 'feedback_not_configured');
});

test('public artifacts do not expose feedback publicly (grant/admin read gate)', async () => {
  const { fixture, env } = await publicFixture();
  const anonymous = await call('', { env, query: identity(fixture) });
  assert.equal(anonymous.response.status, 403);
  assert.equal(anonymous.payload.code, 'forbidden');

  const adminRead = await call('', { env, headers: ADMIN, query: identity(fixture) });
  assert.equal(adminRead.response.status, 200);
  assert.equal(adminRead.payload.artifact.artifactId, fixture.artifactId);
  assert.equal(adminRead.payload.artifact.revisioningEnabled, true);
  assert.equal(adminRead.payload.revision.revisionId, fixture.latest.revisionId);
  assert.equal(adminRead.payload.permissions.canComment, true);
  assert.equal(adminRead.payload.permissions.canChangeStatus, true);
  assert.equal(adminRead.payload.permissions.canResolve, true);
  assert.equal(adminRead.response.headers.get('cache-control'), 'no-store');
});

test('admin creates threads; idempotency is scoped by actor+payload and conflicts are explicit', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.thread.author.kind, 'owner');
  assert.equal(created.payload.thread.revisionNumber, 2);
  assert.equal(created.payload.thread.version, 1);
  assert.equal(created.payload.thread.messages.length, 1);
  const threadId = created.payload.thread.threadId;

  // Identical replay → 200, same thread.
  const replay = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.thread.threadId, threadId);

  // Same key, different payload → 409 idempotency_conflict with the current thread.
  const conflict = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { body: 'A different question.' }),
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.code, 'idempotency_conflict');
  assert.equal(conflict.payload.current.threadId, threadId);

  // Grants are also rejected on identity/body mismatches.
  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  const { cookie } = await redeem(grant.payload.token, env);
  const otherActor = await call('', { method: 'POST', env, headers: { cookie }, body: commentBody(fixture) });
  assert.equal(otherActor.response.status, 409);
  assert.equal(otherActor.payload.code, 'idempotency_conflict');
});

test('thread creation requires a registered revision and rejects unbootstrapped artifacts', async () => {
  const { fixture, env } = await publicFixture();
  const missing = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { revisionId: undefined }),
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.payload.code, 'invalid_revision');

  const unknown = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { revisionId: 'f'.repeat(64), idempotencyKey: 'unknown-rev-01' }),
  });
  assert.equal(unknown.response.status, 400);
  assert.equal(unknown.payload.code, 'invalid_revision');

  // Legacy fixture: catalog file + content bytes but no revision manifest.
  const legacyEnv = makeFeedbackEnv({}, { FEEDBACK_ADMIN_TOKEN: 'admin-secret' });
  const legacy = await call('', {
    method: 'POST',
    env: legacyEnv,
    headers: ADMIN,
    body: {
      project: 'demo',
      file: 'sample.html',
      revisionId: 'f'.repeat(64),
      kind: 'comment',
      anchor: { version: 1, type: 'document', exact: '' },
      body: 'whole document comment',
      idempotencyKey: 'legacy-key-01',
    },
  });
  assert.equal(legacy.response.status, 400);
  assert.equal(legacy.payload.code, 'invalid_revision');
});

test('review grant: /r/<token> redeems an HttpOnly artifact cookie; revocation wins immediately', async () => {
  const { fixture, env } = await publicFixture();
  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  assert.equal(grant.response.status, 201);
  assert.match(grant.payload.reviewUrl, /\/r\/gr_[0-9a-f]{32}\./);

  const redemption = await redeem(grant.payload.token, env);
  assert.equal(redemption.response.status, 302);
  assert.equal(redemption.response.headers.get('location'), '/demo/sample');
  assert.equal(redemption.response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(redemption.setCookie, /^cf_review_[0-9a-f]{16}=gr_/);
  assert.match(redemption.setCookie, /HttpOnly/);
  assert.match(redemption.setCookie, /SameSite=Strict/);
  assert.match(redemption.setCookie, /Secure/);
  assert.equal(redemption.response.headers.get('cache-control'), 'no-store');

  const { cookie } = redemption;
  const listed = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.permissions.canComment, true);
  assert.equal(listed.payload.permissions.canChangeStatus, false);

  const created = await call('', { method: 'POST', env, headers: { cookie }, body: commentBody(fixture, { idempotencyKey: 'reviewer-key-01' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.thread.author.kind, 'reviewer');
  const threadId = created.payload.thread.threadId;

  // Reviewer can resolve only against a recorded fixing revision.
  const prematureResolve = await call([threadId], {
    method: 'PATCH',
    env,
    headers: { cookie },
    body: { status: 'resolved', expectedVersion: 1 },
  });
  assert.equal(prematureResolve.response.status, 400);
  assert.equal(prematureResolve.payload.code, 'invalid_status');

  const addressed = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1 },
  });
  assert.equal(addressed.response.status, 200);
  assert.equal(addressed.payload.thread.addressedRevisionId, fixture.latest.revisionId);

  const resolved = await call([threadId], {
    method: 'PATCH',
    env,
    headers: { cookie },
    body: { status: 'resolved', expectedVersion: 2 },
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.payload.thread.status, 'resolved');

  const reopened = await call([threadId], {
    method: 'PATCH',
    env,
    headers: { cookie },
    body: { status: 'open', expectedVersion: 3 },
  });
  assert.equal(reopened.response.status, 200);
  assert.equal(reopened.payload.thread.addressedRevisionId, null);

  const revoked = await call(`grants/${grant.payload.grantId}`, { method: 'DELETE', env, headers: ADMIN });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.payload.revoked, true);

  const denied = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(denied.response.status, 403);
});

test('project cookie is read-only (never owner proof)', async () => {
  const { fixture, env } = await publicFixture({ PW_DEMO: 'secret' });
  const cookie = await projectCookie('demo', 'secret');

  const anonymous = await call('', { env, query: identity(fixture) });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.code, 'auth_required');

  const read = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(read.response.status, 200);
  assert.equal(read.payload.permissions.canComment, false);
  assert.equal(read.payload.permissions.canChangeStatus, false);

  const write = await call('', { method: 'POST', env, headers: { cookie }, body: commentBody(fixture) });
  assert.equal(write.response.status, 403);

  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: { cookie },
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  assert.equal(grant.response.status, 403);

  const adminWrite = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  assert.equal(adminWrite.response.status, 201);
});

test('status transitions, conflict shape and revision verification', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  const threadId = created.payload.thread.threadId;

  const stale = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 99 },
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.code, 'version_conflict');
  assert.equal(stale.payload.current.threadId, threadId);
  assert.equal(stale.payload.current.version, 1);

  const noFixingRevision = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'resolved', expectedVersion: 1 },
  });
  assert.equal(noFixingRevision.response.status, 400);
  assert.equal(noFixingRevision.payload.code, 'invalid_status');

  const addressed = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1 },
  });
  assert.equal(addressed.response.status, 200);

  // resolved → addressed is not an allowed transition.
  const resolved = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'resolved', expectedVersion: 2 },
  });
  assert.equal(resolved.response.status, 200);
  const unresolved = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 3 },
  });
  assert.equal(unresolved.response.status, 400);
  assert.equal(unresolved.payload.code, 'invalid_status');
});

test('export is gated and returns JSON/Markdown work queues', async () => {
  const { fixture, env } = await publicFixture();
  const anonymous = await call('export', { env, query: { ...identity(fixture), format: 'md' } });
  assert.equal(anonymous.response.status, 403);

  const created = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  const threadId = created.payload.thread.threadId;
  await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1 },
  });

  const jsonExport = await call('export', {
    env,
    headers: ADMIN,
    query: { ...identity(fixture), format: 'json' },
  });
  assert.equal(jsonExport.response.status, 200);
  assert.equal(jsonExport.payload.schemaVersion, 1);
  assert.equal(jsonExport.payload.threads.length, 1);
  assert.equal(jsonExport.payload.counts.addressed, 1);

  const mdExport = await call('export', {
    env,
    headers: ADMIN,
    query: { ...identity(fixture), format: 'md' },
  });
  assert.equal(mdExport.response.status, 200);
  assert.match(mdExport.response.headers.get('content-type'), /text\/markdown/);
  assert.match(mdExport.response.headers.get('content-disposition'), /attachment; filename="feedback-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.md"/);
  assert.match(mdExport.text, /Who restarts the process\?/);
  assert.match(mdExport.text, /ADDRESSED/);
  assert.match(mdExport.text, /Hello reviewers\./);
});

test('unpublished (tombstoned) artifacts and malformed registries fail closed', async () => {
  const { fixture, env } = await publicFixture();
  // Tombstone the manifest: feedback/history must be gone even though the fixture bytes exist.
  const tombstoned = { ...fixture.registry, tombstone: true, tombstonedAt: '2026-10-19T00:00:00.000Z' };
  const tombstoneEnv = makeFeedbackEnv(
    { ...fixture.objects, [`meta/revisions/${fixture.artifactId}.json`]: tombstoned },
    { FEEDBACK_ADMIN_TOKEN: 'admin-secret' },
  );
  const tombstonedList = await call('', { env: tombstoneEnv, headers: ADMIN, query: identity(fixture) });
  assert.equal(tombstonedList.response.status, 404);
  assert.equal(tombstonedList.payload.code, 'artifact_unknown');

  // Malformed protected registry: never treated as public.
  const malformed = await publicFixture();
  malformed.env.ARTIFACTS.putRaw('meta/protected.json', '{"not":"an array"}');
  const malformedRead = await call('', { env: malformed.env, query: identity(malformed.fixture) });
  assert.equal(malformedRead.response.status, 503);
  assert.equal(malformedRead.payload.code, 'registry_unavailable');
});

test('removed aliases and validation limits', async () => {
  const { fixture, env } = await publicFixture();
  const changes = await call('changes', { env, headers: ADMIN, query: identity(fixture) });
  assert.equal(changes.response.status, 404);
  const threadsAlias = await call('threads', { env, headers: ADMIN, query: identity(fixture) });
  assert.equal(threadsAlias.response.status, 404);

  const badAnchor = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { anchor: { version: 2, type: 'text', exact: 'x' } }),
  });
  assert.equal(badAnchor.response.status, 400);
  assert.equal(badAnchor.payload.code, 'invalid_anchor');

  const badContentType = await call('', {
    method: 'POST',
    env,
    headers: { ...ADMIN, 'content-type': 'text/plain' },
    body: commentBody(fixture),
  });
  assert.equal(badContentType.response.status, 415);

  const huge = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { body: 'x'.repeat(40 * 1024) }),
  });
  assert.equal(huge.response.status, 413);

  const unknown = await call('', { env, headers: ADMIN, query: { artifact: 'f'.repeat(32) } });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.payload.code, 'artifact_unknown');

  const deleteRoot = await call('', { method: 'DELETE', env, headers: ADMIN, query: identity(fixture) });
  assert.equal(deleteRoot.response.status, 405);
});

test('a review grant never bypasses the project/ghost gate', async () => {
  const { fixture, env } = await publicFixture({ PW_DEMO: 'secret' });
  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  const { cookie } = await redeem(grant.payload.token, env);
  assert.ok(cookie);

  // Grant cookie but no project session: protected artifact stays locked (401), no writes.
  const listed = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(listed.response.status, 401);
  assert.equal(listed.payload.code, 'auth_required');

  const write = await call('', {
    method: 'POST',
    env,
    headers: { cookie },
    body: commentBody(fixture, { idempotencyKey: 'bypass-key-01' }),
  });
  assert.equal(write.response.status, 401);

  // With the project session AND the grant, the reviewer can write.
  const project = await projectCookie('demo', 'secret');
  const both = await call('', {
    method: 'POST',
    env,
    headers: { cookie: `${project}; ${cookie}` },
    body: commentBody(fixture, { idempotencyKey: 'bypass-key-02' }),
  });
  assert.equal(both.response.status, 201);
});

test('stale review cookie with FEEDBACK_DB unbound is a clean 503, not a 500', async () => {
  const { fixture, env } = await publicFixture();
  delete env.FEEDBACK_DB;
  const staleCookie = 'cf_review_%s=gr_%s.%s'.replace('%s', fixture.artifactId.slice(0, 16)).replace('%s', 'f'.repeat(32)).replace('%s', 'f'.repeat(64));
  const response = await call('', { env, headers: { cookie: staleCookie }, query: identity(fixture) });
  assert.equal(response.response.status, 503);
  assert.equal(response.payload.code, 'feedback_not_configured');
});

test('resolve uses only the owner-recorded revision (no retargeting)', async () => {
  const { fixture, env } = await publicFixture();
  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  const { cookie } = await redeem(grant.payload.token, env);
  const created = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  const threadId = created.payload.thread.threadId;
  await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1 },
  });

  const retarget = await call([threadId], {
    method: 'PATCH',
    env,
    headers: { cookie },
    body: { status: 'resolved', expectedVersion: 2, addressedRevisionId: fixture.revisions[0].revisionId },
  });
  assert.equal(retarget.response.status, 400);
  assert.equal(retarget.payload.code, 'invalid_revision');

  const resolved = await call([threadId], {
    method: 'PATCH',
    env,
    headers: { cookie },
    body: { status: 'resolved', expectedVersion: 2 },
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.payload.thread.addressedRevisionId, fixture.latest.revisionId);
});

test('status mutation idempotency replays the prior receipt', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', { method: 'POST', env, headers: ADMIN, body: commentBody(fixture) });
  const threadId = created.payload.thread.threadId;
  const first = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1, idempotencyKey: 'status-key-0001' },
  });
  assert.equal(first.response.status, 200);

  const replay = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 1, idempotencyKey: 'status-key-0001' },
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.previousStatus, 'open');
  assert.equal(replay.payload.thread.version, 2);

  const mismatch = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 2, idempotencyKey: 'status-key-0001' },
  });
  assert.equal(mismatch.response.status, 409);
  assert.equal(mismatch.payload.code, 'idempotency_conflict');
});

test('markdown export escapes user Markdown structure; JSON export stays raw', async () => {
  const { fixture, env } = await publicFixture();
  const userBody = '# not a heading\n---\n[click](https://evil.example) **bold** <script>alert(1)</script>';
  const created = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { idempotencyKey: 'escape-key-01', body: userBody }),
  });
  assert.equal(created.response.status, 201);

  const mdExport = await call('export', {
    env,
    headers: ADMIN,
    query: { ...identity(fixture), format: 'md', status: 'open' },
  });
  assert.equal(mdExport.response.status, 200);
  assert.match(mdExport.text, /\\# not a heading/);
  assert.match(mdExport.text, /\\---/);
  assert.match(mdExport.text, /\\\[click\\\]\\\(https:\/\/evil\.example\\\)/);
  assert.match(mdExport.text, /&lt;script/);
  // No raw structural markdown from user text.
  assert.doesNotMatch(mdExport.text, /^# not a heading$/m);

  const jsonExport = await call('export', {
    env,
    headers: ADMIN,
    query: { ...identity(fixture), format: 'json', status: 'open' },
  });
  assert.equal(jsonExport.payload.threads[0].messages[0].body, userBody);
});

test('whole-document comments are accepted and stored verbatim', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, {
      idempotencyKey: 'document-key-01',
      anchor: { version: 1, type: 'document', exact: '' },
      body: 'Overall: nice structure.',
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.thread.anchor.type, 'document');
  assert.equal(created.payload.thread.messages[0].body, 'Overall: nice structure.');
});
