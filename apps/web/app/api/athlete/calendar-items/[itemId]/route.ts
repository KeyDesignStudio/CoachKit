import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { forbidden, notFound } from '@/lib/errors';
import { isStravaTimeDebugEnabled } from '@/lib/debug';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const baseIncludeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

const commentsSelect = {
  select: {
    id: true,
    authorId: true,
    body: true,
    createdAt: true,
  },
  orderBy: { createdAt: 'desc' as const },
  take: 10,
};

const completedActivitiesSelect = {
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

    const itemId = context.params.itemId;

    const [item, comments, completedActivities] = await Promise.all([
      prisma.calendarItem.findFirst({
        where: { id: itemId, athleteId: user.id, deletedAt: null },
        include: baseIncludeRefs,
      }),
      prisma.comment.findMany({
        where: { calendarItemId: itemId },
        ...commentsSelect,
      }),
      prisma.completedActivity.findMany({
        where: { calendarItemId: itemId },
        ...completedActivitiesSelect,
      }),
    ]);

    if (!item) {
      throw notFound('Calendar item not found.');
    }

    // Enforce ownership for associated records.
    const safeComments = (comments ?? []).filter((c: any) => c && c.authorId);

    const completed = completedActivities?.[0] as
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

    return success(
      {
        item: {
          ...item,
          comments: safeComments,
          completedActivities: completedWithEffective ? [completedWithEffective] : [],
        },
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 0 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireAthlete();
    const itemId = context.params.itemId;

    const existing = await prisma.calendarItem.findUnique({
      where: { id: itemId },
      select: { id: true, athleteId: true, deletedAt: true },
    });

    if (!existing) {
      throw notFound('Calendar item not found.');
    }

    if (existing.athleteId !== user.id) {
      throw forbidden('Forbidden.');
    }

    if (existing.deletedAt) {
      return success({ ok: true, alreadyDeleted: true });
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.calendarItem.update({
        where: { id: itemId },
        data: {
          deletedAt: now,
          deletedByUserId: user.id,
        },
        select: { id: true },
      });

      // Remove linked completion rows so deleted sessions don't affect stats.
      await tx.completedActivity.deleteMany({
        where: { calendarItemId: itemId },
      });
    });

    return success({ ok: true, deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
