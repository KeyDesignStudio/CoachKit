import { test, expect } from '@playwright/test';

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

async function openAthleteSelector(page: any) {
  await page.locator('[data-athlete-selector="button"]').click();
  const dropdown = page.locator('[data-athlete-selector="dropdown"]');
  await expect(dropdown).toBeVisible();
  return dropdown;
}

async function ensureNoneSelected(dropdown: any) {
  const selectAll = dropdown.locator('input[data-athlete-selector="select-all"]');
  if (await selectAll.isChecked()) {
    await selectAll.click();
  }
  await expect(selectAll).not.toBeChecked();
}

test.describe('Coach calendar: add-schedule placement', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('Single athlete: date header has no add button; athlete rows do', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iPad (gen 7)') {
      test.skip(true, 'Runs on iPad viewport where week grid + md controls are visible');
    }

    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();

    // Open selector and get athlete checkboxes.
    const dropdown = await openAthleteSelector(page);
    const athleteCheckboxes = dropdown.locator('input[data-athlete-selector="athlete-checkbox"]');
    const athleteCount = await athleteCheckboxes.count();
    expect(athleteCount).toBeGreaterThan(0);

    // Start from a known state: none selected.
    await ensureNoneSelected(dropdown);

    // --- Single athlete mode ---
    await athleteCheckboxes.first().click();

    // Close dropdown so it doesn't obscure clicks/locators.
    await page.keyboard.press('Escape');

    // Wait for week view to be active.
    const weekView = page.locator('[data-coach-week-view-version="coach-week-v2"]').first();
    await expect(weekView).toBeVisible();

    // Date header row should NEVER include the add-schedule button.
    const dateHeaders = weekView.getByTestId('coach-calendar-date-header');
    expect(await dateHeaders.count()).toBeGreaterThan(0);
    await expect(dateHeaders.filter({ has: page.getByTestId('athlete-week-day-column-add') })).toHaveCount(0);

    // Athlete rows should still include the add-schedule button.
    const athleteRows = weekView.getByTestId('coach-calendar-athlete-row');
    expect(await athleteRows.count()).toBeGreaterThan(0);
    await expect(athleteRows.filter({ hasNot: page.getByTestId('add-schedule-button') })).toHaveCount(0);
  });

  test('Multi athlete: date header has no add button; athlete rows do', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'iPad (gen 7)') {
      test.skip(true, 'Runs on iPad viewport where week grid + md controls are visible');
    }

    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();

    const dropdown = await openAthleteSelector(page);
    const athleteCheckboxes = dropdown.locator('input[data-athlete-selector="athlete-checkbox"]');
    const athleteCount = await athleteCheckboxes.count();
    expect(athleteCount).toBeGreaterThan(0);

    await ensureNoneSelected(dropdown);

    if (athleteCount < 2) {
      test.skip(true, 'Need at least 2 athletes to test multi-athlete mode');
    }

    await athleteCheckboxes.first().click();
    await athleteCheckboxes.nth(1).click();
    await page.keyboard.press('Escape');

    const weekView = page.locator('[data-coach-week-view-version="coach-week-v2"]').first();
    await expect(weekView).toBeVisible();

    await expect(
      weekView.getByTestId('coach-calendar-date-header').filter({ has: page.getByTestId('athlete-week-day-column-add') })
    ).toHaveCount(0);

    const athleteRows = weekView.getByTestId('coach-calendar-athlete-row');
    expect(await athleteRows.count()).toBeGreaterThan(0);
    await expect(athleteRows.filter({ hasNot: page.getByTestId('add-schedule-button') })).toHaveCount(0);
  });
});
