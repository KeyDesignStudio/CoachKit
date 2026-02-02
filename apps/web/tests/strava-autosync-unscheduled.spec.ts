import { test, expect } from '@playwright/test';

import { prisma } from '../lib/prisma';

async function setRoleCookie(page: any, role: 'COACH' | 'ATHLETE') {
  await page.context().addCookies([
    {
      name: 'coachkit-role',
      value: role,
      domain: 'localhost',
      path: '/',
    },
  ]);
}

function dayKeyUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

test.describe('Strava autosync (debounced)', () => {
  test('Unmatched Strava activity surfaces in calendar, can be deleted, and is tombstoned', async ({ page, request }, testInfo) => {
    // This test mutates shared DB state; run it once to avoid cross-project interference.
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    // Ensure dev fixtures exist (coach+athlete+athleteProfile+stravaConnection).
    const fixtures = await request.post('/api/dev/strava/test-fixtures');
    expect(fixtures.ok()).toBeTruthy();

    // Clean up any prior run residue for the fixed activity id.
    // This test depends on observing the transition from "not present" → "present".
    await prisma.calendarItem.deleteMany({ where: { athleteId: 'dev-athlete', origin: 'STRAVA', sourceActivityId: '999' } });
    await prisma.completedActivity.deleteMany({ where: { athleteId: 'dev-athlete', source: 'STRAVA', externalActivityId: '999' } as any });

    // Webhook marks athlete as pending (no heavy sync inline).
    const webhook = await request.post('/api/integrations/strava/webhook', {
      data: {
        object_type: 'activity',
        aspect_type: 'create',
        owner_id: 123,
        object_id: 999,
        event_time: Math.floor(Date.now() / 1000),
      },
    });
    expect(webhook.ok()).toBeTruthy();

    const now = new Date();
    const from = dayKeyUtc(new Date(now.getTime() - 2 * 24 * 60 * 60_000));
    const to = dayKeyUtc(new Date(now.getTime() + 2 * 24 * 60 * 60_000));
    const cookieHeader = { Cookie: 'coachkit-role=ATHLETE' };

    // Webhook is intent-only; calendar API should NOT show the item until cron runs.
    const calBefore = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(calBefore.ok()).toBeTruthy();
    const calBeforeJson = await calBefore.json();
    const itemsBefore = (calBeforeJson.data?.items ?? []) as any[];
    expect(itemsBefore.some((i: any) => i.origin === 'STRAVA' && String(i.sourceActivityId) === '999')).toBeFalsy();

    // Backfill endpoint should surface it and remain idempotent (safety net).
    const cron2 = await request.post('/api/integrations/strava/cron?mode=intents&athleteId=dev-athlete&forceDays=1', {
      headers: {
        'x-cron-secret': `${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron2.ok()).toBeTruthy();
    const cron2Json = await cron2.json();
    expect(cron2Json.ok).toBeTruthy();
    expect(cron2Json.createdCalendarItems).toBeGreaterThanOrEqual(1);

    const calAfter = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(calAfter.ok()).toBeTruthy();
    const calAfterJson = await calAfter.json();
    const itemsAfter = (calAfterJson.data?.items ?? []) as any[];
    expect(itemsAfter.some((i: any) => i.origin === 'STRAVA' && String(i.sourceActivityId) === '999')).toBeTruthy();

    // Repeat cron; should not duplicate.
    const cron3 = await request.post('/api/integrations/strava/cron?mode=intents&athleteId=dev-athlete&forceDays=1', {
      headers: {
        'x-cron-secret': `${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron3.ok()).toBeTruthy();

    const calAfter2 = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(calAfter2.ok()).toBeTruthy();
    const calAfter2Json = await calAfter2.json();
    const itemsAfter2 = (calAfter2Json.data?.items ?? []) as any[];
    expect(itemsAfter2.filter((i: any) => i.origin === 'STRAVA' && String(i.sourceActivityId) === '999')).toHaveLength(1);

    const createdItem = itemsAfter2.find((i: any) => i.origin === 'STRAVA' && String(i.sourceActivityId) === '999');
    expect(createdItem?.id, 'Expected Strava-created calendar item to have an id').toBeTruthy();
    const itemId = String(createdItem.id);

    // Delete from athlete workout detail UI.
    await setRoleCookie(page, 'ATHLETE');
    await page.goto(`/athlete/workouts/${itemId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: /PW Unscheduled Strength/ })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete workout?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete workout' }).click();
    await expect(page.getByTestId('athlete-workout-toast')).toContainText('Workout deleted');

    // Athlete calendar should not include it.
    const calAfterDelete = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(calAfterDelete.ok()).toBeTruthy();
    const calAfterDeleteJson = await calAfterDelete.json();
    const titlesAfterDelete = (calAfterDeleteJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesAfterDelete.some((t: string) => t.includes('PW Unscheduled Strength'))).toBeFalsy();

    // Coach calendar should not include it.
    const coachCookieHeader = { Cookie: 'coachkit-role=COACH' };
    const coachCal = await request.get(
      `/api/coach/calendar?athleteId=dev-athlete&from=${from}&to=${to}&_=${Date.now()}`,
      { headers: coachCookieHeader }
    );
    expect(coachCal.ok()).toBeTruthy();
    const coachCalJson = await coachCal.json();
    const coachTitles = (coachCalJson.data?.items ?? []).map((i: any) => i.title);
    expect(coachTitles.some((t: string) => t.includes('PW Unscheduled Strength'))).toBeFalsy();

    // Detail API should now 404.
    const detailAfterDelete = await request.get(`/api/athlete/calendar-items/${itemId}?_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(detailAfterDelete.status()).toBe(404);

    // Cron runs again, but tombstone must prevent resurrection.
    const cronAfterDelete = await request.post('/api/integrations/strava/cron?mode=intents&athleteId=dev-athlete&forceDays=1', {
      headers: {
        'x-cron-secret': `${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cronAfterDelete.ok()).toBeTruthy();

    const calAfterCron = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`,
      { headers: cookieHeader }
    );
    expect(calAfterCron.ok()).toBeTruthy();
    const calAfterCronJson = await calAfterCron.json();
    const titlesAfterCron = (calAfterCronJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesAfterCron.some((t: string) => t.includes('PW Unscheduled Strength'))).toBeFalsy();

    // Direct navigation to detail should show the not-found message (API is 404).
    await page.goto(`/athlete/workouts/${itemId}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/Workout not found/i)).toBeVisible();
  });
});
