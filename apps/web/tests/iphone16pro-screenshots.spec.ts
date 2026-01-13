import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

function screenshotPath(testInfo: any, fileName: string) {
  // Write into repo folder so it's easy to share before committing.
  // CWD for tests is apps/web.
  return path.join(process.cwd(), 'screenshots', 'iphone16pro', fileName);
}

test.describe('iPhone 16 Pro screenshots (390px)', () => {
  test('captures coach calendar week, month, and menu drawer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone16pro', 'Only run on iphone16pro project');

    await mkdir(path.join(process.cwd(), 'screenshots', 'iphone16pro'), { recursive: true });

    await setRoleCookie(page, 'COACH');

    // Week view
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-mobile-header="v1"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Weekly Calendar/i })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'coach-calendar-week.png'), fullPage: true });

    // Open menu drawer
    await page.getByRole('button', { name: /open menu/i }).click();
    await expect(page.locator('[data-mobile-nav-drawer="v1"]')).toBeVisible();
    // Ensure key coach links are visible and tappable
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage Athletes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workout Scheduling' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Group Sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'mobile-menu-drawer.png'), fullPage: true });
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Close menu' }).click();

    // Month view
    await page.getByRole('button', { name: 'Month' }).click();
    await expect(page.getByRole('heading', { name: /Monthly Calendar/i })).toBeVisible();
    // Confirm month scan-only UI is in effect (detailed rows hidden on mobile)
    await expect(page.locator('[data-mobile-month-scan-only="true"]').first()).toBeVisible();
    await page.screenshot({ path: screenshotPath(testInfo, 'coach-calendar-month.png'), fullPage: true });

    // Tap a day to open bottom sheet and confirm it can open workout detail
    const firstDayCell = page.locator('[data-athlete-month-day-cell="v2"]').first();
    await firstDayCell.click();
    await expect(page.getByRole('dialog', { name: 'Day workouts' })).toBeVisible();

    const dayDialog = page.getByRole('dialog', { name: 'Day workouts' });
    const firstWorkout = dayDialog.locator('[data-day-workout-item="true"]').first();
    if (await firstWorkout.count()) {
      await firstWorkout.click();
      // Workout detail drawer should open.
      await expect(page.getByText('Edit Workout')).toBeVisible();
      // Planned vs actual time should be readable if actual exists.
      // (This assertion is conditional on seeded data.)
    }
  });
});
