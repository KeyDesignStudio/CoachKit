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
  test.skip(
    process.env.RUN_PLAN_LIBRARY_TESTS !== '1',
    'Plan Library import specs are opt-in. Set RUN_PLAN_LIBRARY_TESTS=1 to enable.'
  );

  test('ALL apply populates plan tables only (no Workout Library pollution) and is idempotent on rerun', async ({ page }) => {
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

    const diag0 = await page.request.get('/api/admin/diagnostics/plan-library');
    expect(diag0.ok()).toBeTruthy();
    const diagPayload0 = (await diag0.json()) as any;
    expect(diagPayload0?.data?.workoutLibrary?.planLibrary?.total ?? 0).toBe(0);

    // Dry-run must validate schedule against same-request keysets (no PLAN_NOT_FOUND / SESSION_NOT_FOUND).
    const dryRunRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: true,
        confirmApply: false,
        limit: 50,
        offset: 0,
      },
    });

    expect(dryRunRes.ok()).toBeTruthy();
    const dryRunPayload = (await dryRunRes.json()) as any;
    const dryRunSteps: any[] = dryRunPayload?.data?.steps ?? [];
    expect(dryRunSteps.length).toBeGreaterThan(0);

    const dryRunSchedule = dryRunSteps.find((s) => s?.dataset === 'SCHEDULE');
    expect(dryRunSchedule?.errorCount ?? 0).toBe(0);
    expect(dryRunSchedule?.errors ?? []).toEqual([]);

    const applyRes = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: false,
        confirmApply: true,
        limit: 50,
        offset: 0,
      },
    });

    expect(applyRes.ok()).toBeTruthy();
    const applyPayload = (await applyRes.json()) as any;
    const applySteps: any[] = applyPayload?.data?.steps ?? [];
    expect(applySteps.length).toBeGreaterThan(0);
    for (const step of applySteps) {
      expect(step?.errorCount ?? 0).toBe(0);
    }

    const plansStep1 = applySteps.find((s) => s?.dataset === 'PLANS');
    const sessionsStep1 = applySteps.find((s) => s?.dataset === 'SESSIONS');
    const scheduleStep1 = applySteps.find((s) => s?.dataset === 'SCHEDULE');

    expect(plansStep1?.created ?? 0).toBeGreaterThan(0);
    expect(sessionsStep1?.created ?? 0).toBe(0);
    expect(sessionsStep1?.wouldCreate ?? 0).toBe(0);
    expect(scheduleStep1?.created ?? 0).toBeGreaterThan(0);

    const diag1 = await page.request.get('/api/admin/diagnostics/plan-library');
    expect(diag1.ok()).toBeTruthy();
    const diagPayload1 = (await diag1.json()) as any;
    const tables1: any[] = diagPayload1?.data?.tables ?? [];
    const planCount = tables1.find((t) => t?.table === 'PlanTemplate')?.rowCount;
    const scheduleCount = tables1.find((t) => t?.table === 'PlanTemplateScheduleRow')?.rowCount;
    expect(planCount ?? 0).toBeGreaterThan(0);
    expect(scheduleCount ?? 0).toBeGreaterThan(0);
    expect(diagPayload1?.data?.workoutLibrary?.planLibrary?.total ?? 0).toBe(0);

    // Rerun apply: should be idempotent (no create) and still no reference errors.
    const applyRes2 = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'ALL',
        dryRun: false,
        confirmApply: true,
        limit: 50,
        offset: 0,
      },
    });

    expect(applyRes2.ok()).toBeTruthy();
    const applyPayload2 = (await applyRes2.json()) as any;
    const applySteps2: any[] = applyPayload2?.data?.steps ?? [];
    expect(applySteps2.length).toBeGreaterThan(0);
    for (const step of applySteps2) {
      expect(step?.errorCount ?? 0).toBe(0);
    }

    const scheduleStep2 = applySteps2.find((s) => s?.dataset === 'SCHEDULE');
    expect(scheduleStep2?.created ?? 0).toBe(0);
  });

  test('SESSIONS apply is validation-only (never creates WorkoutLibrarySession)', async ({ page }) => {
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

    const res = await page.request.post('/api/admin/plan-library/import', {
      data: {
        dataset: 'SESSIONS',
        dryRun: false,
        confirmApply: true,
        limit: 50,
        offset: 0,
      },
    });

    expect(res.ok()).toBeTruthy();
    const payload = (await res.json()) as any;
    const steps: any[] = payload?.data?.steps ?? [];
    const sessionsStep = steps.find((s) => s?.dataset === 'SESSIONS');
    expect(sessionsStep?.created ?? 0).toBe(0);
    expect(sessionsStep?.updated ?? 0).toBe(0);

    const diag = await page.request.get('/api/admin/diagnostics/plan-library');
    expect(diag.ok()).toBeTruthy();
    const diagPayload = (await diag.json()) as any;
    expect(diagPayload?.data?.workoutLibrary?.planLibrary?.total ?? 0).toBe(0);
  });
});
