import { NextRequest } from 'next/server';
import { PlanWeekStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { assertValidDateRange, parseDateOnly, startOfWeek } from '@/lib/date';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
  completedActivities: {
    orderBy: [{ startTime: 'desc' as const }],
    take: 1,
    select: {
      id: true,
      painFlag: true,
      startTime: true,
    },
  },
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete(request);
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    // Get athlete profile to find coach
    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!athleteProfile) {
      return success({ items: [] });
    }

    // Fetch all published weeks in range
    const publishedWeeks = await prisma.planWeek.findMany({
      where: {
        athleteId: user.id,
        coachId: athleteProfile.coachId,
        status: PlanWeekStatus.PUBLISHED,
        weekStart: {
          gte: startOfWeek(fromDate),
          lte: toDate,
        },
      },
      select: { weekStart: true },
    });

    // Create a set of published week start dates for efficient lookup
    const publishedWeekStarts = new Set(
      publishedWeeks.map((pw) => pw.weekStart.toISOString().split('T')[0])
    );

    // Fetch all calendar items in range
    const allItems = await prisma.calendarItem.findMany({
      where: {
        athleteId: user.id,
        date: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: [
        { date: 'asc' },
        { plannedStartTimeLocal: 'asc' },
      ],
      include: includeRefs,
    });

    // Filter to only items in published weeks
    const items = allItems.filter((item) => {
      const itemWeekStart = startOfWeek(item.date).toISOString().split('T')[0];
      return publishedWeekStarts.has(itemWeekStart);
    });

    // Format items to include latestCompletedActivity
    const formattedItems = items.map((item: any) => ({
      ...item,
      latestCompletedActivity: item.completedActivities?.[0] ?? null,
      completedActivities: undefined,
    }));

    return success({ items: formattedItems });
  } catch (error) {
    return handleError(error);
  }
}
