import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/feedback/[[path]].js';
import { onRequest as redeemRoute } from '../functions/r/[token].js';
import { resetRateLimits } from '../functions/_feedback.js';
import {
  MAX_MESSAGES_PER_ARTIFACT,
  MAX_MESSAGES_PER_THREAD,
  batch,
  countArtifactMessages,
  currentTxid,
  first,
  getThreadRow,
  run,
} from '../functions/_feedback-db.js';
import { resetRevisionCache } from '../functions/_feedback-revisions.js';
import { resetStoreCaches } from '../functions/_store.js';
import {
  ghostCookieToken,
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
  const { resetLimits = true, ...contextOptions } = options;
  if (resetLimits) resetRateLimits();
  resetStoreCaches();
  resetRevisionCache();
  const response = await onRequest(buildContext(segments, contextOptions));
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

test('public artifacts are open by default: anonymous read/write/reply/resolve/export', async () => {
  const { fixture, env } = await publicFixture();
  const anonymous = await call('', { env, query: identity(fixture) });
  assert.equal(anonymous.response.status, 200);
  assert.equal(anonymous.payload.artifact.artifactId, fixture.artifactId);
  assert.equal(anonymous.payload.revision.revisionId, fixture.latest.revisionId);
  assert.deepEqual(anonymous.payload.permissions, {
    canComment: true,
    canChangeStatus: false,
    canResolve: true,
    canExport: true,
  });
  assert.equal(anonymous.response.headers.get('cache-control'), 'no-store');

  const created = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'open-key-0001' }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.thread.author.kind, 'guest');
  assert.equal(created.payload.thread.author.name, 'Guest');
  assert.equal(created.payload.thread.author.unverified, true);
  const threadId = created.payload.thread.threadId;

  // A typed display name is kept, still unverified/guest.
  const named = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'open-key-0002', authorName: 'An' }),
  });
  assert.equal(named.response.status, 201);
  assert.equal(named.payload.thread.author.kind, 'guest');
  assert.equal(named.payload.thread.author.name, 'An');

  // Anonymous reply.
  const reply = await call([threadId, 'replies'], {
    method: 'POST',
    env,
    body: { body: 'Anonymous reply', idempotencyKey: 'open-reply-0001' },
  });
  assert.equal(reply.response.status, 201);
  assert.equal(reply.payload.thread.messages.length, 2);
  assert.equal(reply.payload.message.author.kind, 'guest');

  // Admin records the fixing revision; open-mode writers may resolve and reopen.
  const addressed = await call([threadId], {
    method: 'PATCH',
    env,
    headers: ADMIN,
    body: { status: 'addressed', expectedVersion: 2 },
  });
  assert.equal(addressed.response.status, 200);
  const resolved = await call([threadId], {
    method: 'PATCH',
    env,
    body: { status: 'resolved', expectedVersion: 3 },
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.payload.thread.status, 'resolved');
  const reopened = await call([threadId], {
    method: 'PATCH',
    env,
    body: { status: 'open', expectedVersion: 4 },
  });
  assert.equal(reopened.response.status, 200);

  // Addressed stays owner-only.
  const anonymousAddressed = await call([threadId], {
    method: 'PATCH',
    env,
    body: { status: 'addressed', expectedVersion: 5 },
  });
  assert.equal(anonymousAddressed.response.status, 403);

  // Anonymous export is allowed in open mode.
  const exported = await call('export', { env, query: { ...identity(fixture), format: 'md' } });
  assert.equal(exported.response.status, 200);

  // Admin keeps the full permission set.
  const adminRead = await call('', { env, headers: ADMIN, query: identity(fixture) });
  assert.equal(adminRead.response.status, 200);
  assert.equal(adminRead.payload.permissions.canChangeStatus, true);
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

  // Grants are optional in open mode: a revoked grant cookie falls back to guest access.
  const afterRevoke = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(afterRevoke.response.status, 200);
  assert.equal(afterRevoke.payload.permissions.canComment, true);
  const guestWrite = await call('', {
    method: 'POST',
    env,
    headers: { cookie },
    body: commentBody(fixture, { idempotencyKey: 'revoked-guest-01' }),
  });
  assert.equal(guestWrite.response.status, 201);
  assert.equal(guestWrite.payload.thread.author.kind, 'guest');
});

