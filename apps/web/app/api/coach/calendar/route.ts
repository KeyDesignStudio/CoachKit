import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { isStravaTimeDebugEnabled } from '@/lib/debug';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  athleteId: z.string().trim().min(1, { message: 'athleteId is required.' }),
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
    const { user } = await requireCoach();
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      athleteId: searchParams.get('athleteId'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    await assertCoachOwnsAthlete(params.athleteId, user.id);

    const athleteUser = await prisma.user.findUnique({
      where: { id: params.athleteId },
      select: { timezone: true },
    });

    const athleteTimezone = athleteUser?.timezone ?? 'Australia/Brisbane';

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const items = await prisma.calendarItem.findMany({
      where: {
        athleteId: params.athleteId,
        coachId: user.id,
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
            // DEV-ONLY DEBUG — Strava time diagnostics
            // Never enabled in production. Do not rely on this data.
            debug:
              includeDebug && latest.source === CompletionSource.STRAVA
                ? {
                    stravaTime: {
                      tzUsed: athleteTimezone,
                      stravaStartDateUtcRaw: latest.metricsJson?.strava?.startDateUtc ?? null,
                      stravaStartDateLocalRaw: latest.metricsJson?.strava?.startDateLocal ?? null,
                      storedStartTimeUtc: latest.startTime?.toISOString?.() ?? null,
                    },
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

    return success(
      { items: formattedItems, athleteTimezone },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
