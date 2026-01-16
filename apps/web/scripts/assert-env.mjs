#!/usr/bin/env node

const PROD_HOST = 'ep-soft-tooth-a767udjk-pooler.ap-southeast-2.aws.neon.tech';
const PROD_HOST_SUBSTRING = 'ep-soft-tooth-a767udjk';
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
const ALLOW_PROD_TEST_DB = process.env.ALLOW_PROD_TEST_DB === 'YES';

const databaseUrlRaw = process.env.DATABASE_URL;

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

if (!databaseUrlRaw || String(databaseUrlRaw).trim().length === 0) {
  fail([
    'Missing required env var(s): DATABASE_URL',
    'DATABASE_URL is required for Playwright mobile tests against Neon.',
    'Example (macOS/Linux):',
    "  export DATABASE_URL='postgresql://user:***@<neon-host>/<db>?sslmode=require'",
    '  cd apps/web',
    '  npm run test:mobile:neon',
  ]);
}

if (/\s/.test(databaseUrlRaw)) {
  // Common copy/paste issue: trailing newline or accidental spaces.
  const trimmed = String(databaseUrlRaw).trim();
  let hostname = '(unparseable)';
  try {
    hostname = new URL(trimmed).hostname || hostname;
  } catch {
    // Ignore.
  }

  fail([
    'DATABASE_URL contains whitespace (likely a copy/paste issue). Refusing to run.',
    `Detected host: ${hostname}`,
    'Fix: re-copy the connection string with no spaces/newlines.',
  ]);
}

let parsedUrl;
try {
  parsedUrl = new URL(String(databaseUrlRaw));
} catch {
  fail([
    'DATABASE_URL is not a valid URL. Refusing to run.',
    'Tip: it should look like postgresql://user:***@<neon-host>/<db>?sslmode=require',
  ]);
}

const hostname = String(parsedUrl.hostname || '').trim();
if (!hostname) {
  fail([
    'DATABASE_URL is missing a hostname. Refusing to run.',
    'Tip: it should look like postgresql://user:***@<neon-host>/<db>?sslmode=require',
  ]);
}

const hostnameLower = hostname.toLowerCase();
const isProdHost = hostnameLower === PROD_HOST || hostnameLower.includes(PROD_HOST_SUBSTRING);

if (LOCALHOST_HOSTS.has(hostnameLower)) {
  fail([
    'Refusing localhost for test:mobile:neon. Use npm run test:mobile:local instead.',
  ]);
}

if (isProdHost && !ALLOW_PROD_TEST_DB) {
  fail([
    `Refusing to run Playwright against production DB host: ${hostname}`,
    'Use a non-production Neon branch DATABASE_URL for Playwright runs.',
    'If you *must* run against production (strongly discouraged), set:',
    '  ALLOW_PROD_TEST_DB=YES',
  ]);
}

// If explicitly allowed, continue without printing anything other than the hostname.

// Only allow non-prod Neon branch hosts.
// Neon connection hosts are typically of the form: ep-<branch>-<id>[-pooler].<region>.aws.neon.tech
const isNeonHost = hostnameLower.endsWith('.neon.tech') && hostnameLower.startsWith('ep-');
if (!isNeonHost) {
  fail([
    `Refusing to run: DATABASE_URL host is not a Neon host: ${hostname}`,
    'Expected a non-production Neon branch host (ep-*.neon.tech).',
    'Use `npm run test:mobile` for local-only runs.',
  ]);
}

// Success output must be hostname only.
console.log(hostname);
