import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://programassist:programassist@localhost:5432/programassist?schema=public';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [k, ...rest] = raw.slice(2).split('=');
    const v = rest.join('=');
    args[k] = v === '' ? true : v;
  }
  return args;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const args = parseArgs(process.argv);
const VERBOSE = String(process.env.APB_VERBOSE ?? args.verbose ?? '').trim() === '1' || args.verbose === true;
const MODE = String(process.env.APB_MODE ?? args.mode ?? 'full').trim();
if (MODE !== 'fast' && MODE !== 'full') {
  console.error(`[test-ai-plan-builder] Invalid mode: ${MODE}. Expected fast|full.`);
  process.exit(1);
}

const PW_SHARDS = toInt(process.env.APB_PW_SHARDS ?? args.pwShards, MODE === 'fast' ? 1 : 3);
const PW_REPEAT_ON = toInt(process.env.APB_PW_REPEAT_ON ?? args.pwRepeatOn, MODE === 'fast' ? 1 : 1);
const BASE_PORT = toInt(process.env.APB_BASE_PORT ?? args.basePort, 3100);
const CLEAN_NEXT_DIST =
  String(process.env.APB_CLEAN_NEXT_DIST ?? args.cleanNextDist ?? (MODE === 'full' ? '1' : '0')).trim() === '1' ||
  args.cleanNextDist === true;

const SKIP_PW_OFF = MODE === 'fast';
const DB_STRATEGY = MODE === 'fast' ? 'single' : 'per-worker';

function printBanner() {
  console.log('[test-ai-plan-builder] MODE=%s', MODE);
  console.log('[test-ai-plan-builder] DB_STRATEGY=%s', DB_STRATEGY);
  console.log('[test-ai-plan-builder] PLAYWRIGHT flag-on: shards=%s repeats=%s', String(PW_SHARDS), String(PW_REPEAT_ON));
  console.log('[test-ai-plan-builder] PLAYWRIGHT flag-off: %s', SKIP_PW_OFF ? 'SKIPPED' : 'ENABLED');
  console.log('[test-ai-plan-builder] NEXT distDir clean: %s', CLEAN_NEXT_DIST ? 'ON' : 'OFF');
  console.log(
    '[test-ai-plan-builder] Repro: APB_VERBOSE=1 node scripts/test-ai-plan-builder.mjs --mode=%s --pwShards=%s --pwRepeatOn=%s',
    MODE,
    String(PW_SHARDS),
    String(PW_REPEAT_ON)
  );
}

function run(cmd, args, { env, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  });

  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function runQuiet(cmd, args, { env, allowFailure = false } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'ignore',
    shell: false,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  });

  if (result.status !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function redactDatabaseUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return String(rawUrl || '');
  }
}

function withDatabase(rawUrl, dbName) {
  const u = new URL(rawUrl);
  u.pathname = `/${dbName}`;
  // Each dedicated database still uses the default Prisma schema mapping.
  if (!u.searchParams.get('schema')) u.searchParams.set('schema', 'public');
  return u.toString();
}

