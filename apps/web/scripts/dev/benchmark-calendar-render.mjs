/* eslint-disable no-console */
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';

const PORT = Number(process.env.CALENDAR_BENCH_PORT ?? '3123');
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ITERATIONS = Math.max(1, Number(process.env.CALENDAR_BENCH_ITERATIONS ?? '7'));

const MARKS = {
  shell: 'calendar_shell_paint',
  data: 'calendar_data_ready',
  grid: 'calendar_grid_interactive',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${BASE_URL}/api/health`);
}

async function seedFixtureData() {
  const response = await fetch(`${BASE_URL}/api/dev/strava/test-fixtures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed: 'matching' }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to seed dev fixtures (${response.status}): ${body}`);
  }
  const json = await response.json();
  return { athleteId: String(json.athleteId ?? 'dev-athlete'), coachId: String(json.coachId ?? 'dev-coach') };
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, rank));
  return sortedValues[idx];
}

function summarize(values) {
  if (!values.length) return { min: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

async function captureScenario(browser, scenario) {
  const shellToData = [];
  const shellToGrid = [];
  const dataToGrid = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    const context = await browser.newContext();
    await context.addInitScript(
      ({ viewMode, athleteId }) => {
        try {
          localStorage.setItem('coach-calendar-view:dev-coach', viewMode);
          localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify([athleteId]));
        } catch {
          // noop
        }
      },
      { viewMode: scenario.viewMode, athleteId: scenario.athleteId }
    );

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/coach/calendar`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Loading calendar…', { state: 'detached', timeout: 60_000 }).catch(() => {});
    if (scenario.viewMode === 'month') {
      await page.waitForSelector('[data-coach-month-view-version="coach-month-v2"]', { state: 'visible', timeout: 60_000 });
    } else {
      await page.waitForSelector('[data-coach-week-view-version="coach-week-v2"]', { state: 'visible', timeout: 60_000 });
      await page.waitForFunction(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="coach-calendar-athlete-row"]'));
        return rows.some((node) => {
          const el = node;
          if (!(el instanceof HTMLElement)) return false;
          return el.offsetParent !== null;
        });
      }, { timeout: 60_000 });
    }

    const marks = await page.evaluate((markNames) => {
      const getMark = (name) => {
        const entries = performance.getEntriesByName(name);
        if (!entries.length) return null;
        return entries[entries.length - 1].startTime;
      };

      const shell = getMark(markNames.shell);
      const data = getMark(markNames.data);
      const grid = getMark(markNames.grid);
      return { shell, data, grid };
    }, MARKS);

    await context.close();

    if (marks.shell == null || marks.data == null || marks.grid == null) {
      throw new Error(`Missing perf marks for ${scenario.name} iteration ${i + 1}`);
    }

    shellToData.push(Math.round(marks.data - marks.shell));
    shellToGrid.push(Math.round(marks.grid - marks.shell));
    dataToGrid.push(Math.round(marks.grid - marks.data));
  }

  return {
    name: scenario.name,
    viewMode: scenario.viewMode,
    iterations: ITERATIONS,
    metrics: {
      shellToDataMs: summarize(shellToData),
      shellToGridMs: summarize(shellToGrid),
      dataToGridMs: summarize(dataToGrid),
    },
    samples: { shellToData, shellToGrid, dataToGrid },
  };
}

async function main() {
  const devServer = spawn('npm', ['--prefix', 'apps/web', 'run', 'dev', '--', '--port', String(PORT)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DISABLE_AUTH: 'true',
      NEXT_PUBLIC_DISABLE_AUTH: 'true',
      AI_PLAN_BUILDER_V1: process.env.AI_PLAN_BUILDER_V1 ?? '1',
      NEXT_PUBLIC_AI_PLAN_BUILDER_V1: process.env.NEXT_PUBLIC_AI_PLAN_BUILDER_V1 ?? '1',
      COACHKIT_DISABLE_WEBPACK_CACHE: 'true',
    },
  });

  try {
    await waitForHealth();
    const fixture = await seedFixtureData();
    const browser = await chromium.launch({ headless: true });
    try {
      const scenarios = [
        { name: 'coach-calendar-week', viewMode: 'week', athleteId: fixture.athleteId },
        { name: 'coach-calendar-month', viewMode: 'month', athleteId: fixture.athleteId },
      ];

      const results = [];
      for (const scenario of scenarios) {
        const result = await captureScenario(browser, scenario);
        results.push(result);
      }

      console.log(JSON.stringify({ baseUrl: BASE_URL, iterations: ITERATIONS, results }, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    devServer.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
