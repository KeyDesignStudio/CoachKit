import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
});

function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    // Fallback: ISO date in UTC.
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

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

    const fromDate = params.from ? parseDateOnly(params.from, 'from') : null;
    const toDate = params.to ? parseDateOnly(params.to, 'to') : null;
    if (fromDate && toDate) {
      assertValidDateRange(fromDate, toDate);
    }

    const items = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        ...(fromDate && toDate
          ? {
              date: {
                gte: fromDate,
                lte: toDate,
              },
            }
          : {}),
        status: {
          in: [CalendarItemStatus.COMPLETED_MANUAL, CalendarItemStatus.COMPLETED_SYNCED, CalendarItemStatus.SKIPPED],
        },
        reviewedAt: null,
      },
      orderBy: [
        { updatedAt: 'desc' },
        { date: 'desc' },
      ],
      include: includeRefs,
    });

    const formatted = items
      .map((item: any) => {
        const athleteComments = item.comments.filter((c: any) => c.author.role === 'ATHLETE');
        const hasAthleteComment = athleteComments.length > 0;
        const latestCompletedActivity = item.completedActivities[0] ?? null;
        const actionTime = latestCompletedActivity?.startTime
          ? new Date(latestCompletedActivity.startTime)
          : new Date(item.updatedAt);
        const actionDateKey = getDateKeyInTimeZone(actionTime, user.timezone);
        
        return {
          ...item,
          athlete: item.athlete?.user ?? null,
          latestCompletedActivity,
          comments: item.comments ?? [],
          hasAthleteComment,
          commentCount: item.comments.length,
          coachAdvicePresent: !!item.notes && item.notes.trim().length > 0,
          actionTime: actionTime.toISOString(),
          actionDateKey,
          completedActivities: undefined,
        };
      })
      .sort((a: any, b: any) => {
        const aTime = new Date(a.actionTime).getTime();
        const bTime = new Date(b.actionTime).getTime();
        return bTime - aTime;
      });

    return success({ items: formatted });
  } catch (error) {
    return handleError(error);
  }
}
