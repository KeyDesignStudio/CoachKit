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
          expect(selectorBox.y, 'Make your selection should be above the fold on mobile').toBeLessThanOrEqual(viewportHeight - 10);
    }

    await expect(page.getByRole('heading', { level: 2, name: 'At a glance' })).toBeVisible();
    const kpiGrid = page.getByTestId('coach-dashboard-at-a-glance-grid');
    await expect(kpiGrid).toBeVisible();
    const statsBox = page.getByTestId('coach-dashboard-at-a-glance-stats');
    await expect(statsBox).toBeVisible();
    await expect(statsBox.getByTestId('coach-dashboard-at-a-glance-stat-row')).toHaveCount(4);

    const disciplineCard = page.getByTestId('coach-dashboard-discipline-load');
    await expect(disciplineCard).toBeVisible();
    const disciplineOverflow = await disciplineCard.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(disciplineOverflow, 'Discipline load section should not overflow horizontally').toBeFalsy();

    // Review Inbox stays on the dashboard.
    await expect(page.getByRole('heading', { level: 2, name: 'Review inbox' })).toBeVisible();
    const inboxSection = page.getByTestId('coach-dashboard-review-inbox');
    await expect(inboxSection).toBeVisible();

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

  test('Coach messages loads (messages-only) and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'COACH');
    await page.goto('/coach/notifications', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();

    const messagesSection = page.getByTestId('coach-notifications-messages');
    await expect(messagesSection).toBeVisible();

    const compose = page.getByTestId('coach-notifications-messages-compose');
    await expect(compose).toBeVisible();
    await expect(page.getByRole('button', { name: /^Broadcast$/ })).toBeVisible();

    // Review Inbox must NOT be present on notifications.
    await expect(page.getByTestId('coach-dashboard-review-inbox')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Review inbox' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Mark Reviewed/i })).toHaveCount(0);

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
    const statsBox = page.getByTestId('athlete-dashboard-at-a-glance-stats');
    await expect(statsBox).toBeVisible();
    await expect(statsBox.getByTestId('athlete-dashboard-at-a-glance-stat-row')).toHaveCount(4);
    await assertNoHorizontalScroll(page);
  });

  test('Athlete messages loads and no horizontal scroll', async ({ page }) => {
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/notifications', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Messages' })).toBeVisible();

    const compose = page.getByTestId('athlete-notifications-messages-compose');
    await expect(compose).toBeVisible();
    await expect(compose.getByRole('button', { name: /^Send$/ })).toBeVisible();

    await assertNoHorizontalScroll(page);
  });
});
