#!/usr/bin/env node
// Create/list/revoke review grants (comment scope, TTL, revocable) for one artifact.
//
//   FEEDBACK_ADMIN_TOKEN=... node scripts/review-grant.mjs create --project demo --file sample.html \
//       [--ttl 7d] [--base-url https://artifacts.hoangtrung.dev]
//   ARTIFACTS_COOKIE='cf_auth_demo=…' node scripts/review-grant.mjs create --project demo --file s.html
//   node scripts/review-grant.mjs list --artifact <artifactId>
//   node scripts/review-grant.mjs revoke --grant <grantId>
//
// Public artifacts: the site-owner token (FEEDBACK_ADMIN_TOKEN, a Pages secret) is required.
// Protected projects: the project cookie works instead. Secrets/tokens come from the environment
// and are never printed or written to disk.
//
// The printed review URL (https://…/r/<token>) contains the grant token: share it only with
// reviewers. Opening it redeems the grant into an HttpOnly, SameSite=Strict cookie scoped to the
// artifact and redirects to the artifact (the token never appears in the artifact URL or JS). The
// token is stored server-side as a sha256 hash and can be revoked; grant TTL is 60s–180d.

const TTL_UNITS = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // npm/pnpm may forward the `--` separator literally
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const name = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
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

function parseTtl(value, fallbackSeconds = 7 * 24 * 60 * 60) {
  if (!value) return fallbackSeconds;
  const match = String(value).trim().match(/^(\d+)([smhd])?$/);
  if (!match) throw new Error('--ttl must look like 3600, 24h, 7d or 30d');
  const unit = match[2] ? TTL_UNITS[match[2]] : 1;
  const seconds = Number(match[1]) * unit;
  if (seconds < 60 || seconds > 180 * 24 * 60 * 60) throw new Error('--ttl must be between 60s and 180d');
  return seconds;
}

async function request(baseUrl, path, { method = 'GET', body, headers: extra = {} } = {}) {
  const headers = { accept: 'application/json', ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (process.env.FEEDBACK_ADMIN_TOKEN) headers['x-feedback-admin'] = process.env.FEEDBACK_ADMIN_TOKEN;
  if (process.env.ARTIFACTS_COOKIE) headers.cookie = process.env.ARTIFACTS_COOKIE;
  const response = await fetch(baseUrl.replace(/\/+$/, '') + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.code;
    throw error;
  }
  return payload;
}

function requireFlag(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  return args[name];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const baseUrl = args.baseUrl || process.env.ARTIFACTS_SITE_URL || 'https://artifacts.hoangtrung.dev';
  if (!command || command === 'help' || args.help) {
    console.log('usage: review-grant create|list|revoke …  (see header of scripts/review-grant.mjs)');
    return;
  }
  if (command === 'create') {
    const project = requireFlag(args, 'project');
    const file = requireFlag(args, 'file');
    const ttlSeconds = parseTtl(args.ttl);
    const created = await request(baseUrl, '/api/feedback/grants', {
      method: 'POST',
      headers: { origin: baseUrl.replace(/\/+$/, '') },
      body: { project, file, scope: 'comment', ttlSeconds },
    });
    console.log(`grant ${created.grantId} for ${project}/${file} — expires ${created.expiresAt}`);
    console.log(`review URL: ${created.reviewUrl}`);
    return;
  }
  if (command === 'list') {
    const artifact = requireFlag(args, 'artifact');
    const listed = await request(baseUrl, `/api/feedback/grants?artifact=${encodeURIComponent(artifact)}`);
    if (!listed.grants?.length) {
      console.log('no grants');
      return;
    }
    for (const grant of listed.grants) {
      console.log(
        `${grant.grantId} ${grant.scope} ${grant.expiresAt}${grant.revokedAt ? ` revoked ${grant.revokedAt}` : ''}`,
      );
    }
    return;
  }
  if (command === 'revoke') {
    const grantId = requireFlag(args, 'grant');
    const revoked = await request(baseUrl, `/api/feedback/grants/${encodeURIComponent(grantId)}`, {
      method: 'DELETE',
      headers: { origin: baseUrl.replace(/\/+$/, '') },
    });
    console.log(revoked.granted ? `revoked ${grantId}` : `${grantId} was already revoked or missing`);
    return;
  }
  throw new Error(`unknown command: ${command} (expected create|list|revoke)`);
}

main().catch((error) => {
  console.error(`review-grant: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  process.exit(1);
});
