import { NextRequest } from 'next/server';
import { CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { isStravaTimeDebugEnabled } from '@/lib/debug';
import { getWeatherSummariesForRange } from '@/lib/weather-server';
import { formatUtcDayKey } from '@/lib/day-key';

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
    const includeDebug = isStravaTimeDebugEnabled();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    const fromDate = parseDateOnly(params.from, 'from');
    const toDate = parseDateOnly(params.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const [athleteProfile, items] = await Promise.all([
      prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true, defaultLat: true, defaultLon: true },
      }),
      prisma.calendarItem.findMany({
        where: {
          athleteId: user.id,
          date: {
            gte: fromDate,
            lte: toDate,
          },
        },
        orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
        include: includeRefs,
      }),
    ]);

    if (!athleteProfile) {
      return success(
        { items: [] },
        {
          headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
        }
      );
    }

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
                      tzUsed: user.timezone,
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
        date: formatUtcDayKey(item.date),
        latestCompletedActivity,
        completedActivities: undefined,
      };
    });

    let dayWeather: Record<string, any> | undefined;
    if (athleteProfile?.defaultLat != null && athleteProfile?.defaultLon != null) {
      try {
        const tz = user.timezone ?? 'UTC';
        const map = await getWeatherSummariesForRange({
          lat: athleteProfile.defaultLat,
          lon: athleteProfile.defaultLon,
          from: params.from,
          to: params.to,
          timezone: tz,
        });

        if (Object.keys(map).length > 0) {
          dayWeather = map;
        }
      } catch {
        // Best-effort: calendar should still load.
      }
    }

    return success(
      { items: formattedItems, dayWeather },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
