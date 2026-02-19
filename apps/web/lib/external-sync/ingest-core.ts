import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import type { ExternalIngestResult, NormalizedExternalActivity } from '@/lib/external-sync/types';

type ExistingActivity = {
  id: string;
  calendarItemId: string | null;
  durationMinutes: number;
  distanceKm: number | null;
  startTime: Date;
  confirmedAt: Date | null;
  metricsJson: unknown;
  matchDayDiff: number | null;
};

function jsonEqual(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function extractNamespaceMetrics(metricsJson: unknown, namespace: string) {
  if (!metricsJson || typeof metricsJson !== 'object') return undefined;
  return (metricsJson as Record<string, unknown>)[namespace];
}

function isUnchanged(existing: ExistingActivity, next: NormalizedExternalActivity) {
  return (
    existing.durationMinutes === next.durationMinutes &&
    (existing.distanceKm ?? null) === (next.distanceKm ?? null) &&
    new Date(existing.startTime).getTime() === next.startTime.getTime() &&
    jsonEqual(extractNamespaceMetrics(existing.metricsJson, next.metricsNamespace), next.metrics)
  );
}

export async function upsertExternalCompletedActivity(params: {
  athleteId: string;
  activity: NormalizedExternalActivity;
}): Promise<ExternalIngestResult> {
  const { athleteId, activity } = params;

  const createPayload: any = {
    athleteId,
    source: activity.source,
    externalProvider: activity.provider,
    externalActivityId: activity.externalActivityId,
    startTime: activity.startTime,
    durationMinutes: activity.durationMinutes,
    distanceKm: activity.distanceKm,
    notes: activity.notes,
    painFlag: false,
    confirmedAt: null,
    metricsJson: {
      [activity.metricsNamespace]: activity.metrics,
    } as Prisma.InputJsonValue,
  };

  try {
    const completed = await prisma.completedActivity.create({
      data: createPayload,
      select: {
        id: true,
        calendarItemId: true,
        durationMinutes: true,
        distanceKm: true,
        startTime: true,
        confirmedAt: true,
        matchDayDiff: true,
      },
    });

    return {
      kind: 'created',
      completed,
    };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;

    const existing = await prisma.completedActivity.findUnique({
      where: {
        athleteId_source_externalActivityId: {
          athleteId,
          source: activity.source,
          externalActivityId: activity.externalActivityId,
        },
      } as any,
      select: {
        id: true,
        calendarItemId: true,
        durationMinutes: true,
        distanceKm: true,
        startTime: true,
        confirmedAt: true,
        metricsJson: true,
        matchDayDiff: true,
      },
    });

    if (!existing) {
      throw new Error('Conflict on upsert but existing completion was not found.');
    }

    if (isUnchanged(existing, activity)) {
      return {
        kind: 'unchanged',
        completed: {
          id: existing.id,
          calendarItemId: existing.calendarItemId,
          durationMinutes: existing.durationMinutes,
          distanceKm: existing.distanceKm,
          startTime: existing.startTime,
          confirmedAt: existing.confirmedAt,
          matchDayDiff: existing.matchDayDiff,
        },
      };
    }

    const updated = await prisma.completedActivity.update({
      where: {
        athleteId_source_externalActivityId: {
          athleteId,
          source: activity.source,
          externalActivityId: activity.externalActivityId,
        },
      } as any,
      data: {
        startTime: activity.startTime,
        durationMinutes: activity.durationMinutes,
        distanceKm: activity.distanceKm,
        metricsJson: {
          ...((existing.metricsJson as Record<string, unknown> | null) ?? {}),
          [activity.metricsNamespace]: activity.metrics,
        } as Prisma.InputJsonValue,
      } as any,
      select: {
        id: true,
        calendarItemId: true,
        durationMinutes: true,
        distanceKm: true,
        startTime: true,
        confirmedAt: true,
        matchDayDiff: true,
      },
    });

    return {
      kind: 'updated',
      completed: updated,
    };
  }
}
