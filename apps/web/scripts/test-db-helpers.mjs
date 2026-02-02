import { spawnSync } from 'node:child_process';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(cmd, args, { allowFailure = false, stdio = 'inherit', env } = {}) {
  const result = spawnSync(cmd, args, {
    shell: false,
    stdio,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`);
  }

  return result;
}

export function withDatabase(rawUrl, dbName) {
  const u = new URL(rawUrl);
  u.pathname = `/${dbName}`;
  if (!u.searchParams.get('schema')) u.searchParams.set('schema', 'public');
  return u.toString();
}

export function getDatabaseName(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

export function redactDatabaseUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return String(rawUrl || '');
  }
}

export function ensureDockerComposeUp({ repoRoot } = {}) {
  const root = repoRoot ?? new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
  const containerName = 'programassist-postgres';

  const exists = run('docker', ['inspect', containerName], { allowFailure: true, stdio: 'ignore' });
  if (exists.status === 0) {
    run('docker', ['start', containerName], { allowFailure: true });
  } else {
    run('docker', ['compose', '-f', `${root}/docker-compose.yml`, 'up', '-d', 'postgres']);
  }

  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ok = run(
      'docker',
      ['exec', containerName, 'pg_isready', '-U', 'programassist', '-d', 'programassist'],
      { allowFailure: true, stdio: 'ignore' }
    );

    if (ok.status === 0) return;
    sleep(1000);
  }

  throw new Error('[test-db-helpers] Postgres did not become ready in time.');
}

export function ensureDatabaseExists(dbName, { containerName = 'programassist-postgres' } = {}) {
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`);
  }

  const check = run(
    'docker',
    [
      'exec',
      containerName,
      'psql',
      '-U',
      'programassist',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${dbName}';`,
    ],
    { allowFailure: true, stdio: 'pipe' }
  );

  const exists = String(check.stdout ?? '').trim() === '1';
  if (exists) return;

  run('docker', ['exec', containerName, 'psql', '-U', 'programassist', '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}";`]);
}

export function prismaReset(env, schemaPath = 'prisma/schema.prisma') {
  run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--schema', schemaPath], { env });
}

export function prismaGenerate(env, schemaPath = 'prisma/schema.prisma') {
  run('npx', ['prisma', 'generate', '--schema', schemaPath], { env });
}
