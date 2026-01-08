import { NextRequest } from 'next/server';
import { PlanWeekStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';
import { startOfWeek } from '@/lib/date';

export const dynamic = 'force-dynamic';

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
  completedActivities: {
    select: {
      id: true,
      durationMinutes: true,
      distanceKm: true,
      rpe: true,
      notes: true,
      source: true,
    },
  },
};

export async function GET(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireAthlete(request);

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

    return success({ item });
  } catch (error) {
    return handleError(error);
  }
}
