import { spawn } from 'node:child_process';
import process from 'node:process';

const repoRoot = process.cwd();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickPort() {
  // Keep deterministic for CI-ish usage; override with SMOKE_PORT if needed.
  const fromEnv = Number(process.env.SMOKE_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 3020;
}

async function waitForHttpOk(url, { timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createLogBuffer(maxChars = 200_000) {
  let buf = '';
  return {
    append(chunk) {
      buf += chunk;
      if (buf.length > maxChars) buf = buf.slice(buf.length - maxChars);
    },
    tail(n = 6000) {
      return buf.length <= n ? buf : buf.slice(buf.length - n);
    },
  };
}

async function run() {
  const port = pickPort();
  const baseURL = `http://localhost:${port}`;

  const serverLog = createLogBuffer();

  const server = spawn(
    'npm',
    ['--prefix', 'apps/web', 'run', 'dev', '--', '-p', String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_SHOW_DEV_PAGES: 'true',
        NEXT_PUBLIC_DISABLE_AUTH: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const cleanup = async () => {
    if (server.exitCode != null) return;
    server.kill('SIGTERM');
    await sleep(2500);
    if (server.exitCode == null) server.kill('SIGKILL');
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  server.stdout?.on('data', (d) => serverLog.append(String(d)));
  server.stderr?.on('data', (d) => serverLog.append(String(d)));

  server.on('exit', (code) => {
    if (code && code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`Dev server exited (code=${code})`);
    }
  });

  try {
    await waitForHttpOk(`${baseURL}/dev/month-preview`, { timeoutMs: 60_000 });
    await waitForHttpOk(`${baseURL}/dev/coach-month-preview`, { timeoutMs: 60_000 });
    await waitForHttpOk(`${baseURL}/dev/week-preview`, { timeoutMs: 60_000 });
    await waitForHttpOk(`${baseURL}/dev/coach-week-preview`, { timeoutMs: 60_000 });

    let chromium;
    try {
      const playwright = await import('playwright');
      chromium = playwright.chromium;
    } catch (err) {
      throw new Error(
        `Playwright not available. Install with: (cd apps/web && npm i) and (cd apps/web && npx playwright install chromium). Original error: ${err}`
      );
    }

    const browser = await chromium.launch();
    const page = await browser.newPage();

    const dayKey = '2026-01-03';

    async function assertDayOnPage(path) {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
      const sel = `button[aria-label="Open day ${dayKey}"]`;
      await page.waitForSelector(sel, { timeout: 20_000 });
      const text = (await page.textContent(sel))?.trim();
      if (text !== '3') {
        throw new Error(`Expected day button text to be '3', got ${JSON.stringify(text)} on ${path}`);
      }
      await page.click(sel);
      await page.waitForFunction(
        (key) => document.querySelector('[data-testid="selection"]')?.textContent?.includes(String(key)),
        dayKey,
        { timeout: 5000 }
      );
      const selection = (await page.textContent('[data-testid="selection"]'))?.trim();
      if (!selection?.includes(dayKey)) {
        throw new Error(`Expected selection to include ${dayKey}, got ${JSON.stringify(selection)} on ${path}`);
      }
    }

    await assertDayOnPage('/dev/month-preview');
    await assertDayOnPage('/dev/coach-month-preview');

    await page.goto(`${baseURL}/dev/week-preview`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${baseURL}/dev/coach-week-preview`, { waitUntil: 'domcontentloaded' });

    await browser.close();

    // eslint-disable-next-line no-console
    console.log('SMOKE_OK');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('SMOKE_FAIL');
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.error('--- dev server log (tail) ---');
    // eslint-disable-next-line no-console
    console.error(serverLog.tail());
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await run();
