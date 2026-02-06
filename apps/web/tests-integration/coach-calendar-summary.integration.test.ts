import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getRangeCompletionSummary } from '@/lib/calendar/completion';

describe('coach calendar summary totals', () => {
  const athleteId = 'coach-summary-athlete';
  const coachId = 'coach-summary-coach';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'coach-calendar-summary@example.test',
        name: 'Coach Summary',
        timezone: 'Australia/Brisbane',
        authProviderId: 'coach-calendar-summary-test',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'coach-calendar-athlete@example.test',
        name: 'Coach Summary Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'coach-calendar-athlete-test',
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
        plannedStartTimeLocal: '05:30',
        discipline: 'RUN',
        title: '10km Run',
        status: 'COMPLETED_MANUAL',
        plannedDurationMinutes: 60,
      },
    });

    await prisma.completedActivity.create({
      data: {
        calendarItemId: calendarItem.id,
        athleteId,
        source: 'MANUAL',
        startTime: new Date('2026-02-05T05:30:00.000Z'),
        durationMinutes: 52,
        distanceKm: 10,
        painFlag: false,
      },
    });

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'coach-calendar-summary@example.test',
            name: 'Coach Summary',
            timezone: 'Australia/Brisbane',
            authProviderId: 'coach-calendar-summary-test',
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

  it('returns week summary totals for a completed athlete item', async () => {
    const { GET } = await import('@/app/api/coach/calendar/route');

    const req = new NextRequest(
      `http://localhost/api/coach/calendar?athleteId=${athleteId}&from=2026-02-02&to=2026-02-08`
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    const items = json.data?.items ?? [];

    const summary = getRangeCompletionSummary({
      items,
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    expect(summary.workoutCount).toBe(1);
    expect(summary.totals.durationMinutes).toBe(52);
    expect(summary.totals.distanceKm).toBe(10);
  });
});
