import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, ms);
}

function runWithRetry(cmd, args, { attempts, isRetryable, baseDelayMs = 1500, maxDelayMs = 15000 } = {}) {
  const maxAttempts = Math.max(1, attempts ?? 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', shell: false });
    const stdout = (result.stdout ?? '').toString();
    const stderr = (result.stderr ?? '').toString();

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    if (result.status === 0) return;

    const combined = `${stdout}\n${stderr}`;
    const retryable = typeof isRetryable === 'function' ? isRetryable(combined) : false;

    if (!retryable || attempt === maxAttempts) {
      process.exit(result.status ?? 1);
    }

    const delay = Math.min(maxDelayMs, Math.round(baseDelayMs * Math.pow(2, attempt - 1)));
    console.warn(`\n[build] ${cmd} ${args.join(' ')} failed (attempt ${attempt}/${maxAttempts}); retrying in ${delay}ms...`);
    sleepSync(delay);
  }
}

function tryCapture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', shell: false });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').toString().trim() || null;
}

function parseEnvFlag(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

// Build metadata for optional UI footer (default hidden in production).
process.env.NEXT_PUBLIC_BUILD_TIME_UTC ??= new Date().toISOString();
process.env.BUILD_TIME_UTC ??= process.env.NEXT_PUBLIC_BUILD_TIME_UTC;

if (!process.env.NEXT_PUBLIC_BUILD_SHA) {
  process.env.NEXT_PUBLIC_BUILD_SHA =
    process.env.VERCEL_GIT_COMMIT_SHA ?? tryCapture('git', ['rev-parse', 'HEAD']) ?? 'unknown';
}

const schemaArgs = ['--schema', 'prisma/schema.prisma'];

function isVercelBuild() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
}

function isProductionRuntime() {
  // - NODE_ENV=production is typical for Next/Vercel builds
  // - VERCEL_ENV=production is Vercel-specific
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

function isLocalDatabaseUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// Prisma migrate policy:
// - Default: run `prisma migrate deploy` on Vercel production builds (prevents prod schema drift incidents).
// - Opt-out: set SKIP_PRISMA_MIGRATIONS_ON_BUILD=1
// - Opt-in (any env): set RUN_PRISMA_MIGRATIONS_ON_BUILD=1
// - Local/dev convenience: auto-migrate when using a local DB.
const shouldSkipMigrate = parseEnvFlag(process.env.SKIP_PRISMA_MIGRATIONS_ON_BUILD);
const shouldForceMigrate = parseEnvFlag(process.env.RUN_PRISMA_MIGRATIONS_ON_BUILD);
const shouldAutoMigrateOnVercelProd = isVercelBuild() && process.env.VERCEL_ENV === 'production';
const shouldAutoMigrateLocal = !isVercelBuild() && process.env.DATABASE_URL && isLocalDatabaseUrl(process.env.DATABASE_URL);
const shouldMigrate = Boolean(process.env.DATABASE_URL) && !shouldSkipMigrate && (shouldForceMigrate || shouldAutoMigrateOnVercelProd || shouldAutoMigrateLocal);

if (shouldMigrate) {
  runWithRetry('prisma', ['migrate', 'deploy', ...schemaArgs], {
    attempts: 8,
    isRetryable: (output) =>
      output.includes('Error: P1002') ||
      output.includes('Timed out trying to acquire a postgres advisory lock') ||
      output.includes('pg_advisory_lock'),
    baseDelayMs: 1500,
    maxDelayMs: 15000,
  });
} else if (process.env.DATABASE_URL && isProductionRuntime() && !shouldSkipMigrate) {
  console.warn('[build] Skipping prisma migrate deploy in production (set RUN_PRISMA_MIGRATIONS_ON_BUILD=1 to enable).');
} else if (process.env.DATABASE_URL && isVercelBuild() && !shouldSkipMigrate) {
  console.warn('[build] Skipping prisma migrate deploy on Vercel build.');
}

run('prisma', ['generate', ...schemaArgs]);
run('next', ['build']);
