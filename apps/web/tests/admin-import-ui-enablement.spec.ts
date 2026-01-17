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

    // Default is MANUAL: file input visible, buttons blocked without file.
    await expect(fileInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Dry-Run' }).first()).toBeDisabled();

    // Switch to FREE_EXERCISE_DB: no file required; file input hidden.
    await page.getByRole('combobox', { name: 'Source' }).selectOption('FREE_EXERCISE_DB');
    await expect(fileInput).toBeHidden();
    await expect(page.getByTestId('admin-import-file-helper')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Dry-Run' }).first()).toBeEnabled();

    // Switch to KAGGLE: no file required; file input hidden.
    await page.getByRole('combobox', { name: 'Source' }).selectOption('KAGGLE');
    await expect(fileInput).toBeHidden();
    await expect(page.getByRole('button', { name: 'Run Dry-Run' }).first()).toBeEnabled();

    // Running Kaggle dry-run should succeed (uses local fixture via KAGGLE_DATA_PATH).
    await page.getByRole('button', { name: 'Run Dry-Run' }).first().click();
    await expect(page.getByText(/Scanned\s+\d+/)).toBeVisible();
  });
});
