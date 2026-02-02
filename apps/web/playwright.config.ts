import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// Keep Playwright's test-runner environment aligned with Next's environment loading.
// Some tests assert on `process.env.*` (e.g. feature flags) and expect `.env*` files.
loadEnvConfig(process.cwd(), true);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
const APB_MODE = String(process.env.APB_MODE ?? '').trim();
const isApbFast = APB_MODE === 'fast';

const PLAN_LIBRARY_FIXTURES_BASE = `http://localhost:${PORT}/api/__test__/fixtures/plan-library`;

export default defineConfig({
  testDir: './tests',
  // Some suites (especially under sharded parallel runs) can exceed 60s due to dev-server compilation.
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: isApbFast ? 'only-on-failure' : 'off',
    video: isApbFast ? 'retain-on-failure' : 'off',
  },
  webServer: {
    // IMPORTANT: keep this cross-platform. Do not use `FOO=bar cmd` shell prefixes.
    // The server must inherit DATABASE_URL from the parent environment (e.g. Neon).
    command: `node scripts/playwright-webserver.mjs ${PORT}`,
    env: {
      ...process.env,
      NODE_ENV: process.env.PLAYWRIGHT_NODE_ENV ?? 'development',
      DISABLE_AUTH: 'true',
      PLAN_LIBRARY_PLANS_URL: process.env.PLAN_LIBRARY_PLANS_URL ?? `${PLAN_LIBRARY_FIXTURES_BASE}/plans.csv`,
      PLAN_LIBRARY_SESSIONS_URL: process.env.PLAN_LIBRARY_SESSIONS_URL ?? `${PLAN_LIBRARY_FIXTURES_BASE}/sessions.csv`,
      PLAN_LIBRARY_SCHEDULE_URL: process.env.PLAN_LIBRARY_SCHEDULE_URL ?? `${PLAN_LIBRARY_FIXTURES_BASE}/schedule.csv`,
      STRAVA_AUTOSYNC_ENABLED: process.env.STRAVA_AUTOSYNC_ENABLED ?? '1',
      CRON_SECRET: process.env.CRON_SECRET ?? 'playwright-cron-secret',
      STRAVA_WEBHOOK_VERIFY_TOKEN: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN ?? 'playwright-webhook-token',
      STRAVA_STUB: process.env.STRAVA_STUB ?? 'true',
    },
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'iphone16pro',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iPhone 14',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'iPad (gen 7)',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