test('protected project: project cookie required, then open-mode read+write', async () => {
  const { fixture, env } = await publicFixture({ PW_DEMO: 'secret' });
  const cookie = await projectCookie('demo', 'secret');

  const anonymous = await call('', { env, query: identity(fixture) });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.code, 'auth_required');

  const read = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(read.response.status, 200);
  assert.equal(read.payload.permissions.canComment, true);
  assert.equal(read.payload.permissions.canChangeStatus, false);

  const write = await call('', {
    method: 'POST',
    env,
    headers: { cookie },
    body: commentBody(fixture, { idempotencyKey: 'project-open-key-01' }),
  });
  assert.equal(write.response.status, 201);
  assert.equal(write.payload.thread.author.kind, 'guest');
  assert.equal(write.payload.thread.author.name, 'Guest');

  // Project cookies are not owner proof: grant management stays admin-only.
  const grant = await call('grants', {
    method: 'POST',
    env,
    headers: { cookie },
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  assert.equal(grant.response.status, 403);

  const adminWrite = await call('', {
    method: 'POST',
    env,
    headers: ADMIN,
    body: commentBody(fixture, { idempotencyKey: 'project-admin-key-01' }),
  });
  assert.equal(adminWrite.response.status, 201);
});

test('ghost project: ghost cookie required, then open-mode read+write', async () => {
  const { fixture, env } = await publicFixture({ GHOST_MASTER_PW: 'ghost-master' });
  env.ARTIFACTS.putRaw('meta/ghost.json', ['demo']);

  const anonymous = await call('', { env, query: identity(fixture) });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.payload.code, 'auth_required');

  const cookie = await ghostCookieToken('ghost-master');
  const read = await call('', { env, headers: { cookie }, query: identity(fixture) });
  assert.equal(read.response.status, 200);
  assert.equal(read.payload.permissions.canComment, true);

  const write = await call('', {
    method: 'POST',
    env,
    headers: { cookie },
    body: commentBody(fixture, { idempotencyKey: 'ghost-key-0001' }),
  });
  assert.equal(write.response.status, 201);
  assert.equal(write.payload.thread.author.kind, 'guest');
});

test('FEEDBACK_REQUIRE_GRANT restores the legacy grant-required policy', async () => {
  // Public artifact under the legacy flag: anonymous has no access; grant/admin still work.
  const legacyPublic = await publicFixture({ FEEDBACK_REQUIRE_GRANT: '1' });
  const read = await call('', { env: legacyPublic.env, query: identity(legacyPublic.fixture) });
  assert.equal(read.response.status, 403);
  assert.equal(read.payload.code, 'forbidden');
  const write = await call('', {
    method: 'POST',
    env: legacyPublic.env,
    body: commentBody(legacyPublic.fixture),
  });
  assert.equal(write.response.status, 403);

  const adminRead = await call('', { env: legacyPublic.env, headers: ADMIN, query: identity(legacyPublic.fixture) });
  assert.equal(adminRead.response.status, 200);
  const adminWrite = await call('', {
    method: 'POST',
    env: legacyPublic.env,
    headers: ADMIN,
    body: commentBody(legacyPublic.fixture),
  });
  assert.equal(adminWrite.response.status, 201);

  const grant = await call('grants', {
    method: 'POST',
    env: legacyPublic.env,
    headers: ADMIN,
    body: { project: 'demo', file: 'sample.html', ttlSeconds: 3600 },
  });
  const { cookie } = await redeem(grant.payload.token, legacyPublic.env);
  const reviewerRead = await call('', { env: legacyPublic.env, headers: { cookie }, query: identity(legacyPublic.fixture) });
  assert.equal(reviewerRead.response.status, 200);
  assert.equal(reviewerRead.payload.permissions.canComment, true);
  const reviewerWrite = await call('', {
    method: 'POST',
    env: legacyPublic.env,
    headers: { cookie },
    body: commentBody(legacyPublic.fixture, { idempotencyKey: 'legacy-reviewer-01' }),
  });
  assert.equal(reviewerWrite.response.status, 201);
  assert.equal(reviewerWrite.payload.thread.author.kind, 'reviewer');

  // Protected project under the legacy flag: project cookie is read-only again. 'true' also works.
  const legacyProtected = await publicFixture({ PW_DEMO: 'secret', FEEDBACK_REQUIRE_GRANT: 'true' });
  const project = await projectCookie('demo', 'secret');
  const projectRead = await call('', { env: legacyProtected.env, headers: { cookie: project }, query: identity(legacyProtected.fixture) });
  assert.equal(projectRead.response.status, 200);
  assert.equal(projectRead.payload.permissions.canComment, false);
  const projectWrite = await call('', {
    method: 'POST',
    env: legacyProtected.env,
    headers: { cookie: project },
    body: commentBody(legacyProtected.fixture, { idempotencyKey: 'legacy-project-01' }),
  });
  assert.equal(projectWrite.response.status, 403);
});

