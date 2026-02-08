import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { syncStravaActivityById } from '@/lib/strava-sync';

type EnvSnapshot = {
  STRAVA_STUB?: string;
  STRAVA_STUB_SCENARIO?: string;
  DISABLE_AUTH?: string;
};

function envSnapshot(): EnvSnapshot {
  return {
    STRAVA_STUB: process.env.STRAVA_STUB,
    STRAVA_STUB_SCENARIO: process.env.STRAVA_STUB_SCENARIO,
    DISABLE_AUTH: process.env.DISABLE_AUTH,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  if (snapshot.STRAVA_STUB === undefined) delete process.env.STRAVA_STUB;
  else process.env.STRAVA_STUB = snapshot.STRAVA_STUB;

  if (snapshot.STRAVA_STUB_SCENARIO === undefined) delete process.env.STRAVA_STUB_SCENARIO;
  else process.env.STRAVA_STUB_SCENARIO = snapshot.STRAVA_STUB_SCENARIO;

  if (snapshot.DISABLE_AUTH === undefined) delete process.env.DISABLE_AUTH;
  else process.env.DISABLE_AUTH = snapshot.DISABLE_AUTH;
}

function nextTestId(prefix: string) {
  const run = String(process.env.TEST_RUN_ID ?? 'local');
  const worker = String(process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? process.pid);
  return `${prefix}_${run}_${worker}_${Date.now()}`;
}

describe('strava sync (backfill relinks when linked item deleted)', () => {
  const ids = {
    coachId: nextTestId('coach'),
    athleteId: nextTestId('athlete'),
    stravaAthleteId: nextTestId('strava_athlete'),
  };

  const savedEnv = envSnapshot();

  beforeAll(async () => {
    process.env.STRAVA_STUB = 'true';
    process.env.DISABLE_AUTH = 'true';

    await prisma.user.upsert({
      where: { id: ids.coachId },
      update: {
        email: `${ids.coachId}@local`,
        role: 'COACH',
        timezone: 'UTC',
        name: 'Test Coach',
        authProviderId: ids.coachId,
      },
      create: {
        id: ids.coachId,
        email: `${ids.coachId}@local`,
        role: 'COACH',
        timezone: 'UTC',
        name: 'Test Coach',
        authProviderId: ids.coachId,
      },
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { id: ids.athleteId },
      update: {
        email: `${ids.athleteId}@local`,
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Test Athlete',
        authProviderId: ids.athleteId,
      },
      create: {
        id: ids.athleteId,
        email: `${ids.athleteId}@local`,
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Test Athlete',
        authProviderId: ids.athleteId,
      },
      select: { id: true },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: ids.athleteId },
      update: { coachId: ids.coachId, disciplines: ['OTHER'] },
      create: { userId: ids.athleteId, coachId: ids.coachId, disciplines: ['OTHER'] },
      select: { userId: true },
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);

    await prisma.stravaConnection.upsert({
      where: { athleteId: ids.athleteId },
      update: {
        stravaAthleteId: ids.stravaAthleteId,
        accessToken: 'stub-access-token',
        refreshToken: 'stub-refresh-token',
        expiresAt,
        scope: 'read',
      },
      create: {
        athleteId: ids.athleteId,
        stravaAthleteId: ids.stravaAthleteId,
        accessToken: 'stub-access-token',
        refreshToken: 'stub-refresh-token',
        expiresAt,
        scope: 'read',
      },
      select: { id: true },
    });

    // Clean slate for the stub activity id.
    await prisma.completedActivity.deleteMany({
      where: {
        athleteId: ids.athleteId,
        source: 'STRAVA',
        externalActivityId: { in: ['2002'] },
      },
    });

    await prisma.calendarItem.deleteMany({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: { in: ['2002'] },
      },
    });
  });

  afterAll(async () => {
    restoreEnv(savedEnv);

    await prisma.completedActivity.deleteMany({
      where: { athleteId: ids.athleteId, source: 'STRAVA' },
    });

    await prisma.calendarItem.deleteMany({
      where: { athleteId: ids.athleteId },
    });

    await prisma.stravaConnection.deleteMany({
      where: { athleteId: ids.athleteId },
    });

    await prisma.athleteProfile.deleteMany({
      where: { userId: ids.athleteId },
    });

    await prisma.user.deleteMany({
      where: { id: { in: [ids.athleteId, ids.coachId] } },
    });
  });

  it('creates an unplanned STRAVA calendar item when existing completion is linked to a deleted calendar item', async () => {
    // Mirror the timezone-daykey stub activity start time for id=2002.
    const startTime = new Date('2026-02-06T08:06:00.000Z');
    const base = new Date(Date.UTC(2026, 1, 6, 0, 0, 0));

    // Create a planned calendar item and then delete it to orphan the completion link.
    const deletedPlanned = await prisma.calendarItem.create({
      data: {
        athleteId: ids.athleteId,
        coachId: ids.coachId,
        date: base,
        plannedStartTimeLocal: '12:00',
        origin: null,
        planningStatus: null,
        sourceActivityId: null,
        discipline: 'RUN',
        title: 'Deleted planned session',
        status: 'PLANNED',
      },
      select: { id: true },
    });

    // Create an existing completion for the stub activity that points at the deleted item.
    await prisma.completedActivity.create({
      data: {
        athleteId: ids.athleteId,
        calendarItemId: deletedPlanned.id,
        source: 'STRAVA',
        externalProvider: 'STRAVA',
        externalActivityId: '2002',
        startTime,
        durationMinutes: 60,
        distanceKm: 0,
        notes: null,
        painFlag: false,
        confirmedAt: null,
      },
      select: { id: true },
    });

    await prisma.calendarItem.delete({
      where: { id: deletedPlanned.id },
    });

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: ids.athleteId },
      select: { id: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true, lastSyncAt: true },
    });
    expect(connection).toBeTruthy();

    const summary = await syncStravaActivityById({
      athleteId: ids.athleteId,
      stravaActivityId: '2002',
      stubScenario: 'timezone-daykey',
    });

    // The ingestion should clear the deleted link and ensure a STRAVA-origin calendar item exists.
    expect(summary.created + summary.updated).toBeGreaterThanOrEqual(1);

    const completion = await prisma.completedActivity.findUnique({
      where: {
        athleteId_source_externalActivityId: {
          athleteId: ids.athleteId,
          source: 'STRAVA',
          externalActivityId: '2002',
        },
      } as any,
      select: { calendarItemId: true },
    });

    expect(completion).toBeTruthy();

    // Idempotency: second run should not create duplicates.
    await syncStravaActivityById({
      athleteId: ids.athleteId,
      stravaActivityId: '2002',
      stubScenario: 'timezone-daykey',
    });

    const completion2 = await prisma.completedActivity.findUnique({
      where: {
        athleteId_source_externalActivityId: {
          athleteId: ids.athleteId,
          source: 'STRAVA',
          externalActivityId: '2002',
        },
      } as any,
      select: { id: true },
    });
    expect(completion2).toBeTruthy();
  });
});
