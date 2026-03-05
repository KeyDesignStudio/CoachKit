import { test, expect } from '@playwright/test';

function addDays(dayKey: string, deltaDays: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

test.describe('Athlete dashboard greeting confetti', () => {
  test('shows greeting confetti when greeting includes congratulations', async ({ page, request }, testInfo) => {
    // This test mutates shared DB state; keep it on one project.
    if (testInfo.project.name !== 'iPhone 15 Pro Max') test.skip();

    const athleteCookieHeader = { Cookie: 'coachkit-role=ATHLETE' };

    const baselineResp = await request.get('/api/athlete/dashboard/console', { headers: athleteCookieHeader });
    expect(baselineResp.ok()).toBeTruthy();
    const baselineJson = await baselineResp.json();
    const todayDayKey = String(baselineJson.data?.rangeSummary?.fromDayKey ?? '');
    expect(todayDayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const yesterdayDayKey = addDays(todayDayKey, -1);

    const createdIds: string[] = [];
    for (const [idx, dayKey] of [yesterdayDayKey, todayDayKey].entries()) {
      const createRes = await request.post('/api/athlete/calendar-items', {
        headers: athleteCookieHeader,
        data: {
          date: dayKey,
          plannedStartTimeLocal: idx === 0 ? '07:00' : '17:30',
          discipline: 'RUN',
          title: `PW Greeting Confetti ${Date.now()}-${idx}`,
          plannedDurationMinutes: 30,
        },
      });
      expect(createRes.ok()).toBeTruthy();
      const createJson = await createRes.json();
      const id = String(createJson.data?.item?.id ?? '');
      expect(id).toBeTruthy();
      createdIds.push(id);

      const completeRes = await request.post(`/api/athlete/calendar-items/${id}/complete`, {
        headers: athleteCookieHeader,
        data: {
          durationMinutes: 30,
        },
      });
      expect(completeRes.ok()).toBeTruthy();
    }

    await page.context().addCookies([
      {
        name: 'coachkit-role',
        value: 'ATHLETE',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto('/athlete/dashboard', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('athlete-dashboard-greeting-confetti')).toBeVisible();

    for (const id of createdIds) {
      await request.delete(`/api/athlete/calendar-items/${id}`, { headers: athleteCookieHeader });
    }
  });
});
