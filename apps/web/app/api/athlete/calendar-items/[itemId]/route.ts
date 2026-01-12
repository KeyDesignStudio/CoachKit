import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';
import { isStravaTimeDebugEnabled } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
  comments: {
    select: {
      id: true,
      authorId: true,
      body: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
  completedActivities: {
    select: {
      id: true,
      durationMinutes: true,
      distanceKm: true,
      rpe: true,
      notes: true,
      painFlag: true,
      source: true,
      confirmedAt: true,
      metricsJson: true,
      startTime: true,
    },
    orderBy: { startTime: 'desc' as const },
    take: 1,
  },
};

function getEffectiveActualStartUtc(completion: {
  source: CompletionSource | string;
  startTime: Date;
  metricsJson?: any;
}): Date {
  if (completion.source === CompletionSource.STRAVA) {
    const candidate = completion.metricsJson?.strava?.startDateUtc;
    const parsed = candidate ? new Date(candidate) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  }

  return completion.startTime;
}

export async function GET(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireAthlete();
    const includeDebug = isStravaTimeDebugEnabled();

    const item = await prisma.calendarItem.findFirst({
      where: { id: context.params.itemId, athleteId: user.id },
      include: includeRefs,
    });

    if (!item) {
      throw notFound('Calendar item not found.');
    }

    const completed = item.completedActivities?.[0] as
      | ({ source: string; startTime: Date; metricsJson?: any } & Record<string, any>)
      | undefined;

    const completedWithEffective = completed
      ? {
          ...completed,
          effectiveStartTimeUtc: getEffectiveActualStartUtc(completed).toISOString(),
          // DEV-ONLY DEBUG — Strava time diagnostics
          // Never enabled in production. Do not rely on this data.
          debug:
            includeDebug && completed.source === CompletionSource.STRAVA
              ? {
                  stravaTime: {
                    tzUsed: user.timezone,
                    stravaStartDateUtcRaw: completed.metricsJson?.strava?.startDateUtc ?? null,
                    stravaStartDateLocalRaw: completed.metricsJson?.strava?.startDateLocal ?? null,
                    storedStartTimeUtc: completed.startTime?.toISOString?.() ?? null,
                  },
                }
              : undefined,
        }
      : undefined;

    return success({
      item: {
        ...item,
        completedActivities: completedWithEffective ? [completedWithEffective] : [],
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
