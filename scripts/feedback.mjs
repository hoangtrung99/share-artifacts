#!/usr/bin/env node
// Review-feedback CLI: reads are read-only by default; the single mutating command is the owner
// workflow `addressed` (requires FEEDBACK_ADMIN_TOKEN).
//
//   pnpm feedback -- list      --artifact <artifactId> [--status open,addressed] [--format json|md|table]
//   pnpm feedback -- export    --artifact <artifactId> [--format json|md] [-o <path>] [--status ...]
//   pnpm feedback -- revisions --project <p> --file <f> [--format json|table]
//   pnpm feedback -- addressed --thread <threadId> --revision <revisionId> [--expected-version N]
//
// Owner workflow: publish the fix (deliver.sh) → `addressed --thread … --revision <new rev>` →
// the reviewer verifies and resolves from the UI. `addressed` records the fixing revision; resolve
// only ever uses that recorded revision.
//
// Auth: one of
//   - FEEDBACK_ADMIN_TOKEN  (site owner; reads everything)
//   - ARTIFACTS_COOKIE      (browser cookie header value, e.g. `cf_auth_<project>=…` for a
//                            protected/ghost project, or `cf_review_<id>=gr_…` after redeeming a
//                            review link through GET /r/<token>)
// Public artifacts do not expose their discussion publicly, so anonymous reads need one of the
// above. Reads never mutate anything; the CLI never prints tokens/cookies.
//
// Env: ARTIFACTS_SITE_URL (default https://artifacts.hoangtrung.dev)

const BASE_URL = (process.env.ARTIFACTS_SITE_URL || 'https://artifacts.hoangtrung.dev').replace(/\/+$/, '');

function parseArgs(argv) {
  const out = { _: [], format: 'json' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // npm/pnpm may forward the `--` separator literally
    if (!arg.startsWith('--') && arg !== '-o') {
      out._.push(arg);
      continue;
    }
    const name = arg === '-o' ? 'output' : arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (name === 'help') {
      out.help = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    out[name] = value;
  }
  return out;
}

function requireFlag(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  return args[name];
}

function headers() {
  const result = { accept: 'application/json, text/markdown' };
  if (process.env.ARTIFACTS_COOKIE) result.cookie = process.env.ARTIFACTS_COOKIE;
  if (process.env.FEEDBACK_ADMIN_TOKEN) result['x-feedback-admin'] = process.env.FEEDBACK_ADMIN_TOKEN;
  return result;
}

async function request(path, { method = 'GET', body } = {}) {
  const requestHeaders = headers();
  if (method !== 'GET' || body !== undefined) requestHeaders.origin = BASE_URL;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(BASE_URL + path, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return { text, contentType: response.headers.get('content-type') || '' };
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

function author(line) {
  const who = line.author || {};
  return `${who.name || 'Anonymous'}${who.unverified ? ' (unverified)' : ` (${who.kind || 'unknown'})`}`;
}

function renderTable(list) {
  const lines = [];
  for (const thread of list.threads || []) {
    const quote = String(thread.anchor?.exact || '').replace(/\s+/g, ' ').slice(0, 60);
    lines.push(
      `${thread.threadId}  ${thread.status.padEnd(9)}  v${thread.revisionNumber ?? '?'}  ${thread.kind.padEnd(7)}  ${author(thread)}  “${quote}${quote.length === 60 ? '…' : ''}”`,
    );
    const messages = thread.messages || [];
    for (const message of messages) {
      lines.push(`    ${message.seq}. ${message.body.replace(/\s+/g, ' ')}`);
    }
  }
  if (!lines.length) lines.push('no threads');
  const { counts, txid } = list;
  if (counts) lines.push(`\ncounts: open=${counts.open} addressed=${counts.addressed} resolved=${counts.resolved}  txid=${txid}`);
  return lines.join('\n');
}

function renderMarkdown(list) {
  const lines = [`# Review feedback — ${list.artifact?.project}/${list.artifact?.file}`, ''];
  for (const thread of list.threads || []) {
    lines.push(`## ${thread.status.toUpperCase()} (${thread.threadId})`);
    if (thread.anchor?.exact) lines.push('', `> ${thread.anchor.exact.replace(/\n/g, '\n> ')}`);
    for (const message of thread.messages || []) {
      lines.push('', `**${author(message)}** — ${message.createdAt}`, '', message.body);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help' || args.help) {
    console.log(
      [
        'usage:',
        '  pnpm feedback -- list    --artifact <artifactId> [--status open,addressed] [--format json|md|table]',
        '  pnpm feedback -- export  --artifact <artifactId> [--format json|md] [-o <path>] [--status ...]',
        '  pnpm feedback -- revisions --project <p> --file <f> [--format json|table]',
        '  pnpm feedback -- addressed --thread <threadId> --revision <revisionId> [--expected-version N]',
        '',
        'Auth (read-only): FEEDBACK_ADMIN_TOKEN or ARTIFACTS_COOKIE; site via ARTIFACTS_SITE_URL.',
      ].join('\n'),
    );
    return;
  }

  if (command === 'list') {
    const artifact = requireFlag(args, 'artifact');
    const { text } = await request(`/api/feedback${query({ artifact, status: args.status })}`);
    const payload = JSON.parse(text);
    if (args.format === 'table') console.log(renderTable(payload));
    else if (args.format === 'md') console.log(renderMarkdown(payload));
    else console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'export') {
    const artifact = requireFlag(args, 'artifact');
    const format = args.format === 'md' ? 'md' : 'json';
    const { text } = await request(`/api/feedback/export${query({ artifact, format, status: args.status })}`);
    if (args.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(args.output, text);
      console.error(`feedback: wrote ${args.output}`);
    } else {
      console.log(text);
    }
    return;
  }

  if (command === 'revisions') {
    const project = requireFlag(args, 'project');
    const file = requireFlag(args, 'file');
    const { text } = await request(`/api/revisions${query({ project, file })}`);
    const payload = JSON.parse(text);
    if (args.format === 'table') {
      const lines = (payload.revisions || []).map(
        (revision) =>
          `v${revision.number}  ${revision.revisionId}  ${revision.size} bytes  ${revision.createdAt}${revision.isLatest ? '  (latest)' : ''}`,
      );
      console.log(lines.length ? lines.join('\n') : 'no revisions registered');
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  if (command === 'addressed') {
    if (!process.env.FEEDBACK_ADMIN_TOKEN) {
      throw new Error('addressed requires FEEDBACK_ADMIN_TOKEN (site owner workflow)');
    }
    const threadId = requireFlag(args, 'thread');
    const revision = requireFlag(args, 'revision');
    // Current version comes from the thread itself unless the caller pins it explicitly.
    const current = JSON.parse((await request(`/api/feedback/${encodeURIComponent(threadId)}`)).text);
    const expectedVersion = args.expectedVersion ? Number(args.expectedVersion) : current.thread.version;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('invalid expected version');
    const updated = JSON.parse(
      (await request(`/api/feedback/${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        body: { status: 'addressed', expectedVersion, addressedRevisionId: revision },
      })).text,
    );
    console.log(
      `addressed ${threadId} at revision ${updated.thread.addressedRevisionId} (v${expectedVersion} → v${updated.thread.version}); reviewer can now resolve`,
    );
    return;
  }

  throw new Error(`unknown command: ${command} (expected list|export|revisions|addressed)`);
}

main().catch((error) => {
  console.error(`feedback: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  process.exit(1);
});
