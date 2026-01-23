import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

test.describe('Athlete iCal sync (private subscription)', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('token auth + ICS formatting sanity + excludes deleted', async ({ request }) => {
    // Ensure dev users + athlete profile exist (auth disabled uses role cookie to pick these).
    await prisma.user.upsert({
      where: { id: 'dev-coach' },
      update: { role: 'COACH' },
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
      update: { role: 'ATHLETE', timezone: 'Australia/Brisbane' },
      create: {
        id: 'dev-athlete',
        email: 'dev-athlete@local',
        role: 'ATHLETE',
        timezone: 'Australia/Brisbane',
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

    const unique = crypto.randomUUID();
    const date = new Date('2026-01-23T00:00:00.000Z');

    const planned = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date,
        plannedStartTimeLocal: '06:30',
        plannedDurationMinutes: 45,
        origin: 'PLAYWRIGHT',
        sourceActivityId: `pw-${unique}-planned`,
        discipline: 'RUN',
        title: 'Easy Run',
        status: 'PLANNED',
      },
      select: { id: true },
    });

    const deleted = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date,
        plannedStartTimeLocal: '07:30',
        plannedDurationMinutes: 30,
        origin: 'PLAYWRIGHT',
        sourceActivityId: `pw-${unique}-deleted`,
        discipline: 'BIKE',
        title: 'Deleted Ride',
        status: 'PLANNED',
        deletedAt: new Date(),
        deletedByUserId: 'dev-coach',
      },
      select: { id: true },
    });

    // Unscheduled imported-style completed item.
    const completed = await prisma.calendarItem.create({
      data: {
        athleteId: 'dev-athlete',
        coachId: 'dev-coach',
        date,
        plannedStartTimeLocal: null,
        plannedDurationMinutes: null,
        origin: 'STRAVA',
        sourceActivityId: `pw-${unique}-strava`,
        discipline: 'BIKE',
        title: 'Synced Ride',
        status: 'COMPLETED_SYNCED',
      },
      select: { id: true },
    });

    await prisma.completedActivity.create({
      data: {
        athleteId: 'dev-athlete',
        calendarItemId: completed.id,
        source: 'STRAVA',
        externalProvider: 'STRAVA',
        externalActivityId: `pw-${unique}-activity`,
        startTime: new Date('2026-01-23T10:00:00.000Z'),
        durationMinutes: 60,
        distanceKm: 40,
      },
      select: { id: true },
    });

    // Missing token should 401.
    const noToken = await request.get('/api/athlete/calendar.ics');
    expect(noToken.status()).toBe(401);

    // Invalid token should 401.
    const badToken = await request.get('/api/athlete/calendar.ics?token=not-a-real-token');
    expect(badToken.status()).toBe(401);

    // Fetch tokenized subscription link (authenticated via role cookie when auth is disabled).
    const linkRes = await request.get('/api/athlete/ical-link', {
      headers: { Cookie: 'coachkit-role=ATHLETE' },
    });

    expect(linkRes.ok()).toBeTruthy();
    const linkJson = (await linkRes.json()) as { data: { url: string }; error: null };
    const url = linkJson.data.url;
    expect(url).toContain('/api/athlete/calendar.ics?token=');

    // Public feed should be accessible without cookies.
    const icsRes = await request.get(url);
    expect(icsRes.status()).toBe(200);

    const contentType = icsRes.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/calendar');

    const body = await icsRes.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');

    // Stable UIDs.
    expect(body).toContain(`UID:coachkit-${planned.id}@coachkit`);
    expect(body).toContain(`UID:coachkit-${completed.id}@coachkit`);

    // Deleted item must not appear.
    expect(body).not.toContain(`UID:coachkit-${deleted.id}@coachkit`);

    // Should include at least one VEVENT when workouts exist.
    expect(body).toContain('BEGIN:VEVENT');
  });
});
