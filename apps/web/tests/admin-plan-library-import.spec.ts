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

test.describe('Plan Library import (admin)', () => {
  test('Dry-run ALL has no reference errors; apply + publish succeed', async ({ page }) => {
    test.skip(!process.env.DATABASE_URL, 'DATABASE_URL is required for plan-library import tests.');

    await setRoleCookie(page, 'ADMIN');

    const dryRunRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: true,
        confirmApply: false,
      },
    });

    expect(dryRunRes.ok()).toBeTruthy();
    const dryRunPayload = (await dryRunRes.json()) as any;
    const dryRunSteps: any[] = dryRunPayload?.data?.steps ?? [];
    expect(dryRunSteps.length).toBeGreaterThan(0);
    for (const step of dryRunSteps) {
      expect(step?.errorCount ?? 0).toBe(0);
      expect(step?.created ?? 0).toBe(0);
      expect(step?.updated ?? 0).toBe(0);
    }

    const applyRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: false,
        confirmApply: true,
      },
    });

    expect(applyRes.ok()).toBeTruthy();
    const applyPayload = (await applyRes.json()) as any;
    const applySteps: any[] = applyPayload?.data?.steps ?? [];
    expect(applySteps.length).toBeGreaterThan(0);
    for (const step of applySteps) {
      expect(step?.errorCount ?? 0).toBe(0);
    }

    const postDryRunRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: true,
        confirmApply: false,
      },
    });

    expect(postDryRunRes.ok()).toBeTruthy();
    const postDryRunPayload = (await postDryRunRes.json()) as any;
    const postDryRunSteps: any[] = postDryRunPayload?.data?.steps ?? [];
    expect(postDryRunSteps.length).toBeGreaterThan(0);
    for (const step of postDryRunSteps) {
      expect(step?.errorCount ?? 0).toBe(0);
    }

    const publishRes = await page.request.post('/api/admin/plan-library/publish', {
      data: {
        confirmApply: true,
        allowMoreThanCap: true,
      },
    });

    expect(publishRes.ok()).toBeTruthy();
    const publishPayload = (await publishRes.json()) as any;
    expect(typeof publishPayload?.data?.matchedCount).toBe('number');
    expect(typeof publishPayload?.data?.publishedCount).toBe('number');

    const diagRes = await page.request.get('/api/admin/diagnostics/plan-library');
    expect(diagRes.ok()).toBeTruthy();
    const diagPayload = (await diagRes.json()) as any;
    const planLibrary = diagPayload?.data?.workoutLibrary?.planLibrary;
    expect(typeof planLibrary?.total).toBe('number');
    expect(typeof planLibrary?.draft).toBe('number');
    expect(typeof planLibrary?.published).toBe('number');
  });
});
