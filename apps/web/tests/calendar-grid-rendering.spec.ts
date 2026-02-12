import { expect, test } from '@playwright/test';

import { getLocalDayKey } from '@/lib/day-key';

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

async function getHeaderDateLines(page: any, testId: string) {
  const headers = page.locator(`[data-testid="${testId}"]:visible`);
  const count = await headers.count();
  const results: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const lines = (await headers.nth(i).locator('p').allTextContents()).map((text) => text.trim());
    results.push(lines[1] ?? '');
  }

  return results;
}

test.describe('Calendar grid rendering', () => {
  test('Athlete week + month grids render', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });

    const weekView = page.locator('[data-athlete-week-view-version="athlete-week-v2"]').first();
    await expect(weekView).toBeVisible();
    await expect(page.locator('[data-testid="athlete-calendar-date-header"]:visible')).toHaveCount(7);

    await page.getByRole('button', { name: /^Month$/ }).click();
    const monthView = page.locator('[data-athlete-month-view-version="athlete-month-v2"]').first();
    await expect(monthView).toBeVisible();
    await expect(page.getByTestId('calendar-month-grid')).toBeVisible();
  });

  test('Coach week + month grids render', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.addInitScript(() => {
      localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify(['dev-athlete']));
    });
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });

    const weekView = page.locator('[data-coach-week-view-version="coach-week-v2"]').first();
    await expect(weekView).toBeVisible();
    await expect(page.locator('[data-testid="coach-calendar-date-header"]:visible')).toHaveCount(7);

    await page.getByRole('button', { name: /^Month$/ }).click();
    const monthView = page.locator('[data-coach-month-view-version="coach-month-v2"]').first();
    await expect(monthView).toBeVisible();
    await expect(page.getByTestId('calendar-month-grid')).toBeVisible();
  });

  test('Coach month view highlights today', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iPad (gen 7)', 'Today badge is desktop-month only (md+).');

    await setRoleCookie(page, 'COACH');
    await page.addInitScript(() => {
      localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify(['dev-athlete']));
      localStorage.setItem('coach-calendar-view:dev-coach', 'month');
    });
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });

    const monthView = page.locator('[data-coach-month-view-version="coach-month-v2"]').first();
    await expect(monthView).toBeVisible();

    const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const todayKey = getLocalDayKey(new Date(), timeZone);
    const todayCell = page.getByLabel(`Open day ${todayKey}`);
    await expect(todayCell).toBeVisible();
    await expect(todayCell.locator('text=Today')).toBeVisible();
  });

  test('Coach and athlete week headers align', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.addInitScript(() => {
      localStorage.setItem('coach-calendar-selected-athletes', JSON.stringify(['dev-athlete']));
    });
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-coach-week-view-version="coach-week-v2"]').first()).toBeVisible();

    const coachHeaders = await getHeaderDateLines(page, 'coach-calendar-date-header');
    expect(coachHeaders.filter(Boolean).length, 'Coach headers should have date lines').toBe(7);

    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-athlete-week-view-version="athlete-week-v2"]').first()).toBeVisible();

    const athleteHeaders = await getHeaderDateLines(page, 'athlete-calendar-date-header');
    expect(athleteHeaders.filter(Boolean).length, 'Athlete headers should have date lines').toBe(7);

    expect(athleteHeaders, 'Week header dates should match between coach and athlete grids').toEqual(coachHeaders);
  });
});
