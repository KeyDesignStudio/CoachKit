import { NextRequest } from 'next/server';
import { CompletionSource, PlanWeekStatus } from '@prisma/client';
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
    take: 5,
    where: {
      source: { in: [CompletionSource.MANUAL, CompletionSource.STRAVA] },
    },
    select: {
      id: true,
      painFlag: true,
      startTime: true,
      source: true,
      metricsJson: true,
    },
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

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const includeDebug =
      process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEBUG_STRAVA_TIME === 'true';
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

    // Format items to include latestCompletedActivity (prefer MANUAL over STRAVA).
    const formattedItems = items.map((item: any) => {
      const completions = (item.completedActivities ?? []) as Array<{
        id: string;
        painFlag: boolean;
        startTime: Date;
        source: string;
        metricsJson?: any;
      }>;

      const latestManual = completions.find((c) => c.source === CompletionSource.MANUAL) ?? null;
      const latestStrava = completions.find((c) => c.source === CompletionSource.STRAVA) ?? null;

      const latest = latestManual ?? latestStrava;

      const latestCompletedActivity = latest
        ? {
            id: latest.id,
            painFlag: latest.painFlag,
            source: latest.source,
            effectiveStartTimeUtc: getEffectiveActualStartUtc(latest).toISOString(),
            debugTime:
              includeDebug && latest.source === CompletionSource.STRAVA
                ? {
                    tzUsed: user.timezone,
                    stravaStartDateUtcRaw: latest.metricsJson?.strava?.startDateUtc ?? null,
                    stravaStartDateLocalRaw: latest.metricsJson?.strava?.startDateLocal ?? null,
                    storedStartTimeUtc: latest.startTime?.toISOString?.() ?? null,
                  }
                : undefined,
          }
        : null;

      return {
        ...item,
        latestCompletedActivity,
        completedActivities: undefined,
      };
    });

    return success({ items: formattedItems });
  } catch (error) {
    return handleError(error);
  }
}
