import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('calendar edit local-day placement', () => {
  const athleteId = 'calendar-edit-athlete';
  const coachId = 'calendar-edit-coach';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'calendar-edit-coach@example.test',
        name: 'Edit Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-edit-coach',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'calendar-edit-athlete@example.test',
        name: 'Edit Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'calendar-edit-athlete',
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
            email: 'calendar-edit-coach@example.test',
            name: 'Edit Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'calendar-edit-coach',
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

  it('keeps edits anchored to the requested local day', async () => {
    const { POST } = await import('@/app/api/coach/calendar-items/route');
    const { PATCH } = await import('@/app/api/coach/calendar-items/[itemId]/route');
    const { GET } = await import('@/app/api/coach/calendar/route');

    const createItem = async (date: string, plannedStartTimeLocal: string) => {
      const req = new NextRequest('http://localhost/api/coach/calendar-items', {
        method: 'POST',
        body: JSON.stringify({
          athleteId,
          date,
          plannedStartTimeLocal,
          discipline: 'RUN',
          title: 'Editable session',
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      return json.data.item as { id: string };
    };

    const dateOnlyItem = await createItem('2026-02-13', '17:00');
    const timeOnlyItem = await createItem('2026-02-14', '05:30');

    const patchDateReq = new NextRequest(`http://localhost/api/coach/calendar-items/${dateOnlyItem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-02-12' }),
      headers: { 'content-type': 'application/json' },
    });
    const patchDateRes = await PATCH(patchDateReq, { params: { itemId: dateOnlyItem.id } });
    expect(patchDateRes.status).toBe(200);

    const patchTimeReq = new NextRequest(`http://localhost/api/coach/calendar-items/${timeOnlyItem.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ plannedStartTimeLocal: '17:00' }),
      headers: { 'content-type': 'application/json' },
    });
    const patchTimeRes = await PATCH(patchTimeReq, { params: { itemId: timeOnlyItem.id } });
    expect(patchTimeRes.status).toBe(200);

    const listReq = new NextRequest(
      `http://localhost/api/coach/calendar?athleteId=${athleteId}&from=2026-02-11&to=2026-02-14`
    );
    const listRes = await GET(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const items = (listJson.data?.items ?? []) as Array<{ id: string; date: string }>;
    const lookup = new Map<string, { id: string; date: string }>(items.map((item) => [item.id, item]));

    expect(lookup.get(dateOnlyItem.id)?.date).toBe('2026-02-12');
    expect(lookup.get(timeOnlyItem.id)?.date).toBe('2026-02-14');
  });
});
