import crypto from 'node:crypto';
import nextEnv from '@next/env';
import {
  ensureDatabaseExists,
  ensureDockerComposeUp,
  prismaGenerate,
  prismaReset,
  redactDatabaseUrl,
  withDatabase,
} from './test-db-helpers.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const BASE_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://programassist:programassist@localhost:5432/programassist?schema=public';

const baseRunId = String(
  process.env.TEST_RUN_ID ?? `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
);

const usingDockerDefault = !process.env.DATABASE_URL_TEST;
if (usingDockerDefault) {
  ensureDockerComposeUp();
}

const projects = String(process.env.PLAYWRIGHT_PROJECTS ?? 'iphone16pro,iPhone 14,iPad (gen 7)')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const { spawnSync } = await import('node:child_process');
let exitCode = 0;

for (const project of projects) {
  const projectSlug = project.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const runId = `${baseRunId}_${projectSlug}`;
  const dbName = `pw_${runId}`;
  const env = {
    ...process.env,
    TEST_RUN_ID: runId,
    DATABASE_URL: withDatabase(BASE_DATABASE_URL, dbName),
    PLAYWRIGHT_PRISMA_MODE: 'skip',
    AI_PLAN_BUILDER_V1: '1',
    NEXT_PUBLIC_AI_PLAN_BUILDER_V1: '1',
  };

  ensureDatabaseExists(dbName);

  console.log('[test-mobile] PROJECT=%s TEST_RUN_ID=%s', project, runId);
  console.log('[test-mobile] DATABASE_URL=%s', redactDatabaseUrl(env.DATABASE_URL));

  prismaReset(env);
  prismaGenerate(env);

  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--project', project, '--workers=1'],
    {
      stdio: 'inherit',
      shell: false,
      env,
    }
  );

  if ((result.status ?? 1) !== 0) {
    exitCode = result.status ?? 1;
    break;
  }
}

process.exit(exitCode);
