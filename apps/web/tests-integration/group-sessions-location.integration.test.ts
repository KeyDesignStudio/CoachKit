import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('group sessions location coordinates', () => {
  const coachId = 'group-sessions-location-coach';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'group-sessions-location-coach@example.test',
        name: 'Group Sessions Location Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'group-sessions-location-coach-test',
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
            email: 'group-sessions-location-coach@example.test',
            name: 'Group Sessions Location Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'group-sessions-location-coach-test',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.groupSessionTarget.deleteMany({
      where: { groupSession: { coachId } },
    });
    await prisma.groupSession.deleteMany({ where: { coachId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('persists locationLat/locationLon on create and update', async () => {
    const { POST } = await import('@/app/api/coach/group-sessions/route');
    const detailRoute = await import('@/app/api/coach/group-sessions/[groupSessionId]/route');

    const createReq = new NextRequest('http://localhost/api/coach/group-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Track intervals',
        discipline: 'RUN',
        location: 'Sydney Olympic Park, NSW, AU',
        locationLat: -33.8472,
        locationLon: 151.0633,
        startTimeLocal: '06:00',
        durationMinutes: 60,
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU,TH',
        visibilityType: 'ALL',
      }),
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.data.groupSession.locationLat).toBeCloseTo(-33.8472, 4);
    expect(createJson.data.groupSession.locationLon).toBeCloseTo(151.0633, 4);

    const id = createJson.data.groupSession.id as string;
    const patchReq = new NextRequest(`http://localhost/api/coach/group-sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locationLat: -27.4698,
        locationLon: 153.0251,
      }),
    });
    const patchRes = await detailRoute.PATCH(patchReq, { params: { groupSessionId: id } });
    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json();
    expect(patchJson.data.groupSession.locationLat).toBeCloseTo(-27.4698, 4);
    expect(patchJson.data.groupSession.locationLon).toBeCloseTo(153.0251, 4);
  });

  it('rejects partial coordinate payloads', async () => {
    const { POST } = await import('@/app/api/coach/group-sessions/route');
    const detailRoute = await import('@/app/api/coach/group-sessions/[groupSessionId]/route');

    const createReq = new NextRequest('http://localhost/api/coach/group-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Swim endurance',
        discipline: 'SWIM',
        location: 'Brisbane Aquatic Centre, QLD, AU',
        locationLat: -27.0,
        startTimeLocal: '05:30',
        durationMinutes: 45,
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        visibilityType: 'ALL',
      }),
    });
    const createRes = await POST(createReq);
    expect(createRes.status).toBe(400);
    const createJson = await createRes.json();
    expect(createJson.error.code).toBe('VALIDATION_ERROR');

    const validReq = new NextRequest('http://localhost/api/coach/group-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Ride endurance',
        discipline: 'BIKE',
        startTimeLocal: '05:30',
        durationMinutes: 80,
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=SA',
        visibilityType: 'ALL',
      }),
    });
    const validRes = await POST(validReq);
    expect(validRes.status).toBe(201);
    const validJson = await validRes.json();
    const id = validJson.data.groupSession.id as string;

    const patchReq = new NextRequest(`http://localhost/api/coach/group-sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locationLon: 153.0251,
      }),
    });
    const patchRes = await detailRoute.PATCH(patchReq, { params: { groupSessionId: id } });
    expect(patchRes.status).toBe(400);
    const patchJson = await patchRes.json();
    expect(patchJson.error.code).toBe('VALIDATION_ERROR');
  });
});
