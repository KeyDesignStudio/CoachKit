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

test('Athlete dashboard panels align on desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setRoleCookie(page, 'ATHLETE');
  await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

  const plannedCard = page.getByTestId('athlete-range-planned-card');
  const caloriesCard = page.getByTestId('athlete-range-calories-card');
  const nextUpCard = page.getByTestId('athlete-range-nextup-card');

  await expect(plannedCard).toBeVisible();
  await expect(caloriesCard).toBeVisible();
  await expect(nextUpCard).toBeVisible();

  const plannedBox = await plannedCard.boundingBox();
  const caloriesBox = await caloriesCard.boundingBox();
  const nextUpBox = await nextUpCard.boundingBox();

  expect(plannedBox, 'Planned card should have a bounding box').toBeTruthy();
  expect(caloriesBox, 'Calories card should have a bounding box').toBeTruthy();
  expect(nextUpBox, 'Next up card should have a bounding box').toBeTruthy();

  if (plannedBox && caloriesBox && nextUpBox) {
    expect(caloriesBox.y).toBeLessThanOrEqual(plannedBox.y + 4);
    expect(Math.abs(plannedBox.y - nextUpBox.y)).toBeLessThanOrEqual(4);
    expect(caloriesBox.width).toBeGreaterThan(plannedBox.width);
  }
});
