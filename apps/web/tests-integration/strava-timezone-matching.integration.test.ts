import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';
import { getLocalDayKey, parseDayKeyToUtcDate } from '@/lib/day-key';
import { formatUtcDayKey } from '@/lib/day-key';
import { resolveLocalStartUtc } from '@/lib/calendar-local-day';
import { getWeeklyPlannedCompletedSummary } from '@/lib/calendar/weekly-summary';

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

describe('strava sync timezone + matching', () => {
  const ids = {
    coachId: nextTestId('coach'),
    athleteId: nextTestId('athlete'),
    stravaAthleteId: nextTestId('strava_athlete'),
  };

  const savedEnv = envSnapshot();
  let syncEntry: StravaConnectionEntry;

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
        timezone: 'Australia/Brisbane',
        name: 'Test Athlete',
        authProviderId: ids.athleteId,
      },
      create: {
        id: ids.athleteId,
        email: `${ids.athleteId}@local`,
        role: 'ATHLETE',
        timezone: 'Australia/Brisbane',
        name: 'Test Athlete',
        authProviderId: ids.athleteId,
      },
      select: { id: true },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: ids.athleteId },
      update: { coachId: ids.coachId, disciplines: ['SWIM', 'BIKE', 'RUN'] },
      create: { userId: ids.athleteId, coachId: ids.coachId, disciplines: ['SWIM', 'BIKE', 'RUN'] },
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

    const connection = await prisma.stravaConnection.findUnique({
      where: { athleteId: ids.athleteId },
      select: { id: true, accessToken: true, refreshToken: true, expiresAt: true, scope: true, lastSyncAt: true },
    });

    if (!connection) throw new Error('Missing strava connection for test setup.');

    syncEntry = {
      athleteId: ids.athleteId,
      athleteTimezone: 'Australia/Brisbane',
      coachId: ids.coachId,
      connection: {
        id: connection.id,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.expiresAt,
        scope: connection.scope,
        lastSyncAt: connection.lastSyncAt,
      },
    };

    await prisma.calendarItem.deleteMany({
      where: { athleteId: ids.athleteId },
    });

    await prisma.completedActivity.deleteMany({
      where: { athleteId: ids.athleteId, source: 'STRAVA' },
    });

    await prisma.calendarItem.create({
      data: {
        athleteId: ids.athleteId,
        coachId: ids.coachId,
        date: parseDayKeyToUtcDate('2026-02-05'),
        plannedStartTimeLocal: '15:30',
        title: 'Planned Swim',
        discipline: 'SWIM',
        status: 'PLANNED',
        plannedDurationMinutes: 60,
        plannedDistanceKm: 2,
      },
    });

    await prisma.calendarItem.create({
      data: {
        athleteId: ids.athleteId,
        coachId: ids.coachId,
        date: parseDayKeyToUtcDate('2026-02-05'),
        plannedStartTimeLocal: '23:00',
        title: 'Planned Late Run',
        discipline: 'RUN',
        status: 'PLANNED',
        plannedDurationMinutes: 30,
        plannedDistanceKm: 5,
      },
    });

    await syncStravaForConnections([syncEntry], {
      forceDays: 7,
      overrideAfterUnixSeconds: 0,
      deep: true,
      stubScenario: 'timezone-daykey',
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

  it('matches planned activities and places unplanned on correct local day', async () => {
    const plannedSwim = await prisma.calendarItem.findFirst({
      where: { athleteId: ids.athleteId, title: 'Planned Swim' },
      select: { id: true },
    });

    const swimCompletion = await prisma.completedActivity.findFirst({
      where: { athleteId: ids.athleteId, externalActivityId: '2001' },
      select: { calendarItemId: true },
    });

    expect(plannedSwim?.id).toBeTruthy();
    expect(swimCompletion?.calendarItemId).toBe(plannedSwim?.id);

    const unplannedBike = await prisma.calendarItem.findUnique({
      where: {
        athleteId_origin_sourceActivityId: {
          athleteId: ids.athleteId,
          origin: 'STRAVA',
          sourceActivityId: '2002',
        },
      } as any,
      select: { date: true },
    });

    expect(unplannedBike).toBeTruthy();
    expect(getLocalDayKey(unplannedBike!.date, 'Australia/Brisbane')).toBe('2026-02-06');
  });

  it('matches near-midnight activities to the planned day', async () => {
    const midnightCompletion = await prisma.completedActivity.findFirst({
      where: { athleteId: ids.athleteId, externalActivityId: '2003' },
      select: { calendarItemId: true, matchDayDiff: true },
    });

    const plannedLateRun = await prisma.calendarItem.findFirst({
      where: { athleteId: ids.athleteId, title: 'Planned Late Run' },
      select: { id: true },
    });

    expect(midnightCompletion?.calendarItemId).toBe(plannedLateRun?.id);
    expect(midnightCompletion?.matchDayDiff).toBe(-1);
  });

  it('keeps matched completions on the planned day and surfaces in weekly summary', async () => {
    const plannedLateRun = await prisma.calendarItem.findFirst({
      where: { athleteId: ids.athleteId, title: 'Planned Late Run' },
      select: { id: true, date: true, plannedStartTimeLocal: true, discipline: true, status: true, plannedDurationMinutes: true },
    });

    const midnightCompletion = await prisma.completedActivity.findFirst({
      where: { athleteId: ids.athleteId, externalActivityId: '2003' },
      select: { calendarItemId: true, startTime: true, durationMinutes: true, source: true, metricsJson: true },
    });

    expect(plannedLateRun?.id).toBeTruthy();
    expect(midnightCompletion?.calendarItemId).toBe(plannedLateRun?.id);

    const activityDayKey = getLocalDayKey(midnightCompletion!.startTime, 'Australia/Brisbane');
    expect(activityDayKey).toBe('2026-02-06');

    const plannedDayKey = getLocalDayKey(plannedLateRun!.date, 'Australia/Brisbane');
    expect(plannedDayKey).toBe('2026-02-05');

    const unplannedBike = await prisma.calendarItem.findUnique({
      where: {
        athleteId_origin_sourceActivityId: {
          athleteId: ids.athleteId,
          origin: 'STRAVA',
          sourceActivityId: '2002',
        },
      } as any,
      select: { date: true, origin: true },
    });

    expect(unplannedBike).toBeTruthy();
    expect(unplannedBike?.origin).toBe('STRAVA');
    expect(getLocalDayKey(unplannedBike!.date, 'Australia/Brisbane')).toBe('2026-02-06');

    const calendarItems = await prisma.calendarItem.findMany({
      where: { athleteId: ids.athleteId, deletedAt: null },
      include: {
        completedActivities: {
          orderBy: [{ startTime: 'desc' }],
          where: { source: { in: ['MANUAL', 'STRAVA'] } },
          select: { id: true, source: true, startTime: true, durationMinutes: true, metricsJson: true, matchDayDiff: true },
          take: 5,
        },
      },
    });

    const viewItems = calendarItems.map((item) => {
      const completions = item.completedActivities ?? [];
      const latestManual = completions.find((c) => c.source === 'MANUAL') ?? null;
      const latestStrava = completions.find((c) => c.source === 'STRAVA') ?? null;
      const metricsCompletion = latestStrava ?? latestManual;

      let effectiveStartUtc: Date;
      if (metricsCompletion?.source === 'STRAVA') {
        const metrics = metricsCompletion.metricsJson as { strava?: { startDateUtc?: string | null } } | null;
        const candidate = metrics?.strava?.startDateUtc ?? null;
        const parsed = candidate ? new Date(candidate) : null;
        const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : metricsCompletion.startTime;
        if (typeof metricsCompletion.matchDayDiff === 'number' && metricsCompletion.matchDayDiff !== 0) {
          effectiveStartUtc = new Date(base.getTime() + metricsCompletion.matchDayDiff * 24 * 60 * 60 * 1000);
        } else {
          effectiveStartUtc = base;
        }
      } else if (metricsCompletion) {
        effectiveStartUtc = metricsCompletion.startTime;
      } else {
        effectiveStartUtc = resolveLocalStartUtc({
          dayKey: formatUtcDayKey(item.date),
          plannedStartTimeLocal: item.plannedStartTimeLocal,
          timeZone: 'Australia/Brisbane',
        });
      }

      return {
        id: item.id,
        date: getLocalDayKey(effectiveStartUtc, 'Australia/Brisbane'),
        discipline: item.discipline,
        status: item.status,
        plannedDurationMinutes: item.plannedDurationMinutes,
        latestCompletedActivity: metricsCompletion ? { durationMinutes: metricsCompletion.durationMinutes } : null,
      };
    });

    const summary = getWeeklyPlannedCompletedSummary({
      items: viewItems,
      timeZone: 'Australia/Brisbane',
      fromDayKey: '2026-02-02',
      toDayKey: '2026-02-08',
    });

    const runSummary = summary.byDiscipline.find((row) => row.discipline === 'RUN');
    expect(runSummary?.plannedMinutes ?? 0).toBeGreaterThanOrEqual(30);

    const lateRunView = viewItems.find((item) => item.id === plannedLateRun?.id);
    expect(lateRunView?.date).toBe('2026-02-05');
    expect(lateRunView?.latestCompletedActivity?.durationMinutes ?? 0).toBeGreaterThanOrEqual(30);
  });
});
