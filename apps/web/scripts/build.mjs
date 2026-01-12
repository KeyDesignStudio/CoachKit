import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const schemaArgs = ['--schema', 'prisma/schema.prisma'];

// In production (e.g. Vercel), DATABASE_URL is present and migrations must be deployed
// before the app starts querying new columns.
if (process.env.DATABASE_URL) {
  run('prisma', ['migrate', 'deploy', ...schemaArgs]);
}

run('prisma', ['generate', ...schemaArgs]);
run('next', ['build']);
