import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    // IMPORTANT: keep this cross-platform. Do not use `FOO=bar cmd` shell prefixes.
    // The server must inherit DATABASE_URL from the parent environment (e.g. Neon).
    command: `node scripts/playwright-webserver.mjs ${PORT}`,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DISABLE_AUTH: 'true',
      // Avoid external network dependency in tests.
      FREE_EXERCISE_DB_DATA_PATH: 'tests/fixtures/free-exercise-db-sample.json',
      KAGGLE_DATA_PATH: 'tests/fixtures/kaggle-sample.json',
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
