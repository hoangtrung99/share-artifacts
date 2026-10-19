// Byte-exact snapshot identity helpers (shared by the publish CLI and unit tests).
//
// Snapshot identity is sha256 over the EXACT bytes that were captured. Comparing a decoded UTF-8
// string and re-encoding it is NOT equivalent: invalid byte sequences (e.g. 0xFF) decode to U+FFFD
// and re-encode as EF BF BD, so a string round-trip can hide a real hash mismatch. Everything here
// takes Buffer/Uint8Array and never a string.

import { sha256Hex } from '../../functions/_feedback-revisions.js';

/**
 * SHA-256 of exact snapshot bytes.
 * @param {Buffer | Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function snapshotRevisionId(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('snapshotRevisionId requires bytes (Buffer/Uint8Array), never a decoded string');
  }
  return sha256Hex(bytes);
}

/**
 * Validate an existing snapshot object's exact bytes against the expected revision id.
 * Throws on mismatch so a corrupt/foreign object is never silently accepted or overwritten.
 * @param {Buffer | Uint8Array} existingBytes
 * @param {string} revisionId
 */
export async function assertSnapshotBytes(existingBytes, revisionId) {
  const actual = await snapshotRevisionId(existingBytes);
  if (actual !== revisionId) {
    throw new Error(`snapshot bytes hash to ${actual}, expected ${revisionId}; refusing to overwrite`);
  }
  return true;
}
