import { test, expect, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { seedDevCoachAndAthlete } from '../modules/ai-plan-builder/tests/seed';

test.use({ ...devices['iPhone 13'] });

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE') {
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

function screenshotPath(fileName: string) {
  return path.join(process.cwd(), 'screenshots', 'iphone13-full-pass', fileName);
}

async function assertNoRuntimeErrors(page: any) {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (err: any) => runtimeErrors.push(`pageerror: ${String(err?.message || err)}`));
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`);
  });
  await page.waitForTimeout(250);
  expect(runtimeErrors, `Runtime errors detected:\n${runtimeErrors.join('\n')}`).toEqual([]);
}

test.describe('iPhone13 full pass', () => {
  test.beforeAll(async () => {
    await seedDevCoachAndAthlete();
    await mkdir(path.join(process.cwd(), 'screenshots', 'iphone13-full-pass'), { recursive: true });
  });

  test('coach dashboard', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Coach Console' })).toBeVisible();
    await page.screenshot({ path: screenshotPath('coach-dashboard.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('coach calendar', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Weekly Calendar/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath('coach-calendar.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('coach athletes', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/athletes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Athlete Profiles/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath('coach-athletes.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('coach notifications', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Mailbox' })).toBeVisible();
    await page.screenshot({ path: screenshotPath('coach-notifications.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('coach APB', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/athletes/dev-athlete/ai-plan-builder', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Build This Athlete's Next Training Block/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath('coach-apb.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('athlete dashboard', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Athlete Console' })).toBeVisible();
    await page.screenshot({ path: screenshotPath('athlete-dashboard.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('athlete calendar', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Weekly Calendar/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath('athlete-calendar.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('athlete notifications', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Mailbox' })).toBeVisible();
    await page.screenshot({ path: screenshotPath('athlete-notifications.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });

  test('athlete training request', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/training-request', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Training Request/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath('athlete-training-request.png'), fullPage: true });
    await assertNoRuntimeErrors(page);
  });
});

