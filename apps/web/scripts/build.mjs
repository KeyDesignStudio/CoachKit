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

// Build metadata for optional UI footer (default hidden in production).
process.env.NEXT_PUBLIC_BUILD_TIME_UTC ??= new Date().toISOString();
process.env.BUILD_TIME_UTC ??= process.env.NEXT_PUBLIC_BUILD_TIME_UTC;

if (!process.env.NEXT_PUBLIC_BUILD_SHA) {
  process.env.NEXT_PUBLIC_BUILD_SHA =
    process.env.VERCEL_GIT_COMMIT_SHA ?? tryCapture('git', ['rev-parse', 'HEAD']) ?? 'unknown';
}

const schemaArgs = ['--schema', 'prisma/schema.prisma'];

// In production (e.g. Vercel), DATABASE_URL is present and migrations must be deployed
// before the app starts querying new columns.
if (process.env.DATABASE_URL) {
  runWithRetry(
    'prisma',
    ['migrate', 'deploy', ...schemaArgs],
    {
      attempts: 8,
      isRetryable: (output) =>
        output.includes('Error: P1002') ||
        output.includes('Timed out trying to acquire a postgres advisory lock') ||
        output.includes('pg_advisory_lock'),
      baseDelayMs: 1500,
      maxDelayMs: 15000,
    }
  );
}

run('prisma', ['generate', ...schemaArgs]);
run('next', ['build']);
