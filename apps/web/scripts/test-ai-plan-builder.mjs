import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://programassist:programassist@localhost:5432/programassist?schema=public';

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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', ...schemaArgs], { env });
}

function prismaGenerate(env) {
  const schemaArgs = ['--schema', 'prisma/schema.prisma'];
  run('npx', ['prisma', 'generate', ...schemaArgs], { env });
}

function runVitest(env) {
  run('npx', ['vitest', 'run'], { env });
}

function runPlaywrightFlagOn(env) {
  run(
    'npx',
    [
      'playwright',
      'test',
      'tests/ai-plan-builder-flow.spec.ts',
      'tests/ai-plan-builder-coach-ui.spec.ts',
      '--project=iphone16pro',
    ],
    { env }
  );
}

function runPlaywrightFlagOff(env) {
  run('npx', ['playwright', 'test', 'tests/ai-plan-builder-flag-off.spec.ts', '--project=iphone16pro'], { env });
}

ensureDockerComposeUp();

const baseEnv = {
  NODE_ENV: 'development',
  DISABLE_AUTH: 'true',
  DATABASE_URL: TEST_DATABASE_URL,
};

// Reset schema for deterministic test runs.
prismaReset(baseEnv);
prismaGenerate(baseEnv);

// Run Prisma integration tests with flag ON.
runVitest({
  ...baseEnv,
  AI_PLAN_BUILDER_V1: '1',
  NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '1',
});

// Run Playwright core flow with flag ON.
runPlaywrightFlagOn({
  ...baseEnv,
  AI_PLAN_BUILDER_V1: '1',
  NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '1',
});

// Run Playwright gating checks with flag OFF.
runPlaywrightFlagOff({
  ...baseEnv,
  AI_PLAN_BUILDER_V1: '0',
  NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '0',
});
