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

function dayKeyUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

test.describe('Strava autosync matching (deterministic)', () => {
  test('Fuzzy matching links planned sessions, ambiguous cases stay unplanned, idempotent, midnight boundary handled', async ({ page, request }, testInfo) => {
    // This test mutates shared DB state; run it once to avoid cross-project interference.
    if (testInfo.project.name !== 'iphone16pro') test.skip();

    // Seed fixtures + planned sessions.
    const fixtures = await request.post('/api/dev/strava/test-fixtures', {
      data: {
        seed: 'matching',
        disciplines: ['RUN', 'STRENGTH', 'OTHER'],
      },
    });
    expect(fixtures.ok()).toBeTruthy();

    // Run cron to ingest STRAVA_STUB activities.
    const cron = await request.post('/api/integrations/strava/cron?mode=intents&athleteId=dev-athlete&forceDays=2', {
      headers: {
        'x-cron-secret': `${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron.ok()).toBeTruthy();

    const now = new Date();
    const from = dayKeyUtc(new Date(now.getTime() - 2 * 24 * 60 * 60_000));
    const to = dayKeyUtc(new Date(now.getTime() + 2 * 24 * 60 * 60_000));
    const cookieHeader = { Cookie: 'coachkit-role=ATHLETE' };

    const cal = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(cal.ok()).toBeTruthy();
    const calJson = await cal.json();
    const items = (calJson.data?.items ?? []) as any[];

    // No planned: 999 should always create an unplanned STRAVA item.
    const unplanned999 = items.find((i) => i.origin === 'STRAVA' && i.sourceActivityId === '999');
    expect(unplanned999?.title).toContain('PW Unscheduled Strength');

    // Time shift match: activity 1000 (06:20) should link to planned 06:00 run.
    const plannedRun0600 = items.find((i) => i.title === 'PW Planned Run 0600');
    expect(plannedRun0600?.status).toBe('COMPLETED_SYNCED_DRAFT');
    expect(plannedRun0600?.latestCompletedActivity?.source).toBe('STRAVA');
    expect(items.some((i) => i.origin === 'STRAVA' && i.sourceActivityId === '1000')).toBeFalsy();

    // Discipline fuzzy match: activity 1001 is Workout -> STRENGTH, should link to planned strength.
    const plannedStrength1400 = items.find((i) => i.title === 'PW Planned Strength 1400');
    expect(plannedStrength1400?.status).toBe('COMPLETED_SYNCED_DRAFT');
    expect(plannedStrength1400?.latestCompletedActivity?.source).toBe('STRAVA');
    expect(items.some((i) => i.origin === 'STRAVA' && i.sourceActivityId === '1001')).toBeFalsy();

    // Ambiguous: activity 1002 (08:05) between 08:00 and 08:10 should NOT auto-link.
    expect(items.some((i) => i.origin === 'STRAVA' && i.sourceActivityId === '1002')).toBeTruthy();

    const plannedA = items.find((i) => i.title === 'PW Planned Run 0800 A');
    const plannedB = items.find((i) => i.title === 'PW Planned Run 0810 B');
    expect(plannedA?.status).toBe('PLANNED');
    expect(plannedB?.status).toBe('PLANNED');

    // Midnight boundary: activity 1003 at 00:10 tomorrow should link to planned 23:50 today.
    const planned2350 = items.find((i) => i.title === 'PW Planned Run 2350');
    expect(planned2350?.status).toBe('COMPLETED_SYNCED_DRAFT');
    expect(planned2350?.latestCompletedActivity?.source).toBe('STRAVA');
    expect(items.some((i) => i.origin === 'STRAVA' && i.sourceActivityId === '1003')).toBeFalsy();

    // Idempotency: re-run cron and ensure no duplicates for unplanned items.
    const cron2 = await request.post('/api/integrations/strava/cron?mode=intents&athleteId=dev-athlete&forceDays=2', {
      headers: {
        'x-cron-secret': `${process.env.CRON_SECRET ?? 'playwright-cron-secret'}`,
      },
      data: {},
    });
    expect(cron2.ok()).toBeTruthy();

    const cal2 = await request.get(`/api/athlete/calendar?from=${from}&to=${to}&_=${Date.now()}`, {
      headers: cookieHeader,
    });
    expect(cal2.ok()).toBeTruthy();
    const cal2Json = await cal2.json();
    const items2 = (cal2Json.data?.items ?? []) as any[];

    const unplanned999Count = items2.filter((i) => i.origin === 'STRAVA' && i.sourceActivityId === '999').length;
    const unplanned1002Count = items2.filter((i) => i.origin === 'STRAVA' && i.sourceActivityId === '1002').length;
    expect(unplanned999Count).toBe(1);
    expect(unplanned1002Count).toBe(1);

    // Quick UI smoke: open one linked planned workout detail.
    await setRoleCookie(page, 'ATHLETE');
    const plannedId = String(plannedRun0600?.id ?? '');
    expect(plannedId).toBeTruthy();
    await page.goto(`/athlete/workouts/${plannedId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: /PW Planned Run 0600/ })).toBeVisible();
  });
});
