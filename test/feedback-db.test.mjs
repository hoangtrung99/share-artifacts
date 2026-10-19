import assert from 'node:assert/strict';
import test from 'node:test';
import { accessCapabilities } from '../functions/_feedback.js';
import {
  all,
  countStatuses,
  currentTxid,
  findGrantByToken,
  findMessageByClientId,
  findThreadByClientId,
  first,
  getGrantRow,
  getThreadRow,
  hydrateThread,
  insertGrant,
  insertMessage,
  insertThread,
  isUniqueConstraintError,
  listChangedThreadRows,
  listMessages,
  listThreadRows,
  revokeGrant,
  run,
  updateThreadStatus,
  verifyGrant,
} from '../functions/_feedback-db.js';
import { artifactIdFor, sha256Hex } from '../functions/_feedback-revisions.js';
import { makeFeedbackEnv } from './feedback-sqlite-helper.mjs';

const ARTIFACT_ID = '11111111111111111111111111111111';
const REVISION_A = 'a'.repeat(64);
const REVISION_B = 'b'.repeat(64);

function threadInput(overrides = {}) {
  return {
    threadId: 'th_00000000000000000000000000000001',
    artifactId: ARTIFACT_ID,
    project: 'demo',
    file: 'sample.html',
    revisionId: REVISION_A,
    kind: 'comment',
    anchor: { version: 1, type: 'text', exact: 'Hello reviewers', prefix: '', suffix: '', start: 0, end: 15 },
    replacement: null,
    createdAt: '2026-10-19T00:00:00.000Z',
    author: { name: 'Owner', kind: 'owner' },
    clientId: 'create-key-0001',
    clientActor: 'admin',
    payloadHash: 'hash-create-0001',
    messageId: 'msg_00000000000000000000000000000001',
    body: 'Who restarts the process?',
    ...overrides,
  };
}

function messageInput(thread, overrides = {}) {
  return {
    messageId: 'msg_00000000000000000000000000000002',
    thread,
    body: 'Fixed in v2.',
    kind: 'comment',
    replacement: null,
    author: { name: 'Owner', kind: 'owner' },
    createdAt: '2026-10-19T00:05:00.000Z',
    clientId: 'reply-key-0001',
    clientActor: 'admin',
    payloadHash: 'hash-reply-0001',
    ...overrides,
  };
}

test('thread + first message: insert, hydrate, counts and txid', async () => {
  const env = makeFeedbackEnv();
  await insertThread(env, threadInput());

  const row = await getThreadRow(env, 'th_00000000000000000000000000000001');
  assert.ok(row);
  assert.equal(row.status, 'open');
  assert.equal(Number(row.version), 1);
  assert.equal(row.client_actor, 'admin');
  assert.ok(Number(row.last_event_id) > 0);

  const messages = await listMessages(env, row.thread_id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, 'Who restarts the process?');
  assert.equal(messages[0].payload_hash, 'hash-create-0001');

  assert.deepEqual(await countStatuses(env, ARTIFACT_ID), { open: 1, addressed: 0, resolved: 0 });
  assert.equal(await currentTxid(env), 1);

  const thread = await hydrateThread(env, row, {
    access: accessCapabilities({ admin: true }),
    revisionNumbers: new Map([[REVISION_A, 2]]),
  });
  assert.equal(thread.threadId, row.thread_id);
  assert.equal(thread.revisionNumber, 2);
  assert.equal(thread.status, 'open');
  assert.equal(thread.author.kind, 'owner');
  assert.equal(thread.author.unverified, false);
  assert.equal(thread.messages.length, 1);
  assert.deepEqual(thread.replies, []);
  assert.equal(thread.permissions.canResolve, true);
  assert.equal(thread.anchor.exact, 'Hello reviewers');
});

