import { test, expect } from '@playwright/test';

async function setRoleCookie(page: import('@playwright/test').Page, role: 'ADMIN') {
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

  const beforeListResp = await page.request.get('/api/admin/workout-library');
  expect(beforeListResp.ok()).toBeTruthy();
  const beforeListJson = await beforeListResp.json();
  const beforeIds: string[] = (beforeListJson?.data?.items ?? beforeListJson?.items ?? []).map((it: any) => it.id);

  await page.getByTestId('admin-workout-library-import').click();

  await page.getByTestId('admin-import-source').selectOption('FREE_EXERCISE_DB');

  // Ensure dry run is checked.
  const dryRunToggle = page.getByTestId('admin-import-dryrun-toggle');
  await expect(dryRunToggle).toBeChecked();

  const apiResponsePromise = page.waitForResponse((resp) => {
    return resp.url().includes('/api/admin/workout-library/import/free-exercise-db') && resp.request().method() === 'POST';
  });

  await page.getByTestId('admin-import-run-dryrun').click();

  const apiResponse = await apiResponsePromise;
  await expect(apiResponse.ok()).toBeTruthy();

  const json = await apiResponse.json();
  const data = (json?.data ?? json) as {
    source: 'FREE_EXERCISE_DB';
    dryRun: boolean;
    scanned: number;
    wouldCreate: number;
    wouldUpdate: number;
    skippedDuplicates: number;
    errors: number;
  };

  expect(data.source).toBe('FREE_EXERCISE_DB');
  expect(data.dryRun).toBe(true);
  expect(data.scanned).toBeGreaterThan(0);
  expect(data.wouldCreate).toBeGreaterThan(0);
  expect(data.errors).toBe(0);

  // Ensure this was a true dry-run (no creations/updates).
  const afterListResp = await page.request.get('/api/admin/workout-library');
  expect(afterListResp.ok()).toBeTruthy();
  const afterListJson = await afterListResp.json();
  const afterIds: string[] = (afterListJson?.data?.items ?? afterListJson?.items ?? []).map((it: any) => it.id);
  expect(afterIds.slice(0, 50)).toEqual(beforeIds.slice(0, 50));
});
