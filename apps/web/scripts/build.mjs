import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
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
  run('prisma', ['migrate', 'deploy', ...schemaArgs]);
}

run('prisma', ['generate', ...schemaArgs]);
run('next', ['build']);
