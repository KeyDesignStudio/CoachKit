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

test('Athlete dashboard uses the redesigned desktop layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setRoleCookie(page, 'ATHLETE');
  await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { level: 2, name: 'Make your selection' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Needs your attention' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'At a glance' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Calories' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Planned vs Completed' })).toBeVisible();
  await expect(page.getByText('Strava Vitals')).toBeVisible();

  const needsCard = page.getByRole('heading', { level: 2, name: 'Needs your attention' });
  const glanceCard = page.getByRole('heading', { level: 2, name: 'At a glance' });
  const plannedCard = page.getByRole('heading', { level: 2, name: 'Planned vs Completed' });
  const caloriesCard = page.getByTestId('athlete-dashboard-calories-chart');
  const complianceCard = page.getByTestId('athlete-dashboard-compliance-chart');
  const stravaCard = page.getByText('Strava Vitals');

  const needsBox = await needsCard.boundingBox();
  const glanceBox = await glanceCard.boundingBox();
  const plannedBox = await plannedCard.boundingBox();
  await expect(caloriesCard).toBeVisible();
  await expect(complianceCard).toBeVisible();
  const stravaBox = await stravaCard.boundingBox();

  const caloriesBox = await caloriesCard.boundingBox();
  const complianceBox = await complianceCard.boundingBox();

  expect(needsBox, 'Needs card should have a bounding box').toBeTruthy();
  expect(glanceBox, 'At a glance card should have a bounding box').toBeTruthy();
  expect(plannedBox, 'Planned vs Completed card should have a bounding box').toBeTruthy();
  expect(caloriesBox, 'Calories card should have a bounding box').toBeTruthy();
  expect(complianceBox, 'Compliance card should have a bounding box').toBeTruthy();
  expect(stravaBox, 'Strava card should have a bounding box').toBeTruthy();

  if (needsBox && glanceBox && plannedBox && caloriesBox && complianceBox && stravaBox) {
    expect(Math.abs(needsBox.y - glanceBox.y)).toBeLessThanOrEqual(8);
    expect(Math.abs(glanceBox.y - plannedBox.y)).toBeLessThanOrEqual(8);
    expect(Math.abs(caloriesBox.y - stravaBox.y)).toBeLessThanOrEqual(24);
    expect(caloriesBox.y).toBeGreaterThan(plannedBox.y + 40);
    expect(complianceBox.y).toBeLessThan(caloriesBox.y);
    expect(caloriesBox.width).toBeGreaterThan(0);
  }
});

test('Athlete dashboard sidebar collapse state persists on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setRoleCookie(page, 'ATHLETE');
  await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

  const toggle = page.getByTestId('athlete-dashboard-sidebar-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('athlete-dashboard-sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('Athlete dashboard opens and closes sidebar drawer on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setRoleCookie(page, 'ATHLETE');
  await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });

  const openToggle = page.getByTestId('athlete-dashboard-mobile-sidebar-toggle');
  await expect(openToggle).toBeVisible();
  await expect(page.getByTestId('athlete-dashboard-sidebar-mobile')).toHaveCount(0);

  await openToggle.click();
  await expect(page.getByTestId('athlete-dashboard-sidebar-mobile')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Make your selection' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dashboard sidebar' }).click();
  await expect(page.getByTestId('athlete-dashboard-sidebar-mobile')).toHaveCount(0);
});
