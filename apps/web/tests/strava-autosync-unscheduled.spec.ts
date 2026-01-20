import { test, expect } from '@playwright/test';

function dayKeyUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

test.describe('Strava autosync (debounced)', () => {
  test('Unmatched Strava activity surfaces in calendar and is idempotent', async ({ request }, testInfo) => {
    // This test mutates shared DB state; run it once to avoid cross-project interference.
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    // Ensure dev fixtures exist (coach+athlete+athleteProfile+stravaConnection).
    const fixtures = await request.post('/api/dev/strava/test-fixtures');
    expect(fixtures.ok()).toBeTruthy();

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
    const titlesBefore = (calBeforeJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesBefore.some((t: string) => t.includes('PW Unscheduled Strength'))).toBeFalsy();

    // Backfill endpoint should surface it and remain idempotent (safety net).
    const cron2 = await request.post('/api/integrations/strava/cron?athleteId=dev-athlete&forceDays=2', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
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
    const titlesAfter = (calAfterJson.data?.items ?? []).map((i: any) => i.title);
    expect(titlesAfter.some((t: string) => t.includes('PW Unscheduled Strength'))).toBeTruthy();

    // Repeat cron; should not duplicate.
    const cron3 = await request.post('/api/integrations/strava/cron?athleteId=dev-athlete&forceDays=2', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron3.ok()).toBeTruthy();

    const calAfter2 = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(calAfter2.ok()).toBeTruthy();
    const calAfter2Json = await calAfter2.json();
    const titlesAfter2 = (calAfter2Json.data?.items ?? []).map((i: any) => i.title);
    expect(titlesAfter2.filter((t: string) => t.includes('PW Unscheduled Strength'))).toHaveLength(1);
  });
});
