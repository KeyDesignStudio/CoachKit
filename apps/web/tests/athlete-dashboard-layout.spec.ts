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

  const caloriesCard = page.getByTestId('athlete-dashboard-calories-chart');
  const complianceCard = page.getByTestId('athlete-dashboard-compliance-chart');

  await expect(caloriesCard).toBeVisible();
  await expect(complianceCard).toBeVisible();

  const caloriesBox = await caloriesCard.boundingBox();
  const complianceBox = await complianceCard.boundingBox();

  expect(caloriesBox, 'Calories card should have a bounding box').toBeTruthy();
  expect(complianceBox, 'Compliance card should have a bounding box').toBeTruthy();

  if (caloriesBox && complianceBox) {
    expect(Math.abs(caloriesBox.y - complianceBox.y)).toBeLessThanOrEqual(4);
    expect(caloriesBox.width).toBeGreaterThan(0);
  }
});
