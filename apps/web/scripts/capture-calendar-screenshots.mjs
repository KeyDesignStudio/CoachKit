import { chromium } from 'playwright';
import path from 'node:path';
import process from 'node:process';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const outDir = process.env.OUT_DIR ?? path.resolve(process.cwd(), 'screenshots');

const pages = [
  { name: 'athlete-week', url: '/dev/week-preview' },
  { name: 'coach-week', url: '/dev/coach-week-preview' },
  { name: 'athlete-month', url: '/dev/month-preview' },
  { name: 'coach-month', url: '/dev/coach-month-preview' },
  { name: 'calendar-geometry-compare', url: '/dev/calendar-geometry-compare' },
];

async function main() {
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

    // Ensure tokenized UI has mounted.
    await page.waitForTimeout(250);

    await page.screenshot({ path: filePath, fullPage: true });
  }

  await context.close();
  await browser.close();

  // eslint-disable-next-line no-console
  console.log('Done.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
