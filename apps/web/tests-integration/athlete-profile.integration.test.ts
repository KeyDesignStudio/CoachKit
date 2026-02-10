import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

describe('athlete profile api', () => {
  const athleteId = 'athlete-profile-test';
  const coachId = 'coach-profile-test';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();

    await prisma.user.create({
      data: {
        id: coachId,
        role: UserRole.COACH,
        email: 'coach-profile@example.test',
        name: 'Profile Coach',
        timezone: 'Australia/Brisbane',
        authProviderId: 'coach-profile-test',
      },
    });

    await prisma.user.create({
      data: {
        id: athleteId,
        role: UserRole.ATHLETE,
        email: 'athlete-profile@example.test',
        name: 'Profile Athlete',
        timezone: 'Australia/Brisbane',
        authProviderId: 'athlete-profile-test',
      },
    });

    await prisma.athleteProfile.create({
      data: {
        userId: athleteId,
        coachId,
        disciplines: ['RUN'],
        defaultLat: -27.4698,
        defaultLon: 153.0251,
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
            email: 'athlete-profile@example.test',
            name: 'Profile Athlete',
            timezone: 'Australia/Brisbane',
            authProviderId: 'athlete-profile-test',
          },
        }),
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'coach-profile@example.test',
            name: 'Profile Coach',
            timezone: 'Australia/Brisbane',
            authProviderId: 'coach-profile-test',
          },
        }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.athleteBrief.deleteMany({ where: { athleteId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('returns the athlete profile', async () => {
    const { GET } = await import('@/app/api/athlete/profile/route');

    const req = new NextRequest('http://localhost/api/athlete/profile');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data?.athlete?.userId).toBe(athleteId);
    expect(json.data?.athlete?.user?.email).toBe('athlete-profile@example.test');
  });

  it('updates the athlete profile with normalized fields', async () => {
    const { PATCH } = await import('@/app/api/athlete/profile/route');

    const req = new NextRequest('http://localhost/api/athlete/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: 'Ava',
        lastName: 'Runner',
        timezone: 'Australia/Brisbane',
        disciplines: ['RUN', 'BIKE'],
        mobilePhone: '0412 345 678',
        trainingSuburb: 'Brisbane',
        weeklyMinutesTarget: 360,
        runConfidence: 4,
        structurePreference: 3,
        motivationStyle: 'Variety',
        trainingPlanSchedule: {
          frequency: 'WEEKLY',
          dayOfWeek: 2,
        },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    const athlete = json.data?.athlete;

    expect(athlete?.mobilePhone).toBe('+61412345678');
    expect(athlete?.weeklyMinutesTarget).toBe(360);
    expect(athlete?.disciplines).toEqual(['RUN', 'BIKE']);
    expect(athlete?.trainingPlanSchedule?.frequency).toBe('WEEKLY');
  });

  it('keeps athlete and coach profile views in sync', async () => {
    const { PATCH } = await import('@/app/api/athlete/profile/route');
    const { GET } = await import('@/app/api/coach/athletes/[athleteId]/route');

    const patchReq = new NextRequest('http://localhost/api/athlete/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        timezone: 'Australia/Brisbane',
        disciplines: ['RUN'],
        trainingSuburb: 'Newstead',
        weeklyMinutesTarget: 420,
        focus: 'Consistency',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const patchRes = await PATCH(patchReq);
    expect(patchRes.status).toBe(200);

    const coachReq = new NextRequest(`http://localhost/api/coach/athletes/${athleteId}`);
    const coachRes = await GET(coachReq, { params: { athleteId } });
    expect(coachRes.status).toBe(200);

    const coachJson = await coachRes.json();
    const coachAthlete = coachJson.data?.athlete;

    expect(coachAthlete?.trainingSuburb).toBe('Newstead');
    expect(coachAthlete?.weeklyMinutesTarget).toBe(420);
    expect(coachAthlete?.timezone).toBe('Australia/Brisbane');
  });
});
