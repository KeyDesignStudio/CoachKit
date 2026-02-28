import type { Prisma } from '@prisma/client';

import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { buildProjection, type ProjectionHorizon, type ProjectionInput, type ProjectionOutput, type ScenarioKnobs, FUTURE_SELF_MODEL_VERSION } from '@/modules/future-self/server/model';

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function clampHorizon(value: number): ProjectionHorizon {
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  if (value <= 12) return 12;
  return 24;
}

export function normalizeScenario(input?: Partial<ScenarioKnobs> | null): ScenarioKnobs {
  const adherence = input?.adherencePct;
  const volume = input?.volumePct;
  const intensityMode = input?.intensityMode;
  const taperDays = input?.taperDays;

  return {
    adherencePct: adherence === 70 || adherence === 95 ? adherence : 85,
    volumePct: volume === -10 || volume === 10 ? volume : 0,
    intensityMode: intensityMode === 'PLUS_ONE_HARD_SESSION' ? 'PLUS_ONE_HARD_SESSION' : 'BASELINE',
    taperDays: taperDays === 7 || taperDays === 10 ? taperDays : null,
  };
}

function inferDiscipline(raw: string | null | undefined) {
  const value = String(raw ?? '').toUpperCase();
  if (value.includes('RUN')) return 'RUN';
  if (value.includes('BIKE') || value.includes('RIDE') || value.includes('CYCLE')) return 'BIKE';
  if (value.includes('SWIM')) return 'SWIM';
  return 'OTHER';
}

function readAvgPower(metricsJson: Prisma.JsonValue | null): number | null {
  const root = metricsJson && typeof metricsJson === 'object' ? (metricsJson as Record<string, unknown>) : null;
  const strava = root?.strava && typeof root.strava === 'object' ? (root.strava as Record<string, unknown>) : null;
  const activity = strava?.activity && typeof strava.activity === 'object' ? (strava.activity as Record<string, unknown>) : null;
  const candidates = [
    activity?.weightedAverageWatts,
    activity?.averageWatts,
    strava?.avgPowerW,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
  }

  return null;
}

function estimateRunEquivalentSeconds(distanceKm: number, durationMinutes: number, targetKm: number) {
  if (distanceKm <= 0 || durationMinutes <= 0) return null;
  const paceSecPerKm = (durationMinutes * 60) / distanceKm;
  return paceSecPerKm * targetKm;
}

