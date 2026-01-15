#!/usr/bin/env node

const PROD_HOST = 'ep-soft-tooth-a767udjk-pooler.ap-southeast-2.aws.neon.tech';
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

const hostname = parsedUrl.hostname;
if (!hostname) {
  fail([
    'DATABASE_URL is missing a hostname. Refusing to run.',
    'Tip: it should look like postgresql://user:***@<neon-host>/<db>?sslmode=require',
  ]);
}

const safeHint = `${hostname}${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
const looksLikeTestDb = safeHint.includes('-test') || safeHint.includes('coachkit-test');
const isProdHost = hostname === PROD_HOST;

if (isProdHost && !ALLOW_PROD_TEST_DB) {
  fail([
    `Refusing to run Playwright against production DB host: ${hostname}`,
    'Use a test/branch Neon DB for Playwright runs (recommended).',
    'If you *must* run against production (strongly discouraged), set:',
    '  ALLOW_PROD_TEST_DB=YES',
  ]);
}

if (isProdHost && ALLOW_PROD_TEST_DB) {
  console.warn(`WARNING: ALLOW_PROD_TEST_DB=YES set; running against production DB host: ${hostname}`);
}

if (!isProdHost && !looksLikeTestDb) {
  console.warn(`WARNING: DATABASE_URL host does not look like a test DB: ${hostname}`);
  console.warn('Proceeding anyway. Prefer a Neon test project/branch for Playwright.');
}

console.log(`Using DATABASE_URL host: ${hostname}`);
