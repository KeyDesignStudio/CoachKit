import { test, expect } from '@playwright/test';

type Role = 'COACH' | 'ATHLETE' | 'ADMIN';

async function setRoleCookie(page: import('@playwright/test').Page, role: Role) {
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

async function setTestCookie(page: import('@playwright/test').Page, name: string, value: string) {
  await page.context().addCookies([
    {
      name,
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

async function expectOk(res: import('@playwright/test').APIResponse, label: string) {
  if (res.ok()) return;
  const status = res.status();
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '<unable to read body>';
  }
  throw new Error(`${label} failed: HTTP ${status}\n${body.slice(0, 2000)}`);
}

test.describe('Admin Kaggle ingestion', () => {
  test('dry-run, apply, and idempotency (CSV, grouped by program day)', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    await page.goto('/admin/workout-library', { waitUntil: 'networkidle' });
    await page.getByTestId('admin-workout-library-import').click();

    await page.getByTestId('admin-import-source').selectOption('KAGGLE');

    // Dry-run
    await expect(page.getByTestId('admin-import-dryrun-toggle')).toBeChecked();
    await page.getByTestId('admin-import-run-dryrun').click();
    await expect(page.getByText(/Scanned groups\s+\d+/)).toBeVisible();
    await expect(page.getByText(/Would create\s+\d+/)).toBeVisible();

    // Apply
    await page.getByTestId('admin-import-dryrun-toggle').uncheck();
    await page.getByLabel('Confirm apply').check();
    await page.getByTestId('admin-import-run-apply').click();

    // Back to dry-run: wouldCreate should now be 0.
    await page.getByTestId('admin-import-dryrun-toggle').check();
    await page.getByTestId('admin-import-run-dryrun').click();
    await expect(page.getByText(/Would create\s+0/)).toBeVisible();
  });

  test('kill switch returns KAGGLE_DISABLED', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    // Test-only override (enabled when DISABLE_AUTH=true): disables Kaggle import.
    await setTestCookie(page, 'coachkit-kaggle-import-enabled', 'false');

    const res = await page.request.post('/api/admin/workout-library/import/kaggle', {
      data: {
        dryRun: true,
        confirmApply: false,
        maxRows: 50,
        offset: 0,
      },
    });

    expect(res.status()).toBe(403);
    const json = (await res.json()) as any;
    expect(json?.error?.code).toBe('KAGGLE_DISABLED');
  });
});
