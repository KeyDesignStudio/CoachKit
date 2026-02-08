import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('calendar parity between athlete and coach', () => {
  const athleteId = 'calendar-parity-athlete';
  const coachId = 'calendar-parity-coach';
  let calendarItemId: string;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'calendar-parity-coach@example.test',
        name: 'Calendar Parity Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-parity-coach',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'calendar-parity-athlete@example.test',
        name: 'Calendar Parity Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-parity-athlete',
      },
    });

    await prisma.athleteProfile.create({
      data: {
        userId: athleteId,
        coachId,
        defaultLat: -27.4698,
        defaultLon: 153.0251,
      },
    });

    const calendarItem = await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: new Date('2026-02-05T00:00:00.000Z'),
        plannedStartTimeLocal: '23:30',
        discipline: 'RUN',
        title: 'Late Run',
        status: 'COMPLETED_SYNCED',
        plannedDurationMinutes: 60,
      },
    });

    calendarItemId = calendarItem.id;

    await prisma.completedActivity.create({
      data: {
        calendarItemId: calendarItem.id,
        athleteId,
        source: 'STRAVA',
        startTime: new Date('2026-02-05T13:30:00.000Z'),
        durationMinutes: 58,
        distanceKm: 12.3,
        painFlag: false,
        matchDayDiff: 1,
        metricsJson: {
          strava: {
            startDateUtc: '2026-02-05T13:30:00.000Z',
            startDateLocal: '2026-02-05T23:30:00.000Z',
          },
        },
      },
    });

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireAthlete: async () => ({
          user: {
            id: athleteId,
            role: UserRole.ATHLETE,
            email: 'calendar-parity-athlete@example.test',
            name: 'Calendar Parity Athlete',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-parity-athlete',
          },
        }),
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'calendar-parity-coach@example.test',
            name: 'Calendar Parity Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-parity-coach',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.completedActivity.deleteMany({ where: { athleteId } });
    await prisma.calendarItem.deleteMany({ where: { athleteId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('returns the same local day key for completion-adjusted items', async () => {
    const { GET: athleteGet } = await import('@/app/api/athlete/calendar/route');
    const { GET: coachGet } = await import('@/app/api/coach/calendar/route');

    const athleteReq = new NextRequest('http://localhost/api/athlete/calendar?from=2026-02-05&to=2026-02-06');
    const coachReq = new NextRequest(
      `http://localhost/api/coach/calendar?athleteId=${athleteId}&from=2026-02-05&to=2026-02-06`
    );

    const [athleteRes, coachRes] = await Promise.all([athleteGet(athleteReq), coachGet(coachReq)]);
    expect(athleteRes.status).toBe(200);
    expect(coachRes.status).toBe(200);

    const athleteJson = await athleteRes.json();
    const coachJson = await coachRes.json();

    const athleteItem = (athleteJson.data?.items ?? []).find((item: any) => item.id === calendarItemId);
    const coachItem = (coachJson.data?.items ?? []).find((item: any) => item.id === calendarItemId);

    expect(athleteItem).toBeTruthy();
    expect(coachItem).toBeTruthy();
    expect(athleteItem?.date).toBe('2026-02-06');
    expect(coachItem?.date).toBe('2026-02-06');
  });
});
