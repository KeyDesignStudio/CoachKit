import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('athlete dashboard calories', () => {
  const athleteId = 'athlete-dashboard-calories';
  const coachId = 'coach-dashboard-calories';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'coach-dashboard-calories@example.test',
        name: 'Calories Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'coach-dashboard-calories-test',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'athlete-dashboard-calories@example.test',
        name: 'Calories Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'athlete-dashboard-calories-test',
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
        plannedStartTimeLocal: '06:00',
        discipline: 'RUN',
        title: 'Tempo Run',
        status: 'COMPLETED_SYNCED',
        plannedDurationMinutes: 50,
      },
    });

    await prisma.completedActivity.create({
      data: {
        calendarItemId: calendarItem.id,
        athleteId,
        source: 'STRAVA',
        startTime: new Date('2026-02-05T06:00:00.000Z'),
        durationMinutes: 48,
        distanceKm: 9.5,
        painFlag: false,
        confirmedAt: new Date('2026-02-05T07:00:00.000Z'),
        metricsJson: {
          strava: {
            calories: 480,
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
            email: 'athlete-dashboard-calories@example.test',
            name: 'Calories Athlete',
            timezone: 'Australia/Brisbane',
            authProviderId: 'athlete-dashboard-calories-test',
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

  it('returns non-zero calories for completed activity', async () => {
    const { GET } = await import('@/app/api/athlete/dashboard/console/route');

    const req = new NextRequest('http://localhost/api/athlete/dashboard/console?from=2026-02-02&to=2026-02-08');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    const summary = json.data?.rangeSummary;

    expect(summary?.totals?.completedCaloriesKcal).toBeGreaterThan(0);
    const caloriesByDay = summary?.caloriesByDay ?? [];
    expect(caloriesByDay.some((row: any) => row.completedCaloriesKcal > 0)).toBe(true);
    expect(caloriesByDay.some((row: any) => row.sessions?.length > 0)).toBe(true);
  });
});
