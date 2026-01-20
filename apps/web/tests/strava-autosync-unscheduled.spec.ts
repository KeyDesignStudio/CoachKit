import { test, expect } from '@playwright/test';

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

test.describe('Strava autosync (debounced)', () => {
  test('Unmatched Strava activity surfaces in calendar and is idempotent', async ({ page, request }, testInfo) => {
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

    // Webhook is intent-only; calendar should NOT show the item until cron runs.
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });

    const weekView = page.locator('[data-athlete-week-view-version="athlete-week-v2"]');
    const rows = weekView.locator('[data-athlete-week-session-row="v2"]:visible', {
      hasText: 'PW Unscheduled Strength (unscheduled)',
    });

    await expect(rows).toHaveCount(0);

    // Backfill endpoint should surface it and remain idempotent (safety net).
    const cron2 = await request.post('/api/integrations/strava/cron?forceDays=2', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron2.ok()).toBeTruthy();

    await page.reload({ waitUntil: 'networkidle' });
    const rowsAfter = page
      .locator('[data-athlete-week-view-version="athlete-week-v2"]')
      .locator('[data-athlete-week-session-row="v2"]:visible', { hasText: 'PW Unscheduled Strength (unscheduled)' });
    await expect(rowsAfter).toHaveCount(1);

    // Repeat cron; should not duplicate.
    const cron3 = await request.post('/api/integrations/strava/cron?forceDays=2', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron3.ok()).toBeTruthy();

    await page.reload({ waitUntil: 'networkidle' });
    const rowsAfter2 = page
      .locator('[data-athlete-week-view-version="athlete-week-v2"]')
      .locator('[data-athlete-week-session-row="v2"]:visible', { hasText: 'PW Unscheduled Strength (unscheduled)' });
    await expect(rowsAfter2).toHaveCount(1);
  });
});
