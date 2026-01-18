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
    const primaryButton = page.getByTestId('admin-import-primary');

    await expect(page.locator('[data-testid="admin-import-primary"]')).toHaveCount(1);
    await expect(page.getByTestId('admin-free-exercise-db-run')).toHaveCount(0);

    const manualJson = Buffer.from(
      JSON.stringify([
        {
          title: 'Test Manual Workout',
          discipline: 'RUN',
          description: 'Fixture workout for manual import.',
          intensityTarget: 'Easy',
          durationSec: 1800,
        },
      ])
    );

    // Default is MANUAL: file input visible, buttons blocked without file.
    await expect(fileInput).toBeVisible();
    await expect(primaryButton).toHaveText('Run Dry-Run');
    await expect(primaryButton).toBeDisabled();

    // Switch to FREE_EXERCISE_DB: no file required; file input hidden.
    await sourceSelect.selectOption('FREE_EXERCISE_DB');
    await expect(fileInput).toBeHidden();
    await expect(page.getByTestId('admin-import-file-helper')).toBeVisible();
    await expect(primaryButton).toHaveText('Run Dry-Run');
    await expect(primaryButton).toBeEnabled();

    // Switch to KAGGLE: no file required; file input hidden.
    await sourceSelect.selectOption('KAGGLE');
    await expect(fileInput).toBeHidden();
    await expect(primaryButton).toHaveText('Run Dry-Run');
    await expect(primaryButton).toBeEnabled();

    // Running Kaggle dry-run should succeed (uses local fixture via KAGGLE_DATA_PATH).
    await primaryButton.click();
    await expect(page.getByText(/Scanned\s+\d+/)).toBeVisible();

    // Apply gating: when dry-run unchecked, primary action becomes Import Now and requires confirm apply.
    await page.getByLabel('Dry run').uncheck();
    await expect(primaryButton).toHaveText('Import Now');
    await expect(primaryButton).toBeDisabled();
    await page.getByLabel('Confirm apply').check();
    await expect(primaryButton).toBeEnabled();

    // Put it back to dry-run for the rest of this test.
    await page.getByLabel('Dry run').check();

    // Switch back to MANUAL: requires file parsed before enabling dry-run.
    await sourceSelect.selectOption('MANUAL');
    await expect(fileInput).toBeVisible();
    await expect(primaryButton).toHaveText('Run Dry-Run');
    await expect(primaryButton).toBeDisabled();

    await fileInput.setInputFiles({
      name: 'manual-import.json',
      mimeType: 'application/json',
      buffer: manualJson,
    });

    await expect(primaryButton).toBeEnabled();
  });
});
