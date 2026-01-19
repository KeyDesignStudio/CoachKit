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

  test('returns KAGGLE_SAMPLE_TOO_SMALL when sample window is tiny', async ({ page }) => {
    await setRoleCookie(page, 'ADMIN');

    const res = await page.request.post('/api/admin/workout-library/import/kaggle', {
      headers: {
        // Test-only override (enabled when DISABLE_AUTH=true)
        'x-kaggle-sample-bytes': '1024',
      },
      data: {
        dryRun: true,
        confirmApply: false,
        maxRows: 200,
        offset: 0,
      },
    });

    await expectOk(res, 'kaggle import sample-too-small');
    const json = (await res.json()) as any;
    expect(json?.error).toBeNull();
    expect(json?.data?.dryRun).toBe(true);
    expect(json?.data?.sampleTooSmall?.code).toBe('KAGGLE_SAMPLE_TOO_SMALL');
    expect(json?.data?.sampleTooSmall?.diagnostics?.sampleBytes).toBe(1024);
  });
});
