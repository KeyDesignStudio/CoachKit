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
  test('Unmatched Strava activity surfaces in calendar and is idempotent', async ({ page, request }) => {
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

    // Cron processes pending intents.
    const cron = await request.get('/api/integrations/strava/cron', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
    });
    expect(cron.ok()).toBeTruthy();

    // Verify calendar shows the unscheduled item.
    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });

    const weekView = page.locator('[data-athlete-week-view-version="athlete-week-v2"]');
    const rows = weekView.locator('[data-athlete-week-session-row="v2"]:visible', {
      hasText: 'PW Unscheduled Strength (unscheduled)',
    });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toBeVisible();

    // Running cron again should not create duplicates.
    const cron2 = await request.get('/api/integrations/strava/cron', {
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
    });
    expect(cron2.ok()).toBeTruthy();

    await page.reload({ waitUntil: 'networkidle' });
    const rowsAfter = page
      .locator('[data-athlete-week-view-version="athlete-week-v2"]')
      .locator('[data-athlete-week-session-row="v2"]:visible', { hasText: 'PW Unscheduled Strength (unscheduled)' });
    await expect(rowsAfter).toHaveCount(1);
  });
});