test('anonymous identity is per client IP (idempotency scope + rate limit buckets)', async () => {
  const { fixture, env } = await publicFixture();
  const ipA = { 'cf-connecting-ip': '203.0.113.10' };
  const ipB = { 'cf-connecting-ip': '203.0.113.20' };
  const body = commentBody(fixture, { idempotencyKey: 'ip-key-0001' });

  const first = await call('', { method: 'POST', env, headers: ipA, body });
  assert.equal(first.response.status, 201);
  const replay = await call('', { method: 'POST', env, headers: ipA, body });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.thread.threadId, first.payload.thread.threadId);

  // The same key from another IP is a different actor → explicit conflict, not a leaked thread.
  const fromB = await call('', { method: 'POST', env, headers: ipB, body });
  assert.equal(fromB.response.status, 409);
  assert.equal(fromB.payload.code, 'idempotency_conflict');

  // Write buckets are per IP too: 30 writes/min per identity, then 429; another IP is unaffected.
  for (let index = 0; index < 30; index++) {
    const allowed = await call('', {
      method: 'POST',
      env,
      headers: ipA,
      body: commentBody(fixture, {
        idempotencyKey: `rate-key-${String(index).padStart(4, '0')}`,
        body: `Comment ${index}`,
      }),
      resetLimits: false,
    });
    assert.equal(allowed.response.status, 201, `request ${index}`);
  }
  const throttled = await call('', {
    method: 'POST',
    env,
    headers: ipA,
    body: commentBody(fixture, { idempotencyKey: 'rate-key-9999', body: 'one more' }),
    resetLimits: false,
  });
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.payload.code, 'rate_limited');

  const otherIp = await call('', {
    method: 'POST',
    env,
    headers: ipB,
    body: commentBody(fixture, { idempotencyKey: 'rate-key-ipb', body: 'fresh ip' }),
    resetLimits: false,
  });
  assert.equal(otherIp.response.status, 201);
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

test('export returns JSON/Markdown work queues (anonymous allowed in open mode)', async () => {
  const { fixture, env } = await publicFixture();
  const anonymous = await call('export', { env, query: { ...identity(fixture), format: 'md' } });
  assert.equal(anonymous.response.status, 200);
  assert.match(anonymous.text, /# Review feedback/);

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

test('hard cap: the 101st message in a thread is rejected with feedback_capacity', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'cap-create-0001' }),
  });
  assert.equal(created.response.status, 201);
  const threadId = created.payload.thread.threadId;

  for (let index = 0; index < MAX_MESSAGES_PER_THREAD - 1; index++) {
    const reply = await call([threadId, 'replies'], {
      method: 'POST',
      env,
      body: { body: `reply ${index}`, idempotencyKey: `cap-reply-${String(index).padStart(4, '0')}` },
    });
    assert.equal(reply.response.status, 201, `reply ${index}`);
  }
  const atLimit = await call([threadId], { env });
  assert.equal(atLimit.payload.thread.messages.length, MAX_MESSAGES_PER_THREAD);

  const overflow = await call([threadId, 'replies'], {
    method: 'POST',
    env,
    body: { body: 'one too many', idempotencyKey: 'cap-reply-overflow' },
  });
  assert.equal(overflow.response.status, 429);
  assert.equal(overflow.payload.code, 'feedback_capacity');
  assert.equal(overflow.payload.maxMessagesPerThread, MAX_MESSAGES_PER_THREAD);
  assert.equal(overflow.payload.maxMessagesPerArtifact, MAX_MESSAGES_PER_ARTIFACT);

  const unchanged = await call([threadId], { env });
  assert.equal(unchanged.payload.thread.messages.length, MAX_MESSAGES_PER_THREAD);
});

