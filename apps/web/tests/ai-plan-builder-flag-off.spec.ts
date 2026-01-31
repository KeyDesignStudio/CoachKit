import { expect, test } from '@playwright/test';

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE' | 'ADMIN') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

test.describe('AI Plan Builder v1: flag OFF gating', () => {
  test('unrelated route is unaffected when disabled', async ({ page }) => {
    const res = await page.request.get('/api/health/db');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('coach route is 404 when disabled', async ({ page }) => {
    await setRoleCookie(page, 'COACH');

    const res = await page.goto('/coach/athletes/dev-athlete/ai-plan-builder', {
      waitUntil: 'domcontentloaded',
    });

    expect(res?.status()).toBe(404);
  });

  test('API routes are 404 when disabled', async ({ page }) => {
    await setRoleCookie(page, 'COACH');

    const athleteId = 'dev-athlete';

    const checks: Array<{ method: 'POST' | 'PATCH'; url: string; data?: any }> = [
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`, data: {} },
      {
        method: 'PATCH',
        url: `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/draft`,
        data: { intakeResponseId: 'nope', draftJson: {} },
      },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/intake/submit`, data: {} },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`, data: {} },
      { method: 'PATCH', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/override`, data: {} },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/profile/approve`, data: {} },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan`, data: {} },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/proposal`, data: {} },
      { method: 'POST', url: `/api/coach/athletes/${athleteId}/ai-plan-builder/audit`, data: {} },
    ];

    for (const check of checks) {
      const res =
        check.method === 'POST'
          ? await page.request.post(check.url, { data: check.data ?? {} })
          : await page.request.patch(check.url, { data: check.data ?? {} });

      expect(res.status(), `${check.method} ${check.url}`).toBe(404);
    }
  });
});
