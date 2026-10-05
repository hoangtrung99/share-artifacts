#!/usr/bin/env node

const fs = require('node:fs');

const args = process.argv.slice(2);
const operation = args[3];
const fileArg = args.find((arg) => arg.startsWith('--file='));
const filePath = fileArg?.slice('--file='.length);

if (process.env.FAKE_WRANGLER_CALL_LOG) {
  fs.appendFileSync(process.env.FAKE_WRANGLER_CALL_LOG, `${JSON.stringify(args)}\n`);
}

if (operation === 'get') {
  switch (process.env.FAKE_WRANGLER_MODE) {
    case 'missing':
      process.stderr.write('The specified key does not exist.\n');
      process.exit(1);
    case 'unauthorized':
      process.stderr.write('Failed to fetch object - 401: Unauthorized; Authentication error\n');
      process.exit(1);
    case 'generic-error':
      process.stderr.write('Unexpected Wrangler failure\n');
      process.exit(1);
    case 'generic-404':
      process.stderr.write('404 Object Not Found\n');
      process.exit(1);
    case 'malformed':
      fs.writeFileSync(filePath, '{malformed', 'utf8');
      process.exit(0);
    case 'valid':
      fs.copyFileSync(process.env.FAKE_R2_GET_SOURCE, filePath);
      process.exit(0);
    default:
      process.stderr.write(`Unknown FAKE_WRANGLER_MODE: ${process.env.FAKE_WRANGLER_MODE}\n`);
      process.exit(2);
  }
}

if (operation === 'put') {
  if (!process.env.FAKE_R2_PUT_CAPTURE) {
    process.stderr.write('FAKE_R2_PUT_CAPTURE is required for put\n');
    process.exit(2);
  }
  fs.copyFileSync(filePath, process.env.FAKE_R2_PUT_CAPTURE);
  process.exit(0);
}

process.stderr.write(`Unsupported fake Wrangler operation: ${operation}\n`);
process.exit(2);
