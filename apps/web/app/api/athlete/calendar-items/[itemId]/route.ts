import { NextRequest } from 'next/server';
import { CompletionSource, PlanWeekStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';
import { startOfWeek } from '@/lib/date';

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

    const item = await prisma.calendarItem.findFirst({
      where: { id: context.params.itemId, athleteId: user.id },
      include: includeRefs,
    });

    if (!item) {
      throw notFound('Calendar item not found.');
    }

    // Check if the week is published
    const itemWeekStart = startOfWeek(item.date);
    const planWeek = await prisma.planWeek.findUnique({
      where: {
        coachId_athleteId_weekStart: {
          coachId: item.coachId,
          athleteId: user.id,
          weekStart: itemWeekStart,
        },
      },
    });

    // If no PlanWeek exists or status is DRAFT, deny access
    if (!planWeek || planWeek.status !== PlanWeekStatus.PUBLISHED) {
      throw notFound('Calendar item not found.');
    }

    const completed = item.completedActivities?.[0] as
      | ({ source: string; startTime: Date; metricsJson?: any } & Record<string, any>)
      | undefined;

    const completedWithEffective = completed
      ? {
          ...completed,
          effectiveStartTimeUtc: getEffectiveActualStartUtc(completed).toISOString(),
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
