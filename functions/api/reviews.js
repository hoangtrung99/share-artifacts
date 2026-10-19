// POST/GET /api/reviews — append-only design-review feedback for one artifact.
//
// This is a one-off feature for a specific review dashboard. It is still gated by the existing
// signed project cookie, same-origin JSON, bounded body/pagination and strict field validation.
// The password-version binding in the token means rotating PW_VERUPS revokes reviewer sessions.
//
// Storage: R2 reviews/<project>/<artifact>/<timestamp>-<uuid>.json (test submissions under
// reviews/_tests/...). Failure modes are generic 503s so storage internals never leak.

import { cookieName, pwKey, readCookie, verifyToken, pwVersion } from '../_auth.js';
import { jsonResponse } from '../_http.js';

const PROJECT = 'verups';
const ARTIFACT = 'verup-dashboard-prototype-2026-10-08';
const MAX_BODY_BYTES = 512 * 1024;
// Preserve notes on the original 47 panels and the three revised panels.
const MAX_NOTES = 50;
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;
const DECISIONS = new Set(['none', 'keep', 'change', 'remove']);

const json = (body, status = 200, headers = {}) => jsonResponse(body, status, headers);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new RequestError(413, 'Review exceeds the 512 KiB limit.');
  }
  if (!request.body) throw new RequestError(400, 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestError(413, 'Review exceeds the 512 KiB limit.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Invalid JSON body.');
  } finally {
    reader.releaseLock();
  }
}

function text(value, max, optional = false) {
  return typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0);
}

function identifiers(values) {
  return Array.isArray(values) && values.length <= MAX_NOTES && values.every(value => typeof value === 'string' && IDENTIFIER.test(value));
}

function normalizeReview(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || !text(body.title, 240) || !Number.isInteger(body.version) || body.version < 1 || body.version > 1000
      || !text(body.designDate, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(body.designDate)
      || !text(body.dataMode, 40) || !text(body.reviewer ?? '', 80, true)
      || (body.test !== undefined && typeof body.test !== 'boolean')
      || !Array.isArray(body.boards) || body.boards.length < 1 || body.boards.length > 10
      || !Array.isArray(body.notes) || body.notes.length < 1 || body.notes.length > MAX_NOTES) return null;

  const boardIds = new Set();
  const boards = [];
  for (const board of body.boards) {
    if (!board || typeof board.id !== 'string' || !IDENTIFIER.test(board.id) || boardIds.has(board.id)
        || !text(board.title, 240)
        || (board.widgets !== undefined && !identifiers(board.widgets))
        || (board.optional !== undefined && !identifiers(board.optional))) return null;
    boardIds.add(board.id);
    boards.push({ id: board.id, title: board.title,
      ...(board.widgets === undefined ? {} : { widgets: board.widgets }),
      ...(board.optional === undefined ? {} : { optional: board.optional }) });
  }

  const widgetIds = new Set();
  const notes = [];
  for (const note of body.notes) {
    if (!note || typeof note.widget !== 'string' || !IDENTIFIER.test(note.widget) || widgetIds.has(note.widget)
        || !text(note.title, 240) || !DECISIONS.has(note.decision) || !text(note.comment ?? '', 8000, true)) return null;
    widgetIds.add(note.widget);
    notes.push({ widget: note.widget, title: note.title, decision: note.decision, comment: note.comment ?? '' });
  }
  return {
    title: body.title, version: body.version, designDate: body.designDate,
    dataMode: body.dataMode, reviewer: (body.reviewer ?? '').trim(),
    boards, notes, test: body.test === true,
  };
}

function reviewPrefix(test) {
  return `reviews/${test ? '_tests/' : ''}${PROJECT}/${ARTIFACT}/`;
}

async function submit(request, env, url) {
  if (request.headers.get('origin') !== url.origin) {
    return json({ error: 'Same-origin submission is required.' }, 403);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Content-Type must be application/json.' }, 415);
  }
  const review = normalizeReview(await readJson(request));
  if (!review) return json({ error: 'Invalid review fields or limits.' }, 400);
  const receivedAt = new Date().toISOString();
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const record = { id, receivedAt, project: PROJECT, artifact: ARTIFACT, ...review };
  await env.ARTIFACTS.put(reviewPrefix(review.test) + id + '.json', JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  });
  return json({ id, receivedAt }, 201);
}

async function list(env, url) {
  const limitValue = url.searchParams.get('limit') ?? '20';
  if (!/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100) {
    return json({ error: 'Limit must be an integer from 1 to 100.' }, 400);
  }
  const testValue = url.searchParams.get('test');
  if (testValue !== null && testValue !== '0' && testValue !== '1') {
    return json({ error: 'Test must be 0 or 1.' }, 400);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 2048)) {
    return json({ error: 'Invalid review cursor.' }, 400);
  }
  const prefix = reviewPrefix(testValue === '1');
  const page = await env.ARTIFACTS.list({ prefix, limit: Number(limitValue), ...(cursor ? { cursor } : {}) });
  const keys = page.objects.map((object) => object.key);
  if (keys.some((key) => !key.startsWith(prefix))) throw new Error('Unexpected review scope.');

  // Fetch bodies in parallel; one corrupt object must not take down the whole page.
  const objects = await Promise.all(keys.map((key) => env.ARTIFACTS.get(key)));
  const texts = await Promise.all(objects.map((object) => (object ? object.text() : null)));
  const reviews = [];
  for (const body of texts) {
    if (!body) continue;
    try {
      reviews.push(JSON.parse(body));
    } catch (error) {
      console.error('[reviews] skipping malformed record:', error.message);
    }
  }
  return json({ reviews, cursor: page.truncated ? page.cursor : null });
}

export const onRequest = async ({ request, env }) => {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST' });
  }
  const url = new URL(request.url);
  if (url.searchParams.get('project') !== PROJECT || url.searchParams.get('artifact') !== ARTIFACT) {
    return json({ error: 'Unknown review project or artifact.' }, 400);
  }
  if (!env.ARTIFACTS || !env.COOKIE_SECRET || !env[pwKey(PROJECT)]) {
    return json({ error: 'Review service is not configured.' }, 503);
  }
  try {
    const version = await pwVersion(env.COOKIE_SECRET, env[pwKey(PROJECT)]);
    const token = readCookie(request.headers.get('cookie'), cookieName(PROJECT));
    if (!await verifyToken(env.COOKIE_SECRET, token, PROJECT, version)) {
      return json({ error: 'Project authentication is required.' }, 401);
    }
    return request.method === 'POST' ? await submit(request, env, url) : await list(env, url);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error('[reviews] storage failure:', error.message);
    return json({ error: 'Review storage is temporarily unavailable.' }, 503);
  }
};
