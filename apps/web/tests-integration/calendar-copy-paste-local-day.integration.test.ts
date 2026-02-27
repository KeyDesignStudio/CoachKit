import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('calendar copy/paste local-day placement', () => {
  const athleteId = 'calendar-copy-paste-athlete';
  const coachId = 'calendar-copy-paste-coach';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'calendar-copy-paste-coach@example.test',
        name: 'Copy Paste Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-copy-paste-coach',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'calendar-copy-paste-athlete@example.test',
        name: 'Copy Paste Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-copy-paste-athlete',
      },
    });

    await prisma.athleteProfile.create({
      data: {
        userId: athleteId,
        coachId,
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
            email: 'calendar-copy-paste-coach@example.test',
            name: 'Copy Paste Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-copy-paste-coach',
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

  it('keeps pasted sessions on the target local day', async () => {
    const { POST } = await import('@/app/api/coach/calendar-items/route');
    const { GET } = await import('@/app/api/coach/calendar/route');

    const basePayload = {
      athleteId,
      plannedStartTimeLocal: '17:00',
      discipline: 'RUN',
      title: 'Evening run',
    };

    const createItem = async (date: string) => {
      const req = new NextRequest('http://localhost/api/coach/calendar-items', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, date }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      return json.data.item as { id: string; date: string };
    };

    const original = await createItem('2026-02-13');
    const pastedOneDayEarlier = await createItem('2026-02-12');
    const pastedTwoDaysEarlier = await createItem('2026-02-11');

    const listReq = new NextRequest(
      `http://localhost/api/coach/calendar?athleteId=${athleteId}&from=2026-02-10&to=2026-02-13`
    );
    const listRes = await GET(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const items = (listJson.data?.items ?? []) as Array<{ id: string; date: string }>;
    const lookup = new Map<string, { id: string; date: string }>(items.map((item) => [item.id, item]));

    expect(lookup.get(original.id)?.date).toBe('2026-02-13');
    expect(lookup.get(pastedOneDayEarlier.id)?.date).toBe('2026-02-12');
    expect(lookup.get(pastedTwoDaysEarlier.id)?.date).toBe('2026-02-11');
  });
});
