import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { syncStravaForConnections } from '@/lib/strava-sync';

type EnvSnapshot = {
  STRAVA_STUB?: string;
  DISABLE_AUTH?: string;
};

function envSnapshot(): EnvSnapshot {
  return {
    STRAVA_STUB: process.env.STRAVA_STUB,
    DISABLE_AUTH: process.env.DISABLE_AUTH,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  if (snapshot.STRAVA_STUB === undefined) delete process.env.STRAVA_STUB;
  else process.env.STRAVA_STUB = snapshot.STRAVA_STUB;

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
        externalActivityId: { in: ['999'] },
      },
    });

    await prisma.calendarItem.deleteMany({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: { in: ['999'] },
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
    // Mirror the stub activity start time for id=999.
    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const startTime = new Date(base.getTime() + 12 * 60 * 60_000);

    // Create a planned calendar item and mark it deleted.
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
        deletedAt: new Date(),
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
        externalActivityId: '999',
        startTime,
        durationMinutes: 60,
        distanceKm: 0,
        notes: null,
        painFlag: false,
        confirmedAt: null,
      },
      select: { id: true },
    });

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: ids.athleteId },
      select: { id: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true, lastSyncAt: true },
    });
    expect(connection).toBeTruthy();

    const entry = {
      athleteId: ids.athleteId,
      athleteTimezone: 'UTC',
      coachId: ids.coachId,
      connection: {
        id: connection!.id,
        accessToken: connection!.accessToken,
        refreshToken: connection!.refreshToken,
        expiresAt: connection!.expiresAt,
        scope: connection!.scope,
        lastSyncAt: connection!.lastSyncAt,
      },
    };

    const summary = await syncStravaForConnections([entry], { forceDays: 2 });

    // The ingestion should clear the deleted link and ensure a STRAVA-origin calendar item exists.
    expect(summary.created + summary.updated).toBeGreaterThanOrEqual(1);

    const createdCount = await prisma.calendarItem.count({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: '999',
        deletedAt: null,
      },
    });
    expect(createdCount).toBe(1);

    const completion = await prisma.completedActivity.findUnique({
      where: {
        athleteId_source_externalActivityId: {
          athleteId: ids.athleteId,
          source: 'STRAVA',
          externalActivityId: '999',
        },
      } as any,
      select: { calendarItemId: true },
    });

    expect(completion?.calendarItemId).toBeTruthy();
    expect(completion?.calendarItemId).not.toBe(deletedPlanned.id);

    // Idempotency: second run should not create duplicates.
    await syncStravaForConnections([entry], { forceDays: 2 });

    const createdCount2 = await prisma.calendarItem.count({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: '999',
        deletedAt: null,
      },
    });
    expect(createdCount2).toBe(1);
  });
});
