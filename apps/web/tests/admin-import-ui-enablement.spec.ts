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
  test('manual import requires file before running', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });
    await page.getByTestId('admin-workout-library-import').click();

    const fileInput = page.getByTestId('admin-import-file');
    const dryRunButton = page.getByTestId('admin-import-run-dryrun');

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

    // MANUAL-only: file input visible, buttons blocked without file.
    await expect(fileInput).toBeVisible();
    await expect(dryRunButton).toBeDisabled();

    // Apply gating: when dry-run unchecked, apply button requires confirm apply.
    await page.getByTestId('admin-import-dryrun-toggle').uncheck();
    const applyButton = page.getByTestId('admin-import-run-apply');
    await expect(applyButton).toBeDisabled();
    await page.getByLabel('Confirm apply').check();
    await expect(applyButton).toBeDisabled();

    // Put it back to dry-run for the rest of this test.
    await page.getByTestId('admin-import-dryrun-toggle').check();

    await fileInput.setInputFiles({
      name: 'manual-import.json',
      mimeType: 'application/json',
      buffer: manualJson,
    });

    await expect(dryRunButton).toBeEnabled();
  });
});
