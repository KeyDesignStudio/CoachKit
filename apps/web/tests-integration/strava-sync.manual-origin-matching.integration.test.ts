import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { syncStravaForConnections } from '@/lib/strava-sync';

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

describe('strava sync manual-origin matching', () => {
  const ids = {
    coachId: nextTestId('coach'),
    athleteId: nextTestId('athlete'),
    stravaAthleteId: nextTestId('strava_athlete'),
  };
  const savedEnv = envSnapshot();

  beforeAll(async () => {
    process.env.STRAVA_STUB = 'true';
    process.env.STRAVA_STUB_SCENARIO = '';
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

  it('links STRAVA activity to athlete-manual planned session', async () => {
    const now = new Date();
    const baseUtcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    const manual = await prisma.calendarItem.create({
      data: {
        athleteId: ids.athleteId,
        coachId: ids.coachId,
        date: baseUtcDate,
        plannedStartTimeLocal: '12:00',
        title: 'Athlete Manual Other 1200',
        discipline: 'OTHER',
        status: 'PLANNED',
        origin: 'MANUAL',
        plannedDurationMinutes: 60,
      },
      select: { id: true },
    });

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: ids.athleteId },
      select: { id: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true, lastSyncAt: true },
    });
    expect(connection).toBeTruthy();

    await syncStravaForConnections(
      [
        {
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
        },
      ],
      { forceDays: 2 }
    );

    const linked = await prisma.completedActivity.findFirst({
      where: {
        athleteId: ids.athleteId,
        source: 'STRAVA',
        externalActivityId: '999',
      },
      select: { calendarItemId: true },
    });
    expect(linked?.calendarItemId).toBe(manual.id);

    const manualAfter = await prisma.calendarItem.findUnique({
      where: { id: manual.id },
      select: { status: true },
    });
    expect(manualAfter?.status).toBe('COMPLETED_SYNCED_DRAFT');

    const unplanned = await prisma.calendarItem.findFirst({
      where: {
        athleteId: ids.athleteId,
        origin: 'STRAVA',
        sourceActivityId: '999',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(unplanned).toBeNull();
  });
});
