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

    // Ensure we start from an empty Plan Library state (non-prod only).
    const resetRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: false,
        confirmApply: true,
        reset: true,
      },
    });

    if (!resetRes.ok()) {
      const payload = (await resetRes.json()) as any;
      const code = payload?.error?.code;
      test.skip(code === 'RESET_BLOCKED_HAS_ATHLETE_DATA', 'Reset blocked: athlete plan history exists in test DB.');
      throw new Error(`Plan Library reset failed: ${code ?? 'unknown_error'}`);
    }

    const dryRunRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: true,
        confirmApply: false,
        limit: 20,
      },
    });

    expect(dryRunRes.ok()).toBeTruthy();
    const dryRunPayload = (await dryRunRes.json()) as any;
    const dryRunSteps: any[] = dryRunPayload?.data?.steps ?? [];
    expect(dryRunSteps.length).toBeGreaterThan(0);

    const plansStep = dryRunSteps.find((s) => s?.dataset === 'PLANS');
    const sessionsStep = dryRunSteps.find((s) => s?.dataset === 'SESSIONS');
    const scheduleStep = dryRunSteps.find((s) => s?.dataset === 'SCHEDULE');

    expect((plansStep?.wouldCreate ?? 0) + (plansStep?.wouldUpdate ?? 0)).toBeGreaterThan(0);
    expect((sessionsStep?.wouldCreate ?? 0) + (sessionsStep?.wouldUpdate ?? 0)).toBeGreaterThan(0);
    expect(scheduleStep?.errorCount ?? 0).toBe(0);
    expect(scheduleStep?.errors ?? []).toEqual([]);

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
