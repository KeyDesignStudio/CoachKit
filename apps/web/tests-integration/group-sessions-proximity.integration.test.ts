import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('group session proximity suggestions API', () => {
  const coachId = 'group-session-proximity-coach';
  const athleteNearId = 'group-session-proximity-athlete-near';
  const athleteFarId = 'group-session-proximity-athlete-far';
  const athleteNoCoordsId = 'group-session-proximity-athlete-none';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'group-session-proximity-coach@example.test',
        name: 'Group Session Proximity Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'group-session-proximity-coach-auth',
      },
    });

    await prisma.user.createMany({
      data: [
        {
          id: athleteNearId,
          role: UserRole.ATHLETE,
          email: 'group-session-proximity-athlete-near@example.test',
          name: 'Nearby Athlete',
          timezone: 'Australia/Brisbane',
          authProviderId: 'group-session-proximity-athlete-near-auth',
        },
        {
          id: athleteFarId,
          role: UserRole.ATHLETE,
          email: 'group-session-proximity-athlete-far@example.test',
          name: 'Far Athlete',
          timezone: 'Australia/Brisbane',
          authProviderId: 'group-session-proximity-athlete-far-auth',
        },
        {
          id: athleteNoCoordsId,
          role: UserRole.ATHLETE,
          email: 'group-session-proximity-athlete-none@example.test',
          name: 'No Coords Athlete',
          timezone: 'Australia/Brisbane',
          authProviderId: 'group-session-proximity-athlete-none-auth',
        },
      ],
    });

    await prisma.athleteProfile.createMany({
      data: [
        {
          userId: athleteNearId,
          coachId,
          defaultLat: -27.4698,
          defaultLon: 153.0251,
        },
        {
          userId: athleteFarId,
          coachId,
          defaultLat: -33.8688,
          defaultLon: 151.2093,
        },
        {
          userId: athleteNoCoordsId,
          coachId,
        },
      ],
    });

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'group-session-proximity-coach@example.test',
            name: 'Group Session Proximity Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'group-session-proximity-coach-auth',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.athleteProfile.deleteMany({
      where: {
        userId: {
          in: [athleteNearId, athleteFarId, athleteNoCoordsId],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [athleteNearId, athleteFarId, athleteNoCoordsId, coachId],
        },
      },
    });

    await prisma.$disconnect();
  });

  it('returns only nearby coached athletes sorted by distance', async () => {
    const { GET } = await import('@/app/api/coach/group-sessions/proximity/route');

    const req = new NextRequest(
      'http://localhost/api/coach/group-sessions/proximity?lat=-27.4700&lon=153.0250&radiusKm=20&limit=10'
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    const athletes = json.data.athletes as Array<{ athleteId: string; name: string; distanceKm: number }>;

    expect(athletes.length).toBeGreaterThan(0);
    expect(athletes.some((athlete) => athlete.athleteId === athleteNearId)).toBe(true);
    expect(athletes.some((athlete) => athlete.athleteId === athleteFarId)).toBe(false);
    expect(athletes.some((athlete) => athlete.athleteId === athleteNoCoordsId)).toBe(false);
  });

  it('validates query params', async () => {
    const { GET } = await import('@/app/api/coach/group-sessions/proximity/route');

    const req = new NextRequest('http://localhost/api/coach/group-sessions/proximity?lat=999&lon=153.0250');
    const res = await GET(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});