function getDatabaseName(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

function lastLines(text, n = 50) {
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function runStep(stepName, cmd, cmdArgs, { env, allowFailure = false, input, phase } = {}) {
  const started = Date.now();
  const result = spawnSync(cmd, cmdArgs, {
    shell: false,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      ...(env ?? {}),
    },
  });

  const elapsedMs = Date.now() - started;
  if (VERBOSE) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.status !== 0 && !allowFailure) {
    const dbName = (env ?? {}).DATABASE_URL ? getDatabaseName((env ?? {}).DATABASE_URL) : null;
    if (phase) console.error(`\n[test-ai-plan-builder] PHASE=${phase} FAILED`);
    console.error(`\n[test-ai-plan-builder] FAILED step=${stepName} exit=${result.status ?? 'unknown'} elapsedMs=${elapsedMs}`);
    if (dbName) console.error(`[test-ai-plan-builder] db=${dbName}`);
    if ((env ?? {}).DATABASE_URL) {
      console.error(`[test-ai-plan-builder] DATABASE_URL=${redactDatabaseUrl((env ?? {}).DATABASE_URL)}`);
    }

    console.error(
      '[test-ai-plan-builder] Repro: APB_VERBOSE=1 node scripts/test-ai-plan-builder.mjs --mode=%s --pwShards=%s --pwRepeatOn=%s',
      MODE,
      String(PW_SHARDS),
      String(PW_REPEAT_ON)
    );

    const out = String(result.stdout ?? '');
    const err = String(result.stderr ?? '');
    if (out.trim()) {
      console.error('\n[test-ai-plan-builder] --- last stdout ---');
      console.error(lastLines(out, 50));
    }
    if (err.trim()) {
      console.error('\n[test-ai-plan-builder] --- last stderr ---');
      console.error(lastLines(err, 50));
    }

    process.exit(result.status ?? 1);
  }

  return { ...result, elapsedMs };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cleanNextDistDir(distDir) {
  const name = String(distDir ?? '').trim();
  if (!name) return;

  // Safety: never delete the default Next distDir.
  if (name === '.next') return;

  const fullPath = path.join(process.cwd(), name);
  rmSync(fullPath, { recursive: true, force: true });
}

function ensureCacheDir() {
  const cacheDir = path.join(process.cwd(), '.cache');
  mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function getSchemaHash() {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const data = readFileSync(schemaPath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getCachedSchemaHash() {
  try {
    const cacheDir = ensureCacheDir();
    const cachePath = path.join(cacheDir, 'prisma-schema.hash');
    if (!existsSync(cachePath)) return null;
    return String(readFileSync(cachePath, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

function setCachedSchemaHash(hash) {
  const cacheDir = ensureCacheDir();
  const cachePath = path.join(cacheDir, 'prisma-schema.hash');
  writeFileSync(cachePath, `${hash}\n`, 'utf8');
}

function ensureDockerComposeUp() {
  // Prefer reusing an existing container (common in local dev).
  const exists = runQuiet('docker', ['inspect', 'programassist-postgres'], { allowFailure: true });
  if (exists.status === 0) {
    run('docker', ['start', 'programassist-postgres'], { allowFailure: true });
  } else {
    // Uses repo root docker-compose.yml.
    run('docker', ['compose', '-f', `${REPO_ROOT}/docker-compose.yml`, 'up', '-d', 'postgres']);
  }

  // Wait until Postgres is ready.
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ok = run(
      'docker',
      ['exec', 'programassist-postgres', 'pg_isready', '-U', 'programassist', '-d', 'programassist'],
      { allowFailure: true }
    );

    if (ok.status === 0) return;
    sleep(1000);
  }

  console.error('[test-ai-plan-builder] Postgres did not become ready in time.');
  process.exit(1);
}

function prismaReset(env) {
  const schemaArgs = ['--schema', 'prisma/schema.prisma'];
  runStep('prisma:migrate:reset', 'npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', ...schemaArgs], {
    env,
    phase: 'prisma',
  });
}

function prismaGenerate(env) {
  const schemaArgs = ['--schema', 'prisma/schema.prisma'];
  runStep('prisma:generate', 'npx', ['prisma', 'generate', ...schemaArgs], { env, phase: 'prisma' });
}

function prismaDbPush(env) {
  const schemaArgs = ['--schema', 'prisma/schema.prisma'];
  runStep('prisma:db:push', 'npx', ['prisma', 'db', 'push', '--accept-data-loss', '--skip-generate', ...schemaArgs], {
    env,
    phase: 'prisma',
  });
}

function prismaMigrateDeploy(env) {
  const schemaArgs = ['--schema', 'prisma/schema.prisma'];
  runStep('prisma:migrate:deploy', 'npx', ['prisma', 'migrate', 'deploy', ...schemaArgs], { env, phase: 'prisma' });
}

function ensureDatabaseExists(dbName) {
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`);
  }

  // CREATE DATABASE cannot run inside a transaction; use the dockerized psql client.
  const check = spawnSync(
    'docker',
    [
      'exec',
      'programassist-postgres',
      'psql',
      '-U',
      'programassist',
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname='${dbName}';`,
    ],
    { shell: false, encoding: 'utf8' }
  );

  const exists = String(check.stdout ?? '').trim() === '1';
  if (exists) return;

  runStep(
    'db:create-database',
    'docker',
    [
      'exec',
      'programassist-postgres',
      'psql',
      '-U',
      'programassist',
      '-d',
      'postgres',
      '-c',
      `CREATE DATABASE "${dbName}";`,
    ]
  );
}

function runVitest(env) {
  runStep('vitest', 'npx', ['vitest', 'run', '--no-file-parallelism', '--maxWorkers=1'], { env, phase: 'vitest' });
}

function runPlaywrightFlagOn(env) {
  runStep(
    'playwright:flag-on',
    'npx',
    [
      'playwright',
      'test',
      'tests/ai-plan-builder-flow.spec.ts',
      'tests/ai-plan-builder-coach-ui.spec.ts',
      'tests/ai-plan-builder-athlete-publish.spec.ts',
      '--project=iphone16pro',
    ],
    { env, phase: 'playwright(flag-on)' }
  );
}

function runPlaywrightFlagOff(env) {
  runStep(
    'playwright:flag-off',
    'npx',
    [
      'playwright',
      'test',
      'tests/ai-plan-builder-flag-off.spec.ts',
      '--project=iphone16pro',
      `--output=test-results/apb-${env?.TEST_RUN_ID ?? 'pw-off'}`,
    ],
    { env, phase: 'playwright(flag-off)' }
  );
}

function spawnProcess(stepName, cmd, cmdArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      shell: false,
      env: {
        ...process.env,
        ...(env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (VERBOSE) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (VERBOSE) process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      resolve({ stepName, code: code ?? 1, stdout, stderr, env });
    });
  });
}

async function runPlaywrightSharded({ shards, repeat, envBase, specs, suiteLabel }) {
  if (shards < 1) throw new Error('shards must be >= 1');

  const processes = [];

  for (let shardIndex = 1; shardIndex <= shards; shardIndex++) {
    const runId = envBase.TEST_RUN_ID;
    const dbName = `pw_${runId}_${shardIndex}`;
    const port = BASE_PORT + shardIndex;

    ensureDatabaseExists(dbName);
    const env = {
      ...envBase,
      PLAYWRIGHT_PRISMA_MODE: 'skip',
      NEXT_DIST_DIR: `.next-apb-shard-${shardIndex}`,
      PORT: String(port),
      TEST_WORKER_INDEX: String(shardIndex),
      DATABASE_URL: withDatabase(envBase.DATABASE_URL, dbName),
    };

    if (CLEAN_NEXT_DIST) cleanNextDistDir(env.NEXT_DIST_DIR);

    prismaMigrateDeploy(env);

    processes.push(
      spawnProcess(
        `${suiteLabel} shard ${shardIndex}/${shards} (repeat ${repeat})`,
        'npx',
        [
          'playwright',
          'test',
          ...specs,
          '--project=iphone16pro',
          `--output=test-results/apb-${runId}-${shardIndex}`,
          '--workers=1',
          `--shard=${shardIndex}/${shards}`,
        ],
        env
      )
    );
  }

  const results = await Promise.all(processes);
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length) {
    console.error(`\n[test-ai-plan-builder] PHASE=playwright(${suiteLabel}) failed (${failed.length}/${results.length} shards).`);
    console.error(
      '[test-ai-plan-builder] Repro: APB_VERBOSE=1 node scripts/test-ai-plan-builder.mjs --mode=%s --pwShards=%s --pwRepeatOn=%s',
      MODE,
      String(PW_SHARDS),
      String(PW_REPEAT_ON)
    );
    for (const f of failed) {
      const dbName = f.env?.DATABASE_URL ? getDatabaseName(f.env.DATABASE_URL) : null;
      console.error(`\n[test-ai-plan-builder] FAILED ${f.stepName} exit=${f.code}`);
      if (dbName) console.error(`[test-ai-plan-builder] db=${dbName}`);
      if (f.env?.DATABASE_URL) console.error(`[test-ai-plan-builder] DATABASE_URL=${redactDatabaseUrl(f.env.DATABASE_URL)}`);
      if (String(f.stdout || '').trim()) {
        console.error('\n[test-ai-plan-builder] --- last stdout ---');
        console.error(lastLines(f.stdout, 50));
      }
      if (String(f.stderr || '').trim()) {
        console.error('\n[test-ai-plan-builder] --- last stderr ---');
        console.error(lastLines(f.stderr, 50));
      }
    }
    process.exit(failed[0]?.code ?? 1);
  }
}

ensureDockerComposeUp();

printBanner();

const baseEnv = {
  NODE_ENV: 'development',
  DISABLE_AUTH: 'true',
  DATABASE_URL: TEST_DATABASE_URL,
};

const startedAll = Date.now();
const runIdBase = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

const schemaHash = getSchemaHash();
const cachedHash = getCachedSchemaHash();
const schemaCacheHit = cachedHash === schemaHash;
console.log('[test-ai-plan-builder] prisma schema hash: %s (%s)', schemaHash.slice(0, 12), schemaCacheHit ? 'cache-hit' : 'cache-miss');

// Generate Prisma client once (cached by schema hash).
if (!schemaCacheHit) {
  prismaGenerate(baseEnv);
  setCachedSchemaHash(schemaHash);
} else {
  console.log('[test-ai-plan-builder] prisma:generate skipped (schema unchanged).');
}

// Run Prisma integration tests with flag ON.
// Fast mode reuses a single per-run DB across vitest + playwright.
const fastDbName = MODE === 'fast' ? `apb_${runIdBase}` : null;
{
  const dbName = MODE === 'fast' ? fastDbName : `vitest_${runIdBase}`;
  ensureDatabaseExists(dbName);
  const env = {
    ...baseEnv,
    APB_MODE: MODE,
    TEST_RUN_ID: runIdBase,
    TEST_RUN_GROUP: runIdBase,
    TEST_WORKER_INDEX: '0',
    DATABASE_URL: withDatabase(baseEnv.DATABASE_URL, dbName),
    AI_PLAN_BUILDER_V1: '1',
    NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '1',
  };

  // In fast mode, prefer db push when schema is unchanged (faster than migrations).
  if (MODE === 'fast' && schemaCacheHit) {
    prismaDbPush(env);
  } else {
    prismaMigrateDeploy(env);
  }

  runVitest(env);
}

// Run Playwright core flow with flag ON, sharded across isolated databases + ports.
for (let repeat = 1; repeat <= PW_REPEAT_ON; repeat++) {
  const runId = PW_REPEAT_ON === 1 ? runIdBase : `${runIdBase}r${repeat}`;
  const env = {
    ...baseEnv,
    APB_MODE: MODE,
    TEST_RUN_ID: runId,
    TEST_RUN_GROUP: runIdBase,
    AI_PLAN_BUILDER_V1: '1',
    NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '1',
  };

  // eslint-disable-next-line no-await-in-loop
  // eslint-disable-next-line no-await-in-loop
  if (MODE === 'fast') {
    const port = BASE_PORT + 1;
    const fastDb = fastDbName;
    if (!fastDb) {
      throw new Error('fastDbName must be set in fast mode');
    }
    const envFast = {
      ...env,
      PLAYWRIGHT_PRISMA_MODE: 'skip',
      NEXT_DIST_DIR: `.next-apb-fast`,
      PORT: String(port),
      TEST_WORKER_INDEX: '1',
      DATABASE_URL: withDatabase(baseEnv.DATABASE_URL, fastDb),
    };
    if (CLEAN_NEXT_DIST) cleanNextDistDir(envFast.NEXT_DIST_DIR);
    // DB already set up for vitest; keep it as-is.
    runStep(
      'playwright:flag-on:fast',
      'npx',
      [
        'playwright',
        'test',
        'tests/ai-plan-builder-flow.spec.ts',
        'tests/ai-plan-builder-coach-ui.spec.ts',
        'tests/ai-plan-builder-athlete-publish.spec.ts',
        '--project=iphone16pro',
        '--workers=1',
        `--output=test-results/apb-${runId}-fast`,
      ],
      { env: envFast, phase: 'playwright(flag-on)' }
    );
  } else {
    await runPlaywrightSharded({
      shards: Math.max(1, PW_SHARDS),
      repeat,
      envBase: env,
      suiteLabel: 'flag-on',
      specs: [
        'tests/ai-plan-builder-flow.spec.ts',
        'tests/ai-plan-builder-coach-ui.spec.ts',
        'tests/ai-plan-builder-athlete-publish.spec.ts',
      ],
    });
  }
}

// Run Playwright gating checks with flag OFF (single shard for speed) unless fast mode.
if (!SKIP_PW_OFF) {
  const runId = `${runIdBase}_off`;
  const dbName = `pw_${runId}_1`;
  ensureDatabaseExists(dbName);
  const env = {
    ...baseEnv,
    APB_MODE: MODE,
    PLAYWRIGHT_PRISMA_MODE: 'skip',
    NEXT_DIST_DIR: `.next-apb-shard-off`,
    TEST_RUN_ID: runId,
    TEST_RUN_GROUP: runIdBase,
    TEST_WORKER_INDEX: '1',
    PORT: String(BASE_PORT + 1),
    DATABASE_URL: withDatabase(baseEnv.DATABASE_URL, dbName),
    AI_PLAN_BUILDER_V1: '0',
    NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '0',
  };

  if (CLEAN_NEXT_DIST) cleanNextDistDir(env.NEXT_DIST_DIR);
  prismaMigrateDeploy(env);
  runPlaywrightFlagOff(env);
}

const elapsedAll = ((Date.now() - startedAll) / 1000).toFixed(2);
console.log(`\n[test-ai-plan-builder] Done in ${elapsedAll}s (pwShards=${PW_SHARDS}, pwRepeatOn=${PW_REPEAT_ON}).`);
