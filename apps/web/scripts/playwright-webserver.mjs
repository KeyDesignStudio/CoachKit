import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

const port = process.argv[2] ? Number(process.argv[2]) : 3100;

// Ensure `.env`, `.env.local`, etc are loaded for this script.
// Playwright's webServer env inherits from the parent process and may not include values that
// Next would load automatically (e.g. DATABASE_URL in .env.local).
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

// Ensure each Playwright run has a stable unique tag so Kaggle imports create rows
// even when the local DB isn't wiped between runs.
if (!process.env.KAGGLE_TEST_TAG) {
  const now = Date.now();
  const rand = Math.random().toString(16).slice(2, 8);
  process.env.KAGGLE_TEST_TAG = `pw_${now}_${rand}`;
}

function run(cmd, args, { allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }
}

const schemaArgs = ['--schema', 'prisma/schema.prisma'];

// Playwright tests that hit API routes require an up-to-date schema.
// We only attempt migrations when DATABASE_URL is present so UI-only tests can still run locally.
if (process.env.DATABASE_URL) {
  run('npx', ['prisma', 'migrate', 'deploy', ...schemaArgs]);
} else {
  // Prisma CLI will fail without DATABASE_URL; keep dev server usable for non-DB tests.
  console.warn('[playwright-webserver] DATABASE_URL not set; skipping prisma migrate deploy.');
}

run('npx', ['next', 'dev', '-p', String(port)]);
