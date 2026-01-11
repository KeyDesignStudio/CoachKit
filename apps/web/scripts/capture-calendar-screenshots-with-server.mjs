import { chromium } from 'playwright';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
const outDir = process.env.OUT_DIR ?? path.resolve(process.cwd(), 'screenshots');

const pages = [
  { name: 'athlete-week', url: '/dev/week-preview' },
  { name: 'coach-week', url: '/dev/coach-week-preview' },
  { name: 'athlete-month', url: '/dev/month-preview' },
  { name: 'coach-month', url: '/dev/coach-month-preview' },
  { name: 'calendar-geometry-compare', url: '/dev/calendar-geometry-compare' },
];

async function waitForServerReady() {
  const start = Date.now();
  // Probe a dev-only page that doesn't require auth.
  const probeUrl = new URL('/dev/calendar-geometry-compare', baseUrl).toString();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(probeUrl, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // ignore
    }

    if (Date.now() - start > 60_000) {
      throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
    }

    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  const dev = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '-p', String(port)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SHOW_DEV_PAGES: 'true',
      NEXT_PUBLIC_DISABLE_AUTH: 'true',
      DISABLE_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  dev.stdout.on('data', (buf) => process.stdout.write(buf.toString()));
  dev.stderr.on('data', (buf) => process.stderr.write(buf.toString()));

  try {
    await waitForServerReady();

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 2,
    });

    const page = await context.newPage();

    for (const p of pages) {
      const url = new URL(p.url, baseUrl).toString();
      const filePath = path.join(outDir, `${p.name}.png`);

      // eslint-disable-next-line no-console
      console.log(`Capturing ${p.name}: ${url} -> ${filePath}`);

      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(250);
      await page.screenshot({ path: filePath, fullPage: true });
    }

    await context.close();
    await browser.close();

    // eslint-disable-next-line no-console
    console.log('Done.');
  } finally {
    dev.kill('SIGTERM');
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
