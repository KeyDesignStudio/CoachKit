import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

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

function startOfWeekUtcMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

test.describe('Strava calories', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('Workout detail shows Strava calories (draft or confirmed)', async ({ page }) => {
    const unique = crypto.randomUUID();

    // Ensure dev users exist (auth disabled uses these IDs).
    await prisma.user.upsert({
      where: { id: 'dev-coach' },
      update: { role: 'COACH', timezone: 'UTC' },
      create: {
        id: 'dev-coach',
        email: 'dev-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        authProviderId: 'dev-coach',
      },
    });

    await prisma.user.upsert({
      where: { id: 'dev-athlete' },
      update: { role: 'ATHLETE', timezone: 'UTC' },
      create: {
        id: 'dev-athlete',
        email: 'dev-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        authProviderId: 'dev-athlete',
      },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: 'dev-athlete' },
      update: { coachId: 'dev-coach', disciplines: ['RUN'] },
      create: {
        userId: 'dev-athlete',
        coachId: 'dev-coach',
        disciplines: ['RUN'],
      },
    });

    // Fix for parallel execution: shift weeks by workerIndex away from "current week"
    // to avoid collision with unshifted tests. (+70 days minimum)
    const weekStart = startOfWeekUtcMonday(new Date());
    weekStart.setUTCDate(weekStart.getUTCDate() + ((test.info().workerIndex + 1) * 70));
    const monday = weekStart;
    const sunday = new Date(weekStart);
    sunday.setUTCDate(sunday.getUTCDate() + 6);

    // Keep the DB tidy between runs for this fixture.
    await prisma.calendarItem.deleteMany({
      where: {
        athleteId: 'dev-athlete',
        origin: 'PLAYWRIGHT_STRAVA_CALORIES',
        date: {
          gte: monday,
          lte: sunday,
        },
      },
    });

    const draftItem = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date: monday,
        plannedStartTimeLocal: '06:30',
        plannedDurationMinutes: 45,
        plannedDistanceKm: 8,
        origin: 'PLAYWRIGHT_STRAVA_CALORIES',
        sourceActivityId: `pw-${unique}-draft`,
        discipline: 'RUN',
        title: 'Draft Strava Run',
        workoutDetail: 'Seeded workout for Strava calories test.',
        status: 'COMPLETED_SYNCED_DRAFT',
        actionAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.completedActivity.create({
      data: {
        athleteId: 'dev-athlete',
        calendarItemId: draftItem.id,
        source: 'STRAVA',
        externalProvider: 'STRAVA',
        externalActivityId: `pw-${unique}-draft-activity`,
        startTime: new Date(monday.getTime() + 6 * 60 * 60 * 1000),
        durationMinutes: 45,
        distanceKm: 8,
        painFlag: false,
        confirmedAt: null,
        metricsJson: {
          strava: {
            startDateUtc: new Date(monday.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            caloriesKcal: 400,
          },
        },
      },
      select: { id: true },
    });

    await setRoleCookie(page, 'ATHLETE');
    await page.goto(`/athlete/workouts/${draftItem.id}`, { waitUntil: 'networkidle' });

    const stravaCard = page.locator('[data-athlete-workout-quadrant="strava"]');
    await expect(stravaCard).toBeVisible();
    await expect(stravaCard).toContainText('Calories');
    await expect(stravaCard).toContainText('400 kcal');
  });

  test('Weekly summary calories count confirmed-only (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iPad (gen 7)', 'Weekly summary column is desktop-only (md+).');

    const unique = crypto.randomUUID();

    await prisma.user.upsert({
      where: { id: 'dev-coach' },
      update: { role: 'COACH', timezone: 'UTC' },
      create: {
        id: 'dev-coach',
        email: 'dev-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        authProviderId: 'dev-coach',
      },
    });

    await prisma.user.upsert({
      where: { id: 'dev-athlete' },
      update: { role: 'ATHLETE', timezone: 'UTC' },
      create: {
        id: 'dev-athlete',
        email: 'dev-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        authProviderId: 'dev-athlete',
      },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: 'dev-athlete' },
      update: { coachId: 'dev-coach', disciplines: ['RUN'] },
      create: {
        userId: 'dev-athlete',
        coachId: 'dev-coach',
        disciplines: ['RUN'],
      },
    });

    const weekStart = startOfWeekUtcMonday(new Date());
    const monday = weekStart;
    const tuesday = new Date(weekStart);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    const sunday = new Date(weekStart);
    sunday.setUTCDate(sunday.getUTCDate() + 6);

    // Clean up prior fixtures for this run.
    await prisma.calendarItem.deleteMany({
      where: {
        athleteId: 'dev-athlete',
        origin: 'PLAYWRIGHT_STRAVA_CALORIES',
        date: {
          gte: monday,
          lte: sunday,
        },
      },
    });

    const draftItem = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date: monday,
        plannedStartTimeLocal: '06:30',
        plannedDurationMinutes: 45,
        plannedDistanceKm: 8,
        origin: 'PLAYWRIGHT_STRAVA_CALORIES',
        sourceActivityId: `pw-${unique}-draft`,
        discipline: 'RUN',
        title: 'Draft Strava Run',
        status: 'COMPLETED_SYNCED_DRAFT',
        actionAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.completedActivity.create({
      data: {
        athleteId: 'dev-athlete',
        calendarItemId: draftItem.id,
        source: 'STRAVA',
        externalProvider: 'STRAVA',
        externalActivityId: `pw-${unique}-draft-activity`,
        startTime: new Date(monday.getTime() + 6 * 60 * 60 * 1000),
        durationMinutes: 45,
        distanceKm: 8,
        painFlag: false,
        confirmedAt: null,
        metricsJson: {
          strava: {
            startDateUtc: new Date(monday.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            caloriesKcal: 400,
          },
        },
      },
      select: { id: true },
    });

    const confirmedItem = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date: tuesday,
        plannedStartTimeLocal: '06:30',
        plannedDurationMinutes: 50,
        plannedDistanceKm: 10,
        origin: 'PLAYWRIGHT_STRAVA_CALORIES',
        sourceActivityId: `pw-${unique}-confirmed`,
        discipline: 'RUN',
        title: 'Confirmed Strava Run',
        status: 'COMPLETED_SYNCED',
        actionAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.completedActivity.create({
      data: {
        athleteId: 'dev-athlete',
        calendarItemId: confirmedItem.id,
        source: 'STRAVA',
        externalProvider: 'STRAVA',
        externalActivityId: `pw-${unique}-confirmed-activity`,
        startTime: new Date(tuesday.getTime() + 6 * 60 * 60 * 1000),
        durationMinutes: 50,
        distanceKm: 10,
        painFlag: false,
        confirmedAt: new Date(),
        metricsJson: {
          strava: {
            startDateUtc: new Date(tuesday.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            caloriesKcal: 500,
          },
        },
      },
      select: { id: true },
    });

    await setRoleCookie(page, 'ATHLETE');
    await page.goto('/athlete/calendar', { waitUntil: 'networkidle' });
    await expect(page.locator('h1', { hasText: 'Weekly Calendar' })).toBeVisible();

    // Confirmed-only behavior: draft 400 kcal excluded, confirmed 500 kcal included.
    const calories500 = page.getByText('Calories: 500 kcal', { exact: true });
    const anyVisible = await calories500.evaluateAll((els) =>
      els.some((el) => {
        const e = el as HTMLElement;
        const style = window.getComputedStyle(e);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.opacity === '0') return false;
        return e.getClientRects().length > 0;
      })
    );
    expect(anyVisible, 'Expected Calories: 500 kcal to be visible somewhere on the page').toBeTruthy();
    await expect(page.getByText('Calories: 900 kcal', { exact: true })).toHaveCount(0);
  });
});
