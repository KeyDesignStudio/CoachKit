import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach } from '@/modules/ai-plan-builder/tests/seed';

describe('Future Self projection flow (run -> snapshot -> athlete visibility)', () => {
  const envSnapshot = {
    FUTURE_SELF_V1: process.env.FUTURE_SELF_V1,
    NEXT_PUBLIC_FUTURE_SELF_V1: process.env.NEXT_PUBLIC_FUTURE_SELF_V1,
  };

  let coachId = '';
  let athleteId = '';

  let authUser: {
    id: string;
    role: UserRole;
    email: string;
    name: string;
    timezone: string;
    authProviderId: string;
  };

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by test harness.').toBeTruthy();
    process.env.FUTURE_SELF_V1 = '1';
    process.env.NEXT_PUBLIC_FUTURE_SELF_V1 = '1';

    const coach = await createCoach();
    const athlete = await createAthlete({ coachId: coach.id });
    coachId = coach.id;
    athleteId = athlete.athlete.id;

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        disciplines: ['RUN', 'BIKE'],
        eventName: '10k Tune-Up',
        eventDate: new Date('2026-06-15T00:00:00.000Z'),
      },
    });

    const calendarItem = await prisma.calendarItem.create({
      data: {
        athleteId,
        coachId,
        date: new Date('2026-02-10T00:00:00.000Z'),
        discipline: 'RUN',
        title: 'Tempo Run',
        status: 'COMPLETED_SYNCED',
      },
      select: { id: true },
    });

    await prisma.completedActivity.createMany({
      data: [
        {
          athleteId,
          calendarItemId: calendarItem.id,
          source: 'STRAVA',
          externalActivityId: `fs-run-${athleteId}`,
          startTime: new Date('2026-02-10T06:00:00.000Z'),
          durationMinutes: 44,
          distanceKm: 10,
          rpe: 7,
          metricsJson: { strava: { activity: { averageWatts: 280 } } } as any,
        },
        {
          athleteId,
          source: 'STRAVA',
          externalActivityId: `fs-bike-${athleteId}`,
          startTime: new Date('2026-02-12T06:00:00.000Z'),
          durationMinutes: 60,
          distanceKm: 32,
          rpe: 6,
          metricsJson: { strava: { activity: { weightedAverageWatts: 250 } } } as any,
        },
      ],
    });

    await prisma.athleteCheckin.createMany({
      data: [
        { athleteId, date: new Date('2026-02-01T00:00:00.000Z'), weight: 75.0, waist: 84 },
        { athleteId, date: new Date('2026-02-10T00:00:00.000Z'), weight: 74.6, waist: 83.6 },
        { athleteId, date: new Date('2026-02-20T00:00:00.000Z'), weight: 74.2, waist: 83.2 },
      ],
    });

    authUser = {
      id: coachId,
      role: UserRole.COACH,
      email: 'coach@example.test',
      name: 'Coach',
      timezone: 'UTC',
      authProviderId: `auth-${coachId}`,
    };

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({ user: authUser }),
        requireAuth: async () => ({ user: authUser }),
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    if (envSnapshot.FUTURE_SELF_V1 === undefined) delete process.env.FUTURE_SELF_V1;
    else process.env.FUTURE_SELF_V1 = envSnapshot.FUTURE_SELF_V1;

    if (envSnapshot.NEXT_PUBLIC_FUTURE_SELF_V1 === undefined) delete process.env.NEXT_PUBLIC_FUTURE_SELF_V1;
    else process.env.NEXT_PUBLIC_FUTURE_SELF_V1 = envSnapshot.NEXT_PUBLIC_FUTURE_SELF_V1;

    await prisma.projectionSnapshot.deleteMany({ where: { athleteId } });
    await prisma.athleteTwin.deleteMany({ where: { athleteId } });
    await prisma.athleteCheckin.deleteMany({ where: { athleteId } });
    await prisma.completedActivity.deleteMany({ where: { athleteId } });
    await prisma.calendarItem.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('creates snapshot as coach, then hides a panel and athlete sees it filtered', async () => {
    const { POST: runProjection } = await import('@/app/api/projections/run/route');
    const { GET: getLatest } = await import('@/app/api/projections/latest/route');
    const { POST: updateVisibility } = await import('@/app/api/projections/visibility/route');

    const runRes = await runProjection(
      new Request('http://localhost/api/projections/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          horizon_weeks: 12,
          scenario: {
            adherencePct: 85,
            volumePct: 0,
            intensityMode: 'BASELINE',
            taperDays: 7,
          },
        }),
      })
    );

    expect(runRes.status).toBe(200);
    const runJson = await runRes.json();
    expect(runJson.error).toBeNull();
    const snapshotId = String(runJson.data.snapshotId ?? '');
    expect(snapshotId).toBeTruthy();

    const coachLatestRes = await getLatest(new Request(`http://localhost/api/projections/latest?athlete_id=${athleteId}`));
    expect(coachLatestRes.status).toBe(200);
    const coachLatestJson = await coachLatestRes.json();
    expect(coachLatestJson.error).toBeNull();
    expect(coachLatestJson.data.snapshot.snapshotId).toBe(snapshotId);

    const coachHorizon = coachLatestJson.data.snapshot.outputs.horizons['12'];
    expect(coachHorizon.performance).toBeTruthy();
    expect(coachHorizon.consistency).toBeTruthy();

    const visibilityRes = await updateVisibility(
      new Request('http://localhost/api/projections/visibility', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          snapshot_id: snapshotId,
          athlete_id: athleteId,
          visibility: {
            performance: false,
            consistency: true,
            bodyComposition: true,
          },
        }),
      })
    );

    expect(visibilityRes.status).toBe(200);

    authUser = {
      id: athleteId,
      role: UserRole.ATHLETE,
      email: 'athlete@example.test',
      name: 'Athlete',
      timezone: 'UTC',
      authProviderId: `auth-${athleteId}`,
    };

    const athleteLatestRes = await getLatest(new Request('http://localhost/api/projections/latest'));
    expect(athleteLatestRes.status).toBe(200);
    const athleteLatestJson = await athleteLatestRes.json();

    expect(athleteLatestJson.error).toBeNull();
    const athleteHorizon = athleteLatestJson.data.snapshot.outputs.horizons['12'];
    expect(athleteHorizon.performance).toBeNull();
    expect(athleteHorizon.consistency).toBeTruthy();
    expect(athleteHorizon.bodyComposition).toBeTruthy();
  });
});