test('create idempotency: duplicate client key hits the unique constraint', async () => {
  const env = makeFeedbackEnv();
  await insertThread(env, threadInput());
  let error = null;
  try {
    await insertThread(env, threadInput({ threadId: 'th_00000000000000000000000000000002' }));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(isUniqueConstraintError(error), true);
  const existing = await findThreadByClientId(env, ARTIFACT_ID, 'create-key-0001');
  assert.equal(existing.thread_id, 'th_00000000000000000000000000000001');
  assert.equal(existing.client_actor, 'admin');
  assert.equal(existing.payload_hash, 'hash-create-0001');
});

test('reply append is CAS-guarded: stale version writes no message and no receipt', async () => {
  const env = makeFeedbackEnv();
  await insertThread(env, threadInput());
  const stale = await getThreadRow(env, 'th_00000000000000000000000000000001');
  const firstReply = await insertMessage(env, messageInput(stale));
  assert.equal(firstReply.ok, true);

  const txidAfterFirst = await currentTxid(env);
  const second = await insertMessage(env, messageInput(stale, {
    messageId: 'msg_00000000000000000000000000000003',
    clientId: 'reply-key-0002',
    payloadHash: 'hash-reply-0002',
  }));
  assert.equal(second.ok, false);

  // A CAS miss must not append a success event (guarded receipt insert).
  assert.equal(await currentTxid(env), txidAfterFirst);
  const events = await all(env, "SELECT type FROM events WHERE type = 'message.create'");
  assert.equal(events.length, 1);

  const fresh = await getThreadRow(env, 'th_00000000000000000000000000000001');
  assert.equal(Number(fresh.version), 2);
  assert.equal((await listMessages(env, fresh.thread_id)).length, 2);
  assert.ok(await findMessageByClientId(env, fresh.thread_id, 'reply-key-0001'));
});

test('status changes are CAS-guarded, record receipts, and keep addressed revision', async () => {
  const env = makeFeedbackEnv();
  await insertThread(env, threadInput());
  let row = await getThreadRow(env, 'th_00000000000000000000000000000001');

  const addressed = await updateThreadStatus(env, {
    thread: row,
    status: 'addressed',
    addressedRevisionId: REVISION_B,
    actor: { name: 'Owner', kind: 'owner' },
    actorIdentity: 'admin',
    updatedAt: '2026-10-19T00:10:00.000Z',
    clientActor: 'admin',
    payloadHash: 'hash-status-0001',
  });
  assert.equal(addressed.ok, true);

  const txid = await currentTxid(env);
  const stale = await updateThreadStatus(env, {
    thread: row,
    status: 'resolved',
    addressedRevisionId: REVISION_B,
    actor: { name: 'Owner', kind: 'owner' },
    actorIdentity: 'admin',
    updatedAt: '2026-10-19T00:11:00.000Z',
  });
  assert.equal(stale.ok, false);
  assert.equal(await currentTxid(env), txid, 'stale CAS must not append a receipt');

  row = await getThreadRow(env, 'th_00000000000000000000000000000001');
  assert.equal(row.status, 'addressed');
  assert.equal(row.addressed_revision_id, REVISION_B);

  const resolved = await updateThreadStatus(env, {
    thread: row,
    status: 'resolved',
    addressedRevisionId: REVISION_B,
    actor: { name: 'Owner', kind: 'owner' },
    actorIdentity: 'admin',
    updatedAt: '2026-10-19T00:12:00.000Z',
  });
  assert.equal(resolved.ok, true);
  assert.equal((await getThreadRow(env, row.thread_id)).status, 'resolved');

  const latestEvent = await first(
    env,
    "SELECT meta_json FROM events WHERE type = 'status.change' ORDER BY event_id DESC LIMIT 1",
  );
  assert.deepEqual(JSON.parse(latestEvent.meta_json), {
    before: 'addressed',
    after: 'resolved',
    addressedRevisionId: REVISION_B,
    actor: 'admin',
  });
});

test('changes feed only reports threads after the given txid', async () => {
  const env = makeFeedbackEnv();
  await insertThread(env, threadInput());
  const firstRow = await getThreadRow(env, 'th_00000000000000000000000000000001');
  const afterCreate = await currentTxid(env);

  await insertThread(env, threadInput({
    threadId: 'th_00000000000000000000000000000002',
    clientId: 'create-key-0002',
    messageId: 'msg_00000000000000000000000000000002',
    payloadHash: 'hash-create-0002',
  }));

  const changed = await listChangedThreadRows(env, ARTIFACT_ID, afterCreate, 10);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].thread_id, 'th_00000000000000000000000000000002');

  const everything = await listChangedThreadRows(env, ARTIFACT_ID, 0, 10);
  assert.equal(everything.length, 2);
  assert.equal(everything[0].thread_id, firstRow.thread_id);
});