test('hard cap: artifact-wide message capacity rejects new threads and replies', async () => {
  const { fixture, env } = await publicFixture();
  const threadIds = [];
  for (let index = 0; index < 6; index++) {
    const created = await call('', {
      method: 'POST',
      env,
      body: commentBody(fixture, {
        idempotencyKey: `artcap-create-${index}`,
        body: `thread ${index}`,
      }),
    });
    assert.equal(created.response.status, 201);
    threadIds.push(created.payload.thread.threadId);
  }

  // Fixture setup only: fill threads past the per-thread cap directly so we can reach the
  // artifact-wide cap without hundreds of API round-trips. The route-level guards are exercised
  // below against the resulting counts.
  async function rawFill(threadId, fromSeq, count) {
    const statements = [];
    for (let offset = 0; offset < count; offset++) {
      const seq = fromSeq + offset;
      statements.push({
        sql: `INSERT INTO messages (
                message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
                created_at, client_id, client_actor, payload_hash
              ) VALUES (?, ?, ?, ?, 'comment', NULL, 'Guest', 'guest',
                        '2026-10-19T00:00:00.000Z', NULL, 'guest:fixture', NULL)`,
        params: [`msg_fill_${threadId}_${seq}`, threadId, seq, `fill ${seq}`],
      });
    }
    await batch(env, statements);
  }

  // 6 threads × 1 message = 6. Fill five threads to the per-thread cap (5 × 99 = 495 → 501 total)
  // would overshoot; fill four threads to 100 (396), one to 100 (99), leaving the last thread at 1:
  // 4×100 + 100 + 1 + 1 = 501 > cap, so fill 4 threads (396) + one to 100 (99) = 501? use exact math:
  // start 6; fill 4 threads with 99 each = 396 → 402; fill fifth with 97 → 499; add 1 to fifth → 500.
  await rawFill(threadIds[0], 2, 99);
  await rawFill(threadIds[1], 2, 99);
  await rawFill(threadIds[2], 2, 99);
  await rawFill(threadIds[3], 2, 99);
  await rawFill(threadIds[4], 2, 98);
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT);

  const newThread = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'artcap-new-thread', body: 'over capacity' }),
  });
  assert.equal(newThread.response.status, 429);
  assert.equal(newThread.payload.code, 'feedback_capacity');

  // The last thread is not full itself but the artifact cap rejects the reply.
  const reply = await call([threadIds[5], 'replies'], {
    method: 'POST',
    env,
    body: { body: 'artifact full', idempotencyKey: 'artcap-reply' },
  });
  assert.equal(reply.response.status, 429);
  assert.equal(reply.payload.code, 'feedback_capacity');
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT);
});

test('list hydration is bounded by the per-thread cap', async () => {
  const { fixture, env } = await publicFixture();
  const created = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'hydrate-create-0001' }),
  });
  const threadId = created.payload.thread.threadId;

  // Fixture setup: insert more rows than the cap directly; hydration must clamp to 100.
  const statements = [];
  for (let seq = 2; seq <= MAX_MESSAGES_PER_THREAD + 50; seq++) {
    statements.push({
      sql: `INSERT INTO messages (
              message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
              created_at, client_id, client_actor, payload_hash
            ) VALUES (?, ?, ?, ?, 'comment', NULL, 'Guest', 'guest',
                      '2026-10-19T00:00:00.000Z', NULL, 'guest:fixture', NULL)`,
      params: [`msg_hydrate_${seq}`, threadId, seq, `hydrate ${seq}`],
    });
  }
  await batch(env, statements);

  const thread = await call([threadId], { env });
  assert.equal(thread.response.status, 200);
  assert.equal(thread.payload.thread.messages.length, MAX_MESSAGES_PER_THREAD);
  assert.equal(thread.payload.thread.replies.length, MAX_MESSAGES_PER_THREAD - 1);

  const listed = await call('', { env, query: { ...identity(fixture), limit: '1' } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.threads[0].messages.length, MAX_MESSAGES_PER_THREAD);
});

