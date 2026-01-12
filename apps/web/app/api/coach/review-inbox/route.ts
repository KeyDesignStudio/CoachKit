import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { createServerProfiler } from '@/lib/server-profiler';

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

const COMMENTS_LIMIT = 10;

export async function GET(request: NextRequest) {
  try {
    const prof = createServerProfiler('coach/review-inbox');
    prof.mark('start');
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

    prof.mark('auth+parse');

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
      select: {
        id: true,
        athleteId: true,
        date: true,
        plannedStartTimeLocal: true,
        discipline: true,
        subtype: true,
        title: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        intensityType: true,
        intensityTargetJson: true,
        workoutDetail: true,
        attachmentsJson: true,
        status: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        athlete: {
          select: {
            user: { select: { id: true, name: true } },
          },
        },
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
          orderBy: [{ createdAt: 'desc' as const }],
          take: COMMENTS_LIMIT,
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
        _count: {
          select: { comments: true },
        },
      },
    });

    prof.mark('db');

    const formatted = items
      .map((item: any) => {
        const comments = (item.comments ?? []).slice().reverse();
        const hasAthleteComment = comments.some((c: any) => c.author?.role === 'ATHLETE');

        const latestCompletedActivity = item.completedActivities?.[0] ?? null;
        const actionTime = latestCompletedActivity?.startTime
          ? new Date(latestCompletedActivity.startTime)
          : new Date(item.updatedAt);
        const actionDateKey = getDateKeyInTimeZone(actionTime, user.timezone);

        return {
          id: item.id,
          date: item.date,
          plannedStartTimeLocal: item.plannedStartTimeLocal,
          discipline: item.discipline,
          subtype: item.subtype,
          title: item.title,
          plannedDurationMinutes: item.plannedDurationMinutes,
          plannedDistanceKm: item.plannedDistanceKm,
          intensityType: item.intensityType,
          intensityTargetJson: item.intensityTargetJson,
          workoutDetail: item.workoutDetail,
          attachmentsJson: item.attachmentsJson,
          status: item.status,
          reviewedAt: item.reviewedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          athlete: item.athlete?.user ?? null,
          latestCompletedActivity,
          comments,
          hasAthleteComment,
          commentCount: item._count?.comments ?? comments.length,
          actionTime: actionTime.toISOString(),
          actionDateKey,
        };
      })
      .sort((a: any, b: any) => {
        const aTime = new Date(a.actionTime).getTime();
        const bTime = new Date(b.actionTime).getTime();
        return bTime - aTime;
      });

    prof.mark('format');
    prof.done({ itemCount: formatted.length });

    return success(
      { items: formatted },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
