import { prisma } from '@/lib/prisma';

export type AdaptationMemorySummary = {
  sampleSize: number;
  completionRate: number;
  skipRate: number;
  avgRpe: number | null;
  sorenessRate: number;
  painRate: number;
  recommendedWeeklyMinutesMultiplier: number;
  recommendedMaxIntensityDaysPerWeekDelta: number;
  recommendedSessionsPerWeekDelta: number;
  recommendedRecoveryEveryNWeeks: number | null;
  notes: string[];
};

function round(value: number, decimals = 3) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

export async function buildAdaptationMemorySummary(params: {
  coachId: string;
  athleteId: string;
}): Promise<AdaptationMemorySummary> {
  const since = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000);

  const [feedback, completed] = await Promise.all([
    prisma.athleteSessionFeedback.findMany({
      where: { coachId: params.coachId, athleteId: params.athleteId, createdAt: { gte: since } },
      orderBy: [{ createdAt: 'desc' }],
      take: 120,
      select: {
        completedStatus: true,
        rpe: true,
        sorenessFlag: true,
      },
    }),
    prisma.completedActivity.findMany({
      where: { athleteId: params.athleteId, startTime: { gte: since } },
      orderBy: [{ startTime: 'desc' }],
      take: 120,
      select: {
        painFlag: true,
        rpe: true,
      },
    }),
  ]);

  const sampleSize = feedback.length;
  if (!sampleSize && !completed.length) {
    return {
      sampleSize: 0,
      completionRate: 0,
      skipRate: 0,
      avgRpe: null,
      sorenessRate: 0,
      painRate: 0,
      recommendedWeeklyMinutesMultiplier: 1,
      recommendedMaxIntensityDaysPerWeekDelta: 0,
      recommendedSessionsPerWeekDelta: 0,
      recommendedRecoveryEveryNWeeks: null,
      notes: [],
    };
  }

  const doneCount = feedback.filter((f) => f.completedStatus === 'DONE' || f.completedStatus === 'PARTIAL').length;
  const skipCount = feedback.filter((f) => f.completedStatus === 'SKIPPED').length;
  const sorenessCount = feedback.filter((f) => Boolean(f.sorenessFlag)).length;

  const rpeValues = [
    ...feedback.map((f) => (typeof f.rpe === 'number' ? f.rpe : null)).filter((v): v is number => v != null),
    ...completed.map((f) => (typeof f.rpe === 'number' ? f.rpe : null)).filter((v): v is number => v != null),
  ];

  const painCount = completed.filter((c) => Boolean(c.painFlag)).length;

  const completionRate = sampleSize ? doneCount / sampleSize : 0;
  const skipRate = sampleSize ? skipCount / sampleSize : 0;
  const sorenessRate = sampleSize ? sorenessCount / sampleSize : 0;
  const painRate = completed.length ? painCount / completed.length : 0;
  const avgRpe = rpeValues.length ? rpeValues.reduce((sum, v) => sum + v, 0) / rpeValues.length : null;

  let recommendedWeeklyMinutesMultiplier = 1;
  let recommendedMaxIntensityDaysPerWeekDelta = 0;
  let recommendedSessionsPerWeekDelta = 0;
  let recommendedRecoveryEveryNWeeks: number | null = null;
  const notes: string[] = [];

  if (painRate >= 0.2 || sorenessRate >= 0.25 || (avgRpe != null && avgRpe >= 8) || skipRate >= 0.35) {
    recommendedWeeklyMinutesMultiplier = 0.9;
    recommendedMaxIntensityDaysPerWeekDelta = -1;
    recommendedSessionsPerWeekDelta = -1;
    recommendedRecoveryEveryNWeeks = 3;
    notes.push('Recent pain/soreness or strain signals suggest a conservative progression block.');
  } else if (completionRate >= 0.85 && skipRate <= 0.1 && (avgRpe == null || avgRpe <= 6.5) && painRate < 0.1) {
    recommendedWeeklyMinutesMultiplier = 1.06;
    recommendedMaxIntensityDaysPerWeekDelta = 0;
    recommendedSessionsPerWeekDelta = 1;
    recommendedRecoveryEveryNWeeks = 4;
    notes.push('Strong compliance and manageable exertion support a small progression uplift.');
  } else {
    notes.push('Maintain steady progression with current load signals.');
  }

  return {
    sampleSize,
    completionRate: round(completionRate),
    skipRate: round(skipRate),
    avgRpe: avgRpe == null ? null : round(avgRpe, 2),
    sorenessRate: round(sorenessRate),
    painRate: round(painRate),
    recommendedWeeklyMinutesMultiplier,
    recommendedMaxIntensityDaysPerWeekDelta,
    recommendedSessionsPerWeekDelta,
    recommendedRecoveryEveryNWeeks,
    notes,
  };
}
