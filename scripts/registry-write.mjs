#!/usr/bin/env node
// Write protected / ghost project name arrays to R2.
//
// Usage:
//   node scripts/registry-write.mjs --protected [--from-list path]
//   node scripts/registry-write.mjs --ghost [--from-list path]
//   node scripts/registry-write.mjs --protected --names a,b,c
//   node scripts/registry-write.mjs --both   # write both from protected.list + ghost.list

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2PutText } from './lib/r2-cli.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function readList(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const out = { protected: false, ghost: false, both: false, fromList: null, names: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--protected') out.protected = true;
    else if (a === '--ghost') out.ghost = true;
    else if (a === '--both') out.both = true;
    else if (a === '--from-list') out.fromList = argv[++i];
    else if (a === '--names') out.names = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function uniqueSorted(arr) {
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].sort();
}

function main() {
  const args = parseArgs(process.argv);
  if (args.both) {
    args.protected = true;
    args.ghost = true;
  }
  if (!args.protected && !args.ghost) {
    throw new Error('Specify --protected, --ghost, or --both');
  }

  if (args.protected) {
    let names;
    if (args.names && !args.ghost) names = args.names.split(',');
    else if (args.fromList && args.protected && !args.ghost) names = readList(args.fromList);
    else names = readList(path.join(ROOT, 'protected.list'));
    names = uniqueSorted(names);
    r2PutText('meta/protected.json', JSON.stringify(names, null, 2) + '\n');
    console.log(`registry-write: protected -> [${names.join(', ')}]`);
  }

  if (args.ghost) {
    let names;
    if (args.names && !args.protected) names = args.names.split(',');
    else if (args.fromList && args.ghost && !args.protected) names = readList(args.fromList);
    else names = readList(path.join(ROOT, 'ghost.list'));
    names = uniqueSorted(names);
    r2PutText('meta/ghost.json', JSON.stringify(names, null, 2) + '\n');
    console.log(`registry-write: ghost -> [${names.join(', ')}]`);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
