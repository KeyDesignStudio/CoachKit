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

describe('strava sync (unmatched + dedupe)', () => {
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
      select: { id: true, athleteId: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true, lastSyncAt: true },
    });

    // Ensure a clean slate for the stub activity ids.
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
      where: { athleteId: ids.athleteId, origin: 'STRAVA' },
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

  it('creates an unplanned calendar item when unmatched and is idempotent on resync', async () => {
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

    // First sync: should create 1 CompletedActivity and 1 STRAVA-origin CalendarItem (unmatched).
    await syncStravaForConnections([entry], { forceDays: 2 });

    const calendarCount1 = await prisma.calendarItem.count({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: '999',
        deletedAt: null,
      },
    });
    expect(calendarCount1).toBe(1);

    const completionCount1 = await prisma.completedActivity.count({
      where: {
        athleteId: ids.athleteId,
        source: 'STRAVA',
        externalActivityId: '999',
      },
    });
    expect(completionCount1).toBe(1);

    // Mimic athlete calendar query behavior: it should be returned in a normal date-range query.
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 0, 0, 0));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, 0, 0, 0));
    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: ids.athleteId,
        deletedAt: null,
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
      select: { id: true, origin: true, sourceActivityId: true },
    });
    expect(items.some((i) => i.origin === 'STRAVA' && i.sourceActivityId === '999')).toBe(true);

    // Second sync: should not create duplicates.
    await syncStravaForConnections([entry], { forceDays: 2 });

    const calendarCount2 = await prisma.calendarItem.count({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: '999',
        deletedAt: null,
      },
    });
    expect(calendarCount2).toBe(1);

    const completionCount2 = await prisma.completedActivity.count({
      where: {
        athleteId: ids.athleteId,
        source: 'STRAVA',
        externalActivityId: '999',
      },
    });
    expect(completionCount2).toBe(1);
  });
});