export async function buildProjectionInput(athleteId: string): Promise<ProjectionInput> {
  const now = new Date();
  const from84 = new Date(now.getTime() - 84 * 24 * 60 * 60 * 1000);
  const from28 = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [profile, recentActivities, recentPlanned, checkins] = await Promise.all([
    prisma.athleteProfile.findUnique({
      where: { userId: athleteId },
      select: {
        userId: true,
        disciplines: true,
        eventName: true,
        eventDate: true,
      },
    }),
    prisma.completedActivity.findMany({
      where: {
        athleteId,
        startTime: { gte: from84 },
      },
      orderBy: [{ startTime: 'desc' }],
      select: {
        startTime: true,
        durationMinutes: true,
        distanceKm: true,
        rpe: true,
        metricsJson: true,
        calendarItem: {
          select: { discipline: true },
        },
      },
    }),
    prisma.calendarItem.findMany({
      where: {
        athleteId,
        deletedAt: null,
        date: { gte: from28 },
      },
      select: {
        id: true,
        status: true,
      },
    }),
    prisma.athleteCheckin.findMany({
      where: {
        athleteId,
        date: { gte: from30 },
      },
      orderBy: [{ date: 'desc' }],
      select: {
        date: true,
        weight: true,
        waist: true,
      },
    }),
  ]);

  if (!profile) {
    throw new Error('Athlete not found.');
  }

  const daysWithTraining = new Set(
    recentActivities.map((activity) => activity.startTime.toISOString().slice(0, 10))
  ).size;

  const runEfforts = recentActivities
    .map((activity) => {
      const discipline = inferDiscipline(activity.calendarItem?.discipline);
      if (discipline !== 'RUN') return null;
      if (!activity.distanceKm || activity.distanceKm <= 0) return null;

      const sec5k = estimateRunEquivalentSeconds(activity.distanceKm, activity.durationMinutes, 5);
      const sec10k = estimateRunEquivalentSeconds(activity.distanceKm, activity.durationMinutes, 10);

      return {
        distanceKm: activity.distanceKm,
        sec5k,
        sec10k,
      };
    })
    .filter((item): item is { distanceKm: number; sec5k: number | null; sec10k: number | null } => Boolean(item));

  const bikeEfforts = recentActivities
    .map((activity) => {
      const discipline = inferDiscipline(activity.calendarItem?.discipline);
      if (discipline !== 'BIKE') return null;
      const avgPowerW = readAvgPower(activity.metricsJson);
      if (!avgPowerW || activity.durationMinutes < 15) return null;
      return { avgPowerW, durationMinutes: activity.durationMinutes };
    })
    .filter((item): item is { avgPowerW: number; durationMinutes: number } => Boolean(item));

  const runBest5kSec = runEfforts
    .filter((effort) => effort.distanceKm >= 4 && effort.sec5k != null)
    .reduce<number | null>((best, effort) => (best == null || (effort.sec5k as number) < best ? (effort.sec5k as number) : best), null);

  const runBest10kSec = runEfforts
    .filter((effort) => effort.distanceKm >= 8 && effort.sec10k != null)
    .reduce<number | null>((best, effort) => (best == null || (effort.sec10k as number) < best ? (effort.sec10k as number) : best), null);

  const bikeFtpLikeW = bikeEfforts.reduce<number | null>((best, effort) => {
    const ftpLike = effort.durationMinutes >= 20 ? effort.avgPowerW * 0.95 : effort.avgPowerW * 0.9;
    return best == null || ftpLike > best ? ftpLike : best;
  }, null);

  const completedStatuses = new Set(['COMPLETED_MANUAL', 'COMPLETED_SYNCED', 'COMPLETED_SYNCED_DRAFT']);
  const completedSessionsLast28Days = recentPlanned.filter((item) => completedStatuses.has(String(item.status))).length;

  return {
    athleteId,
    sportProfile: {
      disciplines: profile.disciplines,
      eventName: profile.eventName,
      eventDate: profile.eventDate ? profile.eventDate.toISOString().slice(0, 10) : null,
    },
    history: {
      historyWeeks: Math.max(1, Math.round((now.getTime() - from84.getTime()) / (7 * 24 * 60 * 60 * 1000))),
      recentDaysWithTraining: daysWithTraining,
      recentActivities: recentActivities.map((activity) => ({
        startTimeIso: activity.startTime.toISOString(),
        discipline: inferDiscipline(activity.calendarItem?.discipline),
        durationMinutes: activity.durationMinutes,
        distanceKm: activity.distanceKm ?? null,
        rpe: activity.rpe ?? null,
        avgPowerW: readAvgPower(activity.metricsJson),
      })),
      plannedSessionsLast28Days: recentPlanned.length,
      completedSessionsLast28Days,
      runBest5kSec,
      runBest10kSec,
      bikeFtpLikeW,
      checkinsLast30Days: checkins.map((item) => ({
        dateIso: item.date.toISOString(),
        weight: item.weight,
        waist: item.waist,
      })),
    },
  };
}

export async function recomputeTwin(athleteId: string) {
  const projectionInput = await buildProjectionInput(athleteId);

  const twin = await prisma.athleteTwin.upsert({
    where: { athleteId },
    create: {
      athleteId,
      sportProfile: toJson(projectionInput.sportProfile),
      baselineMetrics: toJson({
        runBest5kSec: projectionInput.history.runBest5kSec,
        runBest10kSec: projectionInput.history.runBest10kSec,
        bikeFtpLikeW: projectionInput.history.bikeFtpLikeW,
      }),
      rollingMetrics: toJson({
        recentDaysWithTraining: projectionInput.history.recentDaysWithTraining,
        plannedSessionsLast28Days: projectionInput.history.plannedSessionsLast28Days,
        completedSessionsLast28Days: projectionInput.history.completedSessionsLast28Days,
      }),
      dataQuality: toJson({
        historyWeeks: projectionInput.history.historyWeeks,
        checkinsLast30Days: projectionInput.history.checkinsLast30Days.length,
      }),
      lastInputs: toJson({
        refreshedAt: new Date().toISOString(),
        source: 'recomputeTwin',
      }),
      modelVersion: FUTURE_SELF_MODEL_VERSION,
    },
    update: {
      sportProfile: toJson(projectionInput.sportProfile),
      baselineMetrics: toJson({
        runBest5kSec: projectionInput.history.runBest5kSec,
        runBest10kSec: projectionInput.history.runBest10kSec,
        bikeFtpLikeW: projectionInput.history.bikeFtpLikeW,
      }),
      rollingMetrics: toJson({
        recentDaysWithTraining: projectionInput.history.recentDaysWithTraining,
        plannedSessionsLast28Days: projectionInput.history.plannedSessionsLast28Days,
        completedSessionsLast28Days: projectionInput.history.completedSessionsLast28Days,
      }),
      dataQuality: toJson({
        historyWeeks: projectionInput.history.historyWeeks,
        checkinsLast30Days: projectionInput.history.checkinsLast30Days.length,
      }),
      lastInputs: toJson({
        refreshedAt: new Date().toISOString(),
        source: 'recomputeTwin',
      }),
      modelVersion: FUTURE_SELF_MODEL_VERSION,
    },
  });

  return {
    athleteId: twin.athleteId,
    updatedAt: twin.updatedAt.toISOString(),
    modelVersion: twin.modelVersion,
  };
}

