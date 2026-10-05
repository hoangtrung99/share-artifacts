// Thin wrappers around `wrangler r2 object` for local tooling scripts.
// Uses the logged-in wrangler identity (or CLOUDFLARE_API_TOKEN).

import { spawnSync } from 'node:child_process';
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
 * Get an object as text. Returns null if missing (404).
 * @param {string} key
 */
export function r2GetText(key) {
  const tmp = path.join(
    os.tmpdir(),
    `artifacts-r2-get-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  const res = wrangler(['r2', 'object', 'get', `${BUCKET}/${key}`, `--file=${tmp}`, '--remote']);
  if (!res.ok) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }

    const message = res.stderr || res.stdout || `wrangler exit ${res.status}`;
    const objectMissing =
      /the specified key does not exist|no such key|nosuchkey/i.test(message);
    if (objectMissing) return null;

    throw new Error(`r2 get ${key} failed:\n${message}`);
  }
  try {
    const text = fs.readFileSync(tmp, 'utf8');
    return text;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
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
