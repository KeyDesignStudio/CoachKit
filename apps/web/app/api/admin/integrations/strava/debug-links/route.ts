import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { combineDateWithLocalTime } from '@/lib/date';
import { formatUtcDayKey } from '@/lib/day-key';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  athleteId: z.string().min(1),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 10))
    .pipe(z.number().int().min(1).max(50)),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const { athleteId, limit } = querySchema.parse({
      athleteId: url.searchParams.get('athleteId'),
      limit: url.searchParams.get('limit') ?? undefined,
    });

    const athlete = await prisma.user.findUnique({
      where: { id: athleteId },
      select: { id: true, timezone: true, email: true, role: true },
    });

    if (!athlete) {
      throw new ApiError(404, 'ATHLETE_NOT_FOUND', 'No user found for athleteId.');
    }

    const completions = await prisma.completedActivity.findMany({
      where: {
        athleteId,
        source: CompletionSource.STRAVA,
      },
      orderBy: [{ startTime: 'desc' }],
      take: limit,
      select: {
        id: true,
        externalActivityId: true,
        startTime: true,
        confirmedAt: true,
        metricsJson: true,
        calendarItemId: true,
        calendarItem: {
          select: {
            id: true,
            athleteId: true,
            coachId: true,
            date: true,
            plannedStartTimeLocal: true,
            origin: true,
            planningStatus: true,
            sourceActivityId: true,
            discipline: true,
            subtype: true,
            title: true,
            status: true,
            deletedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const items = completions.map((c) => {
      const strava = (c.metricsJson as any)?.strava ?? null;
      const calendarItem = c.calendarItem;
      const storedCalendarStartUtc =
        calendarItem && calendarItem.date
          ? combineDateWithLocalTime(calendarItem.date, calendarItem.plannedStartTimeLocal)
          : null;

      return {
        completedActivity: {
          id: c.id,
          stravaActivityId: c.externalActivityId ?? null,
          startTimeUtc: c.startTime?.toISOString?.() ?? null,
          stravaStartDateUtcRaw: strava?.startDateUtc ?? null,
          stravaStartDateLocalRaw: strava?.startDateLocal ?? null,
          calendarItemId: c.calendarItemId,
          confirmedAtUtc: c.confirmedAt?.toISOString?.() ?? null,
        },
        calendarItem: calendarItem
          ? {
              id: calendarItem.id,
              athleteId: calendarItem.athleteId,
              coachId: calendarItem.coachId,
              dateUtcDayKey: formatUtcDayKey(calendarItem.date),
              dateUtcIso: calendarItem.date?.toISOString?.() ?? null,
              plannedStartTimeLocal: calendarItem.plannedStartTimeLocal,
              storedStartTimeUtcIso: storedCalendarStartUtc?.toISOString?.() ?? null,
              origin: calendarItem.origin,
              isPlanned: calendarItem.origin == null,
              planningStatus: calendarItem.planningStatus,
              sourceActivityId: calendarItem.sourceActivityId,
              discipline: calendarItem.discipline,
              subtype: calendarItem.subtype,
              title: calendarItem.title,
              status: calendarItem.status,
              deletedAtUtc: calendarItem.deletedAt?.toISOString?.() ?? null,
              createdAtUtc: calendarItem.createdAt?.toISOString?.() ?? null,
              updatedAtUtc: calendarItem.updatedAt?.toISOString?.() ?? null,
            }
          : null,
      };
    });

    return success({
      athlete: {
        id: athlete.id,
        role: athlete.role,
        timezone: athlete.timezone,
        email: athlete.email,
      },
      count: items.length,
      items,
    });
  } catch (error) {
    return handleError(error);
  }
}
