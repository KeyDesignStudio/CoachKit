import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';
import { startOfWeek, addDays } from '@/lib/date';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  athleteId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const { athleteId, from, to } = querySchema.parse(searchParams);

    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T23:59:59Z');

    // Fetch existing PlanWeeks in range
    const planWeeks = await prisma.planWeek.findMany({
      where: {
        coachId: user.id,
        athleteId,
        weekStart: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { weekStart: 'asc' },
    });
    const planWeekByStartKey = new Map(
      planWeeks.map((pw) => [pw.weekStart.toISOString().slice(0, 10), pw])
    );

    // Build a map of all Monday weeks in range
    const weeks: Array<{
      weekStart: string;
      status: 'DRAFT' | 'PUBLISHED';
      publishedAt: string | null;
    }> = [];

    let currentMonday = startOfWeek(fromDate);
    const endMonday = startOfWeek(toDate);

    while (currentMonday <= endMonday) {
      const weekStartISO = currentMonday.toISOString().split('T')[0];
      const existing = planWeekByStartKey.get(weekStartISO);

      weeks.push({
        weekStart: weekStartISO,
        status: existing?.status ?? 'DRAFT',
        publishedAt: existing?.publishedAt?.toISOString() ?? null,
      });

      currentMonday = addDays(currentMonday, 7);
    }

    return success(
      { weeks },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
