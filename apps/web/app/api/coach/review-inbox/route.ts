import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

const includeRefs = {
  athlete: {
    select: {
      user: { select: { id: true, name: true } },
    },
  },
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
  completedActivities: {
    orderBy: [{ startTime: 'desc' as const }],
    take: 1,
    select: {
      id: true,
      source: true,
      durationMinutes: true,
      distanceKm: true,
      rpe: true,
      painFlag: true,
      startTime: true,
    },
  },
  comments: {
    orderBy: [{ createdAt: 'asc' as const }],
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  },
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const items = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        date: {
          gte: fromDate,
          lte: toDate,
        },
        status: {
          in: [CalendarItemStatus.COMPLETED_MANUAL, CalendarItemStatus.COMPLETED_SYNCED, CalendarItemStatus.SKIPPED],
        },
        reviewedAt: null,
      },
      orderBy: [
        { date: 'asc' },
        { plannedStartTimeLocal: 'asc' },
      ],
      include: includeRefs,
    });

    const formatted = items
      .map((item: any) => {
        const athleteComments = item.comments.filter((c: any) => c.author.role === 'ATHLETE');
        const hasAthleteComment = athleteComments.length > 0;
        
        return {
          ...item,
          athlete: item.athlete?.user ?? null,
          latestCompletedActivity: item.completedActivities[0] ?? null,
          comments: item.comments ?? [],
          hasAthleteComment,
          commentCount: item.comments.length,
          coachAdvicePresent: !!item.notes && item.notes.trim().length > 0,
          completedActivities: undefined,
        };
      })
      .filter((item: any) => {
        // Only include SKIPPED items if they have athlete comments
        if (item.status === CalendarItemStatus.SKIPPED) {
          return item.hasAthleteComment;
        }
        return true;
      });

    return success({ items: formatted });
  } catch (error) {
    return handleError(error);
  }
}
