import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  athleteId: z.string().trim().min(1, { message: 'athleteId is required.' }),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach(request);
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      athleteId: searchParams.get('athleteId'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    await assertCoachOwnsAthlete(params.athleteId, user.id);

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
      include: {
        template: {
          select: { id: true, title: true },
        },
        groupSession: {
          select: { id: true, title: true },
        },
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: {
            id: true,
            painFlag: true,
            startTime: true,
          },
        },
      },
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
