import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

const port = process.argv[2] ? Number(process.argv[2]) : 3100;

// Ensure `.env`, `.env.local`, etc are loaded for this script.
// Playwright's webServer env inherits from the parent process and may not include values that
// Next would load automatically (e.g. DATABASE_URL in .env.local).
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

function run(cmd, args, { allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function sleep(ms) {
  // Cross-platform synchronous sleep.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const schemaArgs = ['--schema', 'prisma/schema.prisma'];
const apbMode = String(process.env.APB_MODE ?? '').trim();
const prismaMode = String(process.env.PLAYWRIGHT_PRISMA_MODE ?? (apbMode === 'fast' ? 'db-push' : 'migrate-deploy')).trim();

// Playwright tests that hit API routes require an up-to-date schema.
// We only attempt migrations when DATABASE_URL is present so UI-only tests can still run locally.
if (process.env.DATABASE_URL) {
  if (prismaMode === 'skip') {
    console.warn('[playwright-webserver] PLAYWRIGHT_PRISMA_MODE=skip; skipping prisma setup.');
  } else if (prismaMode === 'db-push') {
    // In fast mode, the harness may have already created a non-empty schema. `migrate deploy` will
    // fail with P3005 in that case; `db push` keeps the schema aligned without requiring emptiness.
    run('npx', ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate', ...schemaArgs]);
  } else {
    // Prisma migrate deploy uses a Postgres advisory lock; retry briefly to avoid
    // transient lock contention during local development.
    const maxAttempts = 6;
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = run('npx', ['prisma', 'migrate', 'deploy', ...schemaArgs], { allowFailure: true });
      if (result.status === 0) {
        ok = true;
        break;
      }

      if (attempt < maxAttempts) {
        console.warn(
          `[playwright-webserver] prisma migrate deploy failed (attempt ${attempt}/${maxAttempts}); retrying...`
        );
        sleep(5_000);
      }
    }

    if (!ok) {
      console.warn('[playwright-webserver] prisma migrate deploy failed; continuing to start Next dev server.');
    }
  }
} else {
  // Prisma CLI will fail without DATABASE_URL; keep dev server usable for non-DB tests.
  console.warn('[playwright-webserver] DATABASE_URL not set; skipping prisma migrate deploy.');
}

const nextMode = String(process.env.PLAYWRIGHT_NEXT_MODE ?? 'dev');

if (nextMode === 'start') {
  run('npx', ['next', 'start', '-p', String(port)]);
} else {
  run('npx', ['next', 'dev', '-p', String(port)]);
}