test('P2: project-session write buckets are per IP, not shared across the cookie', async () => {
  const { fixture, env } = await publicFixture({ PW_DEMO: 'secret' });
  const cookie = await projectCookie('demo', 'secret');
  const ipA = { 'cf-connecting-ip': '203.0.113.41' };
  const ipB = { 'cf-connecting-ip': '203.0.113.42' };

  await call('', { env, headers: { cookie }, query: identity(fixture), resetLimits: true });
  for (let index = 0; index < 30; index++) {
    const allowed = await call('', {
      method: 'POST',
      env,
      headers: { cookie, ...ipA },
      body: commentBody(fixture, {
        idempotencyKey: `proj-rate-${String(index).padStart(4, '0')}`,
        body: `project write ${index}`,
      }),
      resetLimits: false,
    });
    assert.equal(allowed.response.status, 201, `write ${index}`);
  }
  const throttled = await call('', {
    method: 'POST',
    env,
    headers: { cookie, ...ipA },
    body: commentBody(fixture, { idempotencyKey: 'proj-rate-overflow', body: 'one more' }),
    resetLimits: false,
  });
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.payload.code, 'rate_limited');

  // Same project cookie, different IP: its own write bucket is untouched.
  const otherIp = await call('', {
    method: 'POST',
    env,
    headers: { cookie, ...ipB },
    body: commentBody(fixture, { idempotencyKey: 'proj-rate-other-ip', body: 'other ip' }),
    resetLimits: false,
  });
  assert.equal(otherIp.response.status, 201);
});

test('P3: X-Forwarded-For is ignored for client identity', async () => {
  const { fixture, env } = await publicFixture();
  await call('', { env, query: identity(fixture), resetLimits: true });
  for (let index = 0; index < 30; index++) {
    // Spoofed XFF values must NOT mint a fresh bucket: all map to the shared `unknown` identity.
    const allowed = await call('', {
      method: 'POST',
      env,
      headers: { 'x-forwarded-for': `198.51.100.${index}` },
      body: commentBody(fixture, {
        idempotencyKey: `xff-rate-${String(index).padStart(4, '0')}`,
        body: `xff write ${index}`,
      }),
      resetLimits: false,
    });
    assert.equal(allowed.response.status, 201, `write ${index}`);
  }
  const throttled = await call('', {
    method: 'POST',
    env,
    headers: { 'x-forwarded-for': '198.51.100.250' },
    body: commentBody(fixture, { idempotencyKey: 'xff-rate-overflow', body: 'spoofed ip' }),
    resetLimits: false,
  });
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.payload.code, 'rate_limited');
});

test('race: create at the artifact cap returns 201/429 — never 500 (guarded insert)', async () => {
  const { fixture, env } = await publicFixture();
  const seed = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'race-seed-01', body: 'seed' }),
  });
  assert.equal(seed.response.status, 201);
  const threadId = seed.payload.thread.threadId;

  let seq = 1;
  const fillerIds = [];
  async function rawFill(count) {
    const statements = [];
    for (let offset = 0; offset < count; offset++) {
      seq += 1;
      const messageId = `msg_race_${seq}`;
      fillerIds.push(messageId);
      statements.push({
        sql: `INSERT INTO messages (
                message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
                created_at, client_id, client_actor, payload_hash
              ) VALUES (?, ?, ?, ?, 'comment', NULL, 'Guest', 'guest',
                        '2026-10-19T00:00:00.000Z', NULL, 'guest:fixture', NULL)`,
        params: [messageId, threadId, seq, `fill ${seq}`],
      });
    }
    await batch(env, statements);
  }

  // 499 messages: enough for exactly one more thread-create before the artifact cap.
  await rawFill(MAX_MESSAGES_PER_ARTIFACT - 2);
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT - 1);
  const threadCountBefore = Number(
    (await first(env, 'SELECT COUNT(*) AS count FROM threads WHERE artifact_id = ?', [fixture.artifactId])).count,
  );

  // The 500th slot is granted normally.
  const lastSlot = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'race-last-slot', body: 'last slot' }),
  });
  assert.equal(lastSlot.response.status, 201);
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT);

  // Over cap: fast pre-check → stable 429.
  const full = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'race-full', body: 'full' }),
  });
  assert.equal(full.response.status, 429);
  assert.equal(full.payload.code, 'feedback_capacity');

  // Transaction-time race: free one slot, then let a "concurrent writer" consume it after the
  // route pre-check but before the guarded thread INSERT executes. The guarded insert writes 0
  // rows → the route must return 429 feedback_capacity, never hydrate a null row (500).
  const removedId = fillerIds.pop();
  await run(env, 'DELETE FROM messages WHERE message_id = ?', [removedId]);
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT - 1);

  const shim = env.FEEDBACK_DB;
  const originalPrepare = shim.prepare.bind(shim);
  const originalBatch = shim.batch.bind(shim);
  let injected = false;
  env.FEEDBACK_DB = {
    prepare: (sql) => originalPrepare(sql),
    async batch(statements) {
      const firstStatement = statements[0];
      if (!injected && firstStatement && String(firstStatement.sql).includes('INSERT INTO threads')) {
        injected = true;
        seq += 1;
        // Concurrent writer takes the last slot.
        await originalBatch([
          originalPrepare(
            `INSERT INTO messages (
               message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
               created_at, client_id, client_actor, payload_hash
             ) VALUES (?, ?, ?, ?, 'comment', NULL, 'Guest', 'guest',
                       '2026-10-19T00:00:00.000Z', NULL, 'guest:fixture', NULL)`,
          ).bind(`msg_race_injected`, threadId, seq, 'injected concurrent write'),
        ]);
      }
      return originalBatch(statements);
    },
  };
  try {
    const raced = await call('', {
      method: 'POST',
      env,
      body: commentBody(fixture, { idempotencyKey: 'race-guarded', body: 'race guarded create' }),
    });
    assert.notEqual(raced.response.status, 500, 'guarded rejection must not crash on a null row');
    assert.equal(raced.response.status, 429);
    assert.equal(raced.payload.code, 'feedback_capacity');
  } finally {
    env.FEEDBACK_DB = shim;
  }
  assert.equal(await countArtifactMessages(env, fixture.artifactId), MAX_MESSAGES_PER_ARTIFACT);
  const threadCountAfter = Number(
    (await first(env, 'SELECT COUNT(*) AS count FROM threads WHERE artifact_id = ?', [fixture.artifactId])).count,
  );
  assert.equal(threadCountAfter, threadCountBefore + 1); // only the successful 500th-slot thread
});

