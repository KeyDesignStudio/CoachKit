import { test, expect } from '@playwright/test';

async function setRoleCookie(page: import('@playwright/test').Page, role: 'ADMIN') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Admin import UI enablement', () => {
  test('remote sources do not require file, manual does', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });
    await page.getByTestId('admin-workout-library-import').click();

    const fileInput = page.getByTestId('admin-import-file');
    const sourceSelect = page.getByTestId('admin-import-source');
    const dryRunButton = page.getByTestId('admin-import-run-dryrun');

    // Default is MANUAL: file input visible, buttons blocked without file.
    await expect(fileInput).toBeVisible();
    await expect(dryRunButton).toBeDisabled();

    // Switch to FREE_EXERCISE_DB: no file required; file input hidden.
    await sourceSelect.selectOption('FREE_EXERCISE_DB');
    await expect(fileInput).toBeHidden();
    await expect(page.getByTestId('admin-import-file-helper')).toBeVisible();
    await expect(dryRunButton).toBeEnabled();

    // Switch to KAGGLE: no file required; file input hidden.
    await sourceSelect.selectOption('KAGGLE');
    await expect(fileInput).toBeHidden();
    await expect(dryRunButton).toBeEnabled();

    // Running Kaggle dry-run should succeed (uses local fixture via KAGGLE_DATA_PATH).
    await dryRunButton.click();
    await expect(page.getByText(/Scanned\s+\d+/)).toBeVisible();
  });
});
