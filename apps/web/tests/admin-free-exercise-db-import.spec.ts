import { test, expect } from '@playwright/test';

async function setRoleCookie(page: any, role: 'ADMIN') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

test('Admin can dry-run Free Exercise DB import', async ({ page }) => {
  await setRoleCookie(page, 'ADMIN');

  await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });

  await page.getByTestId('admin-workout-library-import').click();

  await page.getByTestId('admin-import-source').selectOption('FREE_EXERCISE_DB');

  await page.getByTestId('admin-free-exercise-db-limit').fill('5');
  await page.getByTestId('admin-free-exercise-db-offset').fill('0');

  await page.getByTestId('admin-import-run-dryrun').click();

  const result = page.getByTestId('admin-free-exercise-db-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Scanned 5');
});
