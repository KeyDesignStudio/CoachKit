import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('calendar coach/athlete parity for planned placement', () => {
  const athleteId = 'calendar-parity-planned-athlete';
  const coachId = 'calendar-parity-planned-coach';
  let calendarItemId: string;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'calendar-parity-planned-coach@example.test',
        name: 'Parity Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-parity-planned-coach',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'calendar-parity-planned-athlete@example.test',
        name: 'Parity Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-parity-planned-athlete',
      },
    });

    await prisma.athleteProfile.create({
      data: {
        userId: athleteId,
        coachId,
      },
    });

    const calendarItem = await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: new Date('2026-02-13T00:00:00.000Z'),
        plannedStartTimeLocal: '17:00',
        discipline: 'RUN',
        title: 'Parity run',
        status: 'PLANNED',
      },
    });

    calendarItemId = calendarItem.id;

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireAthlete: async () => ({
          user: {
            id: athleteId,
            role: UserRole.ATHLETE,
            email: 'calendar-parity-planned-athlete@example.test',
            name: 'Parity Athlete',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-parity-planned-athlete',
          },
        }),
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'calendar-parity-planned-coach@example.test',
            name: 'Parity Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-parity-planned-coach',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.calendarItem.deleteMany({ where: { athleteId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('returns the same local day key for planned items', async () => {
    const { GET: athleteGet } = await import('@/app/api/athlete/calendar/route');
    const { GET: coachGet } = await import('@/app/api/coach/calendar/route');

    const athleteReq = new NextRequest('http://localhost/api/athlete/calendar?from=2026-02-13&to=2026-02-14');
    const coachReq = new NextRequest(
      `http://localhost/api/coach/calendar?athleteId=${athleteId}&from=2026-02-13&to=2026-02-14`
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
    expect(athleteItem?.date).toBe('2026-02-13');
    expect(coachItem?.date).toBe('2026-02-13');
  });
});
