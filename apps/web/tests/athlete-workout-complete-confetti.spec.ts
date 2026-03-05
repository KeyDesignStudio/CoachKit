import { test, expect } from '@playwright/test';

test.describe('Athlete workout complete confetti', () => {
  test('shows button-origin confetti after successful complete', async ({ page, request }, testInfo) => {
    // This test mutates shared DB state; keep it on one project.
    if (testInfo.project.name !== 'iPhone 15 Pro Max') test.skip();

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;

    const uniqueTitle = `PW Complete Confetti ${Date.now()}`;
    const athleteCookieHeader = { Cookie: 'coachkit-role=ATHLETE' };

    const created = await request.post('/api/athlete/calendar-items', {
      headers: athleteCookieHeader,
      data: {
        date: today,
        plannedStartTimeLocal: '06:30',
        discipline: 'RUN',
        title: uniqueTitle,
        plannedDurationMinutes: 30,
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdJson = await created.json();
    const itemId = String(createdJson.data?.item?.id ?? '');
    expect(itemId).toBeTruthy();

    await page.context().addCookies([
      {
        name: 'coachkit-role',
        value: 'ATHLETE',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto(`/athlete/workouts/${itemId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete' }).click();

    await expect(page.getByTestId('athlete-workout-complete-confetti')).toBeVisible();

    // Cleanup created test workout.
    await request.delete(`/api/athlete/calendar-items/${itemId}`, {
      headers: athleteCookieHeader,
    });
  });
});