test('list pagination: newest change first with a stable cursor', async () => {
  const env = makeFeedbackEnv();
  for (let index = 1; index <= 3; index++) {
    await insertThread(env, threadInput({
      threadId: `th_0000000000000000000000000000000${index}`,
      clientId: `create-key-000${index}`,
      messageId: `msg_0000000000000000000000000000000${index}`,
      payloadHash: `hash-create-000${index}`,
      createdAt: `2026-10-19T00:0${index}:00.000Z`,
    }));
  }
  const firstPage = await listThreadRows(env, { artifactId: ARTIFACT_ID, limit: 2 });
  assert.equal(firstPage.length, 2);
  assert.equal(firstPage[0].thread_id, 'th_00000000000000000000000000000003');
  const secondPage = await listThreadRows(env, {
    artifactId: ARTIFACT_ID,
    limit: 2,
    cursor: firstPage[1].last_event_id,
  });
  assert.equal(secondPage.length, 1);
  assert.equal(secondPage[0].thread_id, 'th_00000000000000000000000000000001');
});

test('grants: create, verify by token, expire and revoke', async () => {
  const env = makeFeedbackEnv();
  const grant = await insertGrant(env, {
    artifactId: ARTIFACT_ID,
    project: 'demo',
    file: 'sample.html',
    scope: 'comment',
    ttlSeconds: 3600,
    createdBy: 'admin',
  });
  assert.match(grant.token, /^gr_[0-9a-f]{32}\.[0-9a-f]{64}$/);
  assert.ok((await findGrantByToken(env, grant.token)) !== null);
  assert.equal(await findGrantByToken(env, `gr_${'f'.repeat(32)}.${'f'.repeat(64)}`), null);
  assert.ok((await verifyGrant(env, grant.token, ARTIFACT_ID)) !== null);
  assert.equal(await verifyGrant(env, grant.token, '2'.repeat(32)), null);

  const row = await getGrantRow(env, grant.grantId);
  assert.equal(row.scope, 'comment');
  assert.equal(row.revoked_at, null);

  await run(env, "UPDATE grants SET expires_at = '2000-01-01T00:00:00.000Z' WHERE grant_id = ?", [grant.grantId]);
  assert.equal(await verifyGrant(env, grant.token, ARTIFACT_ID), null);
  assert.equal(await findGrantByToken(env, grant.token), null);

  const second = await insertGrant(env, {
    artifactId: ARTIFACT_ID,
    project: 'demo',
    file: 'sample.html',
    scope: 'comment',
    ttlSeconds: 3600,
    createdBy: 'admin',
  });
  assert.equal(await revokeGrant(env, second.grantId), true);
  assert.equal(await revokeGrant(env, second.grantId), false);
  assert.equal(await verifyGrant(env, second.token, ARTIFACT_ID), null);
  assert.equal(await findGrantByToken(env, second.token), null);
});

test('artifact ids are deterministic and content hashes are stable', async () => {
  const firstId = await artifactIdFor('demo', 'sample.html');
  const secondId = await artifactIdFor('demo', 'sample.html');
  const other = await artifactIdFor('demo', 'other.html');
  assert.equal(firstId, secondId);
  assert.notEqual(firstId, other);
  assert.match(firstId, /^[0-9a-f]{32}$/);
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
