#!/usr/bin/env node
// Thin wrapper: `pnpm revisions:bootstrap [--apply]` registers immutable revisions for artifacts
// that were published before revisioning existed. Dry-run by default (see scripts/revisions.mjs).
import { runCli } from './revisions.mjs';

runCli(['bootstrap', ...process.argv.slice(2)]).catch((error) => {
  console.error(`revisions:bootstrap: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