export async function runProjection(params: {
  athleteId: string;
  createdBy: string;
  createdByType: 'COACH' | 'SYSTEM';
  scenario?: Partial<ScenarioKnobs> | null;
  horizonWeeks: number;
  visibility?: Partial<Record<'performance' | 'consistency' | 'bodyComposition', boolean>>;
}) {
  await recomputeTwin(params.athleteId);
  const input = await buildProjectionInput(params.athleteId);
  const scenario = normalizeScenario(params.scenario ?? null);
  const horizonWeeks = clampHorizon(params.horizonWeeks);
  const outputs = buildProjection(input, scenario, horizonWeeks);

  const visibility = {
    performance: params.visibility?.performance ?? true,
    consistency: params.visibility?.consistency ?? true,
    bodyComposition: params.visibility?.bodyComposition ?? true,
  };

  const snapshot = await prisma.projectionSnapshot.create({
    data: {
      athleteId: params.athleteId,
      createdBy: params.createdBy,
      createdByType: params.createdByType,
      scenario: toJson(scenario),
      horizonWeeks,
      outputs: toJson(outputs),
      assumptions: toJson(outputs.assumptions),
      confidence: toJson(outputs.confidence),
      visibility: toJson(visibility),
      modelVersion: FUTURE_SELF_MODEL_VERSION,
    },
    select: {
      id: true,
      athleteId: true,
      createdAt: true,
      horizonWeeks: true,
      outputs: true,
      assumptions: true,
      confidence: true,
      visibility: true,
      modelVersion: true,
    },
  });

  return {
    snapshotId: snapshot.id,
    athleteId: snapshot.athleteId,
    createdAt: snapshot.createdAt.toISOString(),
    horizonWeeks: snapshot.horizonWeeks,
    outputs: snapshot.outputs as ProjectionOutput,
    assumptions: snapshot.assumptions,
    confidence: snapshot.confidence,
    visibility: snapshot.visibility,
    modelVersion: snapshot.modelVersion,
  };
}

export async function updateProjectionVisibility(params: {
  snapshotId: string;
  athleteId: string;
  visibility: Partial<Record<'performance' | 'consistency' | 'bodyComposition', boolean>>;
}) {
  const existing = await prisma.projectionSnapshot.findFirst({
    where: { id: params.snapshotId, athleteId: params.athleteId },
    select: {
      id: true,
      visibility: true,
    },
  });

  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Projection snapshot not found.');
  }

  const current = (existing.visibility && typeof existing.visibility === 'object' ? existing.visibility : {}) as Record<string, unknown>;

  const nextVisibility = {
    performance: typeof params.visibility.performance === 'boolean' ? params.visibility.performance : Boolean(current.performance ?? true),
    consistency: typeof params.visibility.consistency === 'boolean' ? params.visibility.consistency : Boolean(current.consistency ?? true),
    bodyComposition: typeof params.visibility.bodyComposition === 'boolean' ? params.visibility.bodyComposition : Boolean(current.bodyComposition ?? true),
  };

  const updated = await prisma.projectionSnapshot.update({
    where: { id: existing.id },
    data: {
      visibility: toJson(nextVisibility),
    },
    select: {
      id: true,
      visibility: true,
    },
  });

  return {
    snapshotId: updated.id,
    visibility: updated.visibility,
  };
}

export async function getLatestProjectionForAthlete(athleteId: string) {
  const snapshot = await prisma.projectionSnapshot.findFirst({
    where: { athleteId },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      athleteId: true,
      createdAt: true,
      createdBy: true,
      createdByType: true,
      scenario: true,
      horizonWeeks: true,
      outputs: true,
      assumptions: true,
      confidence: true,
      visibility: true,
      modelVersion: true,
    },
  });

  if (!snapshot) return null;

  return {
    snapshotId: snapshot.id,
    athleteId: snapshot.athleteId,
    createdAt: snapshot.createdAt.toISOString(),
    createdBy: snapshot.createdBy,
    createdByType: snapshot.createdByType,
    scenario: snapshot.scenario,
    horizonWeeks: snapshot.horizonWeeks,
    outputs: snapshot.outputs,
    assumptions: snapshot.assumptions,
    confidence: snapshot.confidence,
    visibility: snapshot.visibility,
    modelVersion: snapshot.modelVersion,
  };
}
