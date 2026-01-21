import { test, expect } from '@playwright/test';

test.describe('Manual workout delete (non-Strava)', () => {
  test('Planned manual workout can be deleted end-to-end and stays deleted', async ({ page, request }, testInfo) => {
    // This test mutates shared DB state; run it once to avoid cross-project interference.
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    const now = new Date();

    const fromDate = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    const toDate = new Date(now.getTime() + 2 * 24 * 60 * 60_000);

    const yyyyFrom = fromDate.getUTCFullYear();
    const mmFrom = String(fromDate.getUTCMonth() + 1).padStart(2, '0');
    const ddFrom = String(fromDate.getUTCDate()).padStart(2, '0');
    const from = `${yyyyFrom}-${mmFrom}-${ddFrom}`;

    const yyyyTo = toDate.getUTCFullYear();
    const mmTo = String(toDate.getUTCMonth() + 1).padStart(2, '0');
    const ddTo = String(toDate.getUTCDate()).padStart(2, '0');
    const to = `${yyyyTo}-${mmTo}-${ddTo}`;

    const uniqueTitle = `PW Manual Delete Smoke ${Date.now()}`;
    const athleteCookieHeader = { Cookie: 'coachkit-role=ATHLETE' };

    // 1) Create planned (non-Strava) workout.
    const created = await request.post('/api/athlete/calendar-items', {
      headers: athleteCookieHeader,
      data: {
        date: from,
        plannedStartTimeLocal: '06:00',
        discipline: 'RUN',
        title: uniqueTitle,
        plannedDurationMinutes: 30,
        workoutDetail: 'Playwright manual delete smoke',
      },
    });
    expect(created.ok()).toBeTruthy();
    const createdJson = await created.json();
    const itemId = String(createdJson.data?.item?.id ?? '');
    expect(itemId, 'Expected created calendar item id').toBeTruthy();

    // Make it review-inbox eligible (completed), so we can assert it disappears from the inbox after deletion.
    const completed = await request.post(`/api/athlete/calendar-items/${itemId}/complete`, {
      headers: athleteCookieHeader,
      data: {
        durationMinutes: 30,
        commentBody: 'Completed for delete smoke',
      },
    });
    expect(completed.ok()).toBeTruthy();

    // Ensure athlete calendar includes it (week view data source).
    const calBeforeDelete = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: athleteCookieHeader,
    });
    expect(calBeforeDelete.ok()).toBeTruthy();
    const calBeforeDeleteJson = await calBeforeDelete.json();
    const titlesBefore = (calBeforeDeleteJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesBefore.some((t: string) => t === uniqueTitle)).toBeTruthy();

    // Ensure coach review inbox includes it pre-delete (completed).
    const coachCookieHeader = { Cookie: 'coachkit-role=COACH' };
    const inboxBefore = await request.get(`/api/coach/review-inbox?_=${Date.now()}`, { headers: coachCookieHeader });
    expect(inboxBefore.ok()).toBeTruthy();
    const inboxBeforeJson = await inboxBefore.json();
    const inboxTitlesBefore = (inboxBeforeJson.data?.items ?? []).map((i: any) => i.title);
    expect(inboxTitlesBefore.some((t: string) => t === uniqueTitle)).toBeTruthy();

    // 2) Delete from athlete workout detail UI.
    await page.context().addCookies([
      {
        name: 'coachkit-role',
        value: 'ATHLETE',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await page.goto(`/athlete/workouts/${itemId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(uniqueTitle) })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete workout?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete workout' }).click();
    await expect(page.getByTestId('athlete-workout-toast')).toContainText('Workout deleted');

    // 4) Confirm idempotency: deleting twice does not error.
    const deleteAgain = await request.delete(`/api/athlete/calendar-items/${itemId}?_=${Date.now()}`, {
      headers: athleteCookieHeader,
    });
    expect(deleteAgain.ok()).toBeTruthy();

    // 3a) Athlete calendar no longer shows it.
    const calAfterDelete = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: athleteCookieHeader,
    });
    expect(calAfterDelete.ok()).toBeTruthy();
    const calAfterDeleteJson = await calAfterDelete.json();
    const titlesAfter = (calAfterDeleteJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesAfter.some((t: string) => t === uniqueTitle)).toBeFalsy();

    // 3b) Coach calendar no longer shows it.
    const coachCal = await request.get(
      `/api/coach/calendar?athleteId=dev-athlete&from=${from}&to=${to}&_=${Date.now()}`,
      { headers: coachCookieHeader }
    );
    expect(coachCal.ok()).toBeTruthy();
    const coachCalJson = await coachCal.json();
    const coachTitles = (coachCalJson.data?.items ?? []).map((i: any) => i.title);
    expect(coachTitles.some((t: string) => t === uniqueTitle)).toBeFalsy();

    // 3c) Coach review inbox does NOT show it (even though it was completed).
    const inboxAfter = await request.get(`/api/coach/review-inbox?_=${Date.now()}`, { headers: coachCookieHeader });
    expect(inboxAfter.ok()).toBeTruthy();
    const inboxAfterJson = await inboxAfter.json();
    const inboxTitlesAfter = (inboxAfterJson.data?.items ?? []).map((i: any) => i.title);
    expect(inboxTitlesAfter.some((t: string) => t === uniqueTitle)).toBeFalsy();

    // Also verify via the dashboard UI section (reuses the mobile smoke inbox surface).
    await page.context().addCookies([
      {
        name: 'coachkit-role',
        value: 'COACH',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/coach/dashboard', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 2, name: 'Review inbox' })).toBeVisible();
    const inboxSection = page.getByTestId('coach-dashboard-review-inbox');
    await expect(inboxSection).toBeVisible();
    await expect(inboxSection.getByText(uniqueTitle)).toHaveCount(0);

    // 3d) Direct GET detail returns not found.
    const detailAfterDelete = await request.get(`/api/athlete/calendar-items/${itemId}?_=${Date.now()}`, {
      headers: athleteCookieHeader,
    });
    expect(detailAfterDelete.status()).toBe(404);
  });
});
