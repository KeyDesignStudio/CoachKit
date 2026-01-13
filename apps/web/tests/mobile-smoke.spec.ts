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

async function assertNoHorizontalScroll(page: any) {
  const hasOverflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = Math.max(doc.clientWidth, body.clientWidth);
    return scrollWidth > clientWidth + 1;
  });
  expect(hasOverflow, 'Page should not have horizontal overflow').toBeFalsy();
}

test.describe('Mobile smoke', () => {
  test('Coach dashboard loads (auth disabled) and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/dashboard', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Inbox' })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('Coach athletes loads and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/athletes', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Athlete Profiles' })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('Coach calendar loads and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('Athlete selector: select-all indeterminate works', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();

    await page.locator('[data-athlete-selector="button"]').click();
    const dropdown = page.locator('[data-athlete-selector="dropdown"]');
    await expect(dropdown).toBeVisible();

    const selectAll = dropdown.locator('input[data-athlete-selector="select-all"]');
    const athleteCheckboxes = dropdown.locator('input[data-athlete-selector="athlete-checkbox"]');
    const athleteCount = await athleteCheckboxes.count();
    expect(athleteCount).toBeGreaterThan(0);

    // Ensure we start from a known state: none selected.
    if (await selectAll.isChecked()) {
      await selectAll.click();
    }

    if (athleteCount < 2) {
      test.skip(true, 'Need at least 2 athletes to test indeterminate state');
    }

    await athleteCheckboxes.first().click();

    await expect(selectAll).not.toBeChecked();
    const isIndeterminate = await selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate);
    expect(isIndeterminate).toBeTruthy();

    // Clicking select-all from indeterminate should select all.
    await selectAll.click();
    await expect(selectAll).toBeChecked();
    const indeterminateAfterAll = await selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate);
    expect(indeterminateAfterAll).toBeFalsy();

    for (let i = 0; i < athleteCount; i++) {
      await expect(athleteCheckboxes.nth(i)).toBeChecked();
    }

    // Clicking select-all when all selected should clear all.
    await selectAll.click();
    await expect(selectAll).not.toBeChecked();
    const indeterminateAfterNone = await selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate);
    expect(indeterminateAfterNone).toBeFalsy();

    for (let i = 0; i < athleteCount; i++) {
      await expect(athleteCheckboxes.nth(i)).not.toBeChecked();
    }
  });

  test('Athlete calendar loads and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});
