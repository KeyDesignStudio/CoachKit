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

    await expect(page.getByRole('heading', { level: 1, name: 'Coach Console' })).toBeVisible();

    // Dashboard verification (single assertion set): no calendar UI, mobile layout expectations,
    // and no horizontal overflow at iPhone/iPad viewport widths.
    await expect(page.locator('[data-cal-shell="true"]')).toHaveCount(0);
    await expect(page.getByRole('option', { name: /^Calendar$/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /^Week$/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /^Month$/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /^Day$/ })).toHaveCount(0);
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await expect(page.getByText(day, { exact: true })).toHaveCount(0);
    }

    const selectorHeading = page.getByRole('heading', { level: 2, name: 'Make your selection' });
    await expect(selectorHeading).toBeVisible();
    const needsAttentionHeading = page.getByRole('heading', { level: 2, name: 'Needs your attention' });
    await expect(needsAttentionHeading).toBeVisible();

    const selectorBox = await selectorHeading.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    expect(selectorBox, 'Make your selection should have a bounding box').toBeTruthy();
    if (selectorBox && viewportHeight) {
      expect(selectorBox.y, 'Make your selection should be above the fold on mobile').toBeLessThan(viewportHeight - 50);
    }

    await expect(page.getByRole('heading', { level: 2, name: 'At a glance' })).toBeVisible();
    const kpiGrid = page.getByTestId('coach-dashboard-at-a-glance-grid');
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.locator('div.rounded-2xl')).toHaveCount(4);
    const kpiColumns = await kpiGrid.evaluate((el) => {
      const tpl = window.getComputedStyle(el).gridTemplateColumns;
      const repeatMatch = tpl.match(/repeat\((\d+)\s*,/);
      if (repeatMatch) return Number(repeatMatch[1]);
      const parts = tpl.split(' ').filter(Boolean);
      return parts.length;
    });
    const viewportWidth = page.viewportSize()?.width ?? 0;
    const expectedColumns = viewportWidth > 0 && viewportWidth < 360 ? 1 : 2;
    expect(kpiColumns, `KPI tiles should use ${expectedColumns} column(s) at this viewport`).toBe(expectedColumns);

    const disciplineSection = page.getByRole('heading', { level: 2, name: 'Discipline load' }).locator('..');
    await expect(disciplineSection).toBeVisible();
    const disciplineCard = disciplineSection.locator('div.rounded-2xl').first();
    const disciplineOverflow = await disciplineCard.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(disciplineOverflow, 'Discipline load section should not overflow horizontally').toBeFalsy();

    await expect(page.getByRole('heading', { level: 2, name: 'Review inbox' })).toBeVisible();
    const inboxSection = page.getByTestId('coach-dashboard-review-inbox');
    await expect(inboxSection).toBeVisible();
    await expect(page.getByRole('button', { name: /^Mark Reviewed/ })).toBeVisible();

    // Bulk select still works when inbox rows exist.
    const inboxCard = inboxSection.locator('div.rounded-2xl').first();
    const inboxCheckboxes = inboxCard.locator('input[type="checkbox"]');
    const inboxCheckboxCount = await inboxCheckboxes.count();
    if (inboxCheckboxCount > 0) {
      await inboxCheckboxes.first().click();
      await expect(page.getByRole('button', { name: /Mark Reviewed.*\(1\)/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled();
    }

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

  test('Athlete dashboard loads and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { level: 1, name: 'Athlete Console' })).toBeVisible();

    const kpiGrid = page.getByTestId('athlete-dashboard-at-a-glance-grid');
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.locator('div.rounded-2xl')).toHaveCount(4);

    const compose = page.getByTestId('athlete-dashboard-messages-compose');
    await expect(compose).toBeVisible();
    await expect(compose.getByRole('button', { name: /^Send$/ })).toBeVisible();

    await assertNoHorizontalScroll(page);
  });
});