test('race: capacity-rejected reply changes no thread state and cannot cross-link events', async () => {
  const { fixture, env } = await publicFixture();
  const a = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'race-reply-a', body: 'thread A' }),
  });
  assert.equal(a.response.status, 201);
  const aId = a.payload.thread.threadId;

  // Fill A to the per-thread cap with raw rows (fixture setup).
  const statements = [];
  for (let seq = 2; seq <= MAX_MESSAGES_PER_THREAD; seq++) {
    statements.push({
      sql: `INSERT INTO messages (
              message_id, thread_id, seq, body, kind, replacement, author_name, author_kind,
              created_at, client_id, client_actor, payload_hash
            ) VALUES (?, ?, ?, ?, 'comment', NULL, 'Guest', 'guest',
                      '2026-10-19T00:00:00.000Z', NULL, 'guest:fixture', NULL)`,
      params: [`msg_race_reply_${seq}`, aId, seq, `fill ${seq}`],
    });
  }
  await batch(env, statements);

  // Create a second thread AFTER A is full, so its event ids are higher: a broken UPDATE would
  // point A.last_event_id at B's event (the reported defect).
  const b = await call('', {
    method: 'POST',
    env,
    body: commentBody(fixture, { idempotencyKey: 'race-reply-b', body: 'thread B' }),
  });
  assert.equal(b.response.status, 201);
  const bRow = await getThreadRow(env, b.payload.thread.threadId);
  const aBefore = await getThreadRow(env, aId);
  assert.ok(Number(bRow.last_event_id) > Number(aBefore.last_event_id));
  const txidBefore = await currentTxid(env);

  const rejected = await call([aId, 'replies'], {
    method: 'POST',
    env,
    body: { body: 'overflow', idempotencyKey: 'race-reply-overflow' },
  });
  assert.equal(rejected.response.status, 429);
  assert.equal(rejected.payload.code, 'feedback_capacity');

  const aAfter = await getThreadRow(env, aId);
  assert.equal(aAfter.version, aBefore.version, 'version must not advance on a rejected reply');
  assert.equal(aAfter.last_event_id, aBefore.last_event_id, 'last_event_id must not move');
  assert.equal(aAfter.updated_at, aBefore.updated_at, 'updated_at must not change');
  assert.notEqual(aAfter.last_event_id, bRow.last_event_id, 'must not cross-link another thread event');
  assert.equal(await currentTxid(env), txidBefore, 'no event/receipt may be appended');
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
