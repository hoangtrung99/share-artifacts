// Thin wrappers around `wrangler r2 object` for local tooling scripts.
// Uses the logged-in wrangler identity (or CLOUDFLARE_API_TOKEN).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUCKET = 'artifacts-content';

/**
 * Run a wrangler command. Returns { ok, status, stdout, stderr }.
 * @param {string[]} args
 * @param {{ input?: string | Buffer, quiet?: boolean }} [opts]
 */
export function wrangler(args, opts = {}) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    encoding: opts.input ? undefined : 'utf8',
    input: opts.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: opts.input ? ['pipe', 'pipe', 'pipe'] : undefined,
  });
  // When input is provided, encoding may be buffer — normalize to string
  const stdout = result.stdout
    ? Buffer.isBuffer(result.stdout)
      ? result.stdout.toString('utf8')
      : result.stdout
    : '';
  const stderr = result.stderr
    ? Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr
    : '';
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout,
    stderr,
  };
}

/**
 * Put a local file into R2.
 * @param {string} key - object key (no bucket prefix)
 * @param {string} filePath - local path
 * @param {string} [contentType]
 */
export function r2PutFile(key, filePath, contentType) {
  // Always target remote R2 (wrangler 4 may default to local storage otherwise).
  const args = ['r2', 'object', 'put', `${BUCKET}/${key}`, `--file=${filePath}`, '--remote'];
  if (contentType) args.push(`--content-type=${contentType}`);
  const res = wrangler(args);
  if (!res.ok) {
    const msg = res.stderr || res.stdout || `wrangler exit ${res.status}`;
    throw new Error(`r2 put ${key} failed:\n${msg}`);
  }
  return res;
}

/**
 * Put exact bytes into R2 via a temp file. Use this for immutable snapshots so the uploaded bytes
 * are the ones that were hashed (never re-read a mutable source path after hashing).
 * @param {string} key
 * @param {Buffer | Uint8Array} bytes
 * @param {string} [contentType]
 */
export function r2PutBuffer(key, bytes, contentType) {
  const tmp = path.join(
    os.tmpdir(),
    `artifacts-r2-buf-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, bytes);
  try {
    return r2PutFile(key, tmp, contentType);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Put a string body into R2 via a temp file.
 * @param {string} key
 * @param {string} body
 * @param {string} [contentType]
 */
export function r2PutText(key, body, contentType = 'application/json; charset=utf-8') {
  const tmp = path.join(
    os.tmpdir(),
    `artifacts-r2-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    return r2PutFile(key, tmp, contentType);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Get an object as exact bytes. Returns null if missing (404).
 * Snapshots and content are hashed/verified on these bytes — never on a decoded string.
 * @param {string} key
 * @returns {Buffer | null}
 */
export function r2GetBuffer(key) {
  const tmp = path.join(
    os.tmpdir(),
    `artifacts-r2-getbuf-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  const res = wrangler(['r2', 'object', 'get', `${BUCKET}/${key}`, `--file=${tmp}`, '--remote']);
  if (!res.ok) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    const message = res.stderr || res.stdout || `wrangler exit ${res.status}`;
    const objectMissing = /the specified key does not exist|no such key|nosuchkey/i.test(message);
    if (objectMissing) return null;
    throw new Error(`r2 get ${key} failed:\n${message}`);
  }
  try {
    return fs.readFileSync(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Get an object as text. Returns null if missing (404).
 * @param {string} key
 */
export function r2GetText(key) {
  const bytes = r2GetBuffer(key);
  return bytes == null ? null : bytes.toString('utf8');
}

/**
 * Delete an object. Missing key is OK.
 * @param {string} key
 */
export function r2Delete(key) {
  const res = wrangler(['r2', 'object', 'delete', `${BUCKET}/${key}`, '--remote']);
  if (!res.ok) {
    const msg = res.stderr || res.stdout || '';
    if (/not found|does not exist|404/i.test(msg)) return;
    throw new Error(`r2 delete ${key} failed:\n${msg}`);
  }
}

/** Timestamp suitable for backup object keys (e.g. 20260824T090214Z). */
function backupStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Snapshot an object's current text under meta/backups/ before a destructive mutation.
 * Required: if the backup cannot be written, the caller must abort instead of mutating.
 * A null body means the object was confirmed missing, so there is nothing to back up.
 * @param {string} key
 * @param {string | null} body
 * @returns {boolean}
 */
export function r2BackupText(key, body) {
  if (body == null) return false;
  const base = key.split('/').pop().replace(/\.json$/i, '');
  const backupKey = `meta/backups/${base}-${backupStamp()}.json`;
  try {
    r2PutText(backupKey, body);
    return true;
  } catch (error) {
    throw new Error(`r2 backup ${key} failed (refusing to mutate without a backup): ${error.message}`);
  }
}

/** Promise wrapper around `npx wrangler` for batched operations. @param {string[]} args */
export function wranglerAsync(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ ok: false, status: 1, stdout, stderr: stderr + error.message }));
    child.on('close', (status) => resolve({ ok: status === 0, status: status ?? 1, stdout, stderr }));
  });
}

/**
 * Delete many objects with bounded concurrency. Missing keys are ignored; returns errors.
 * @param {string[]} keys object keys (without the bucket name)
 * @param {number} [concurrency]
 */
export async function r2DeleteMany(keys, concurrency = 8) {
  const queue = [...keys];
  const errors = [];
  async function worker() {
    while (queue.length) {
      const key = queue.shift();
      const res = await wranglerAsync(['r2', 'object', 'delete', `${BUCKET}/${key}`, '--remote']);
      if (!res.ok && !/not found|does not exist|404/i.test(res.stderr + res.stdout)) {
        errors.push(`${key}: ${(res.stderr || res.stdout || 'unknown error').trim()}`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, keys.length) }, () => worker()),
  );
  return errors;
}
