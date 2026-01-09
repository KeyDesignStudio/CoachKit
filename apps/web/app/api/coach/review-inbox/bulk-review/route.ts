import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' }),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const body = await request.json();
    const payload = bodySchema.parse(body);

    const fromDate = parseDateOnly(payload.from, 'from');
    const toDate = parseDateOnly(payload.to, 'to');
    assertValidDateRange(fromDate, toDate);

    // Find all unreviewed completed items in the date range
    const items = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        date: {
          gte: fromDate,
          lte: toDate,
        },
        status: {
          in: [CalendarItemStatus.COMPLETED_MANUAL, CalendarItemStatus.COMPLETED_SYNCED],
        },
        reviewedAt: null,
      },
      include: {
        comments: {
          select: {
            author: {
              select: {
                role: true,
              },
            },
          },
        },
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: {
            painFlag: true,
          },
        },
      },
    });

    // Filter to only items without athlete comments AND without pain flags
    const itemsToReview = items.filter((item: any) => {
      const hasAthleteComment = item.comments.some((c: any) => c.author.role === 'ATHLETE');
      const hasPainFlag = item.completedActivities[0]?.painFlag ?? false;
      return !hasAthleteComment && !hasPainFlag;
    });

    const itemIds = itemsToReview.map((item: any) => item.id);

    if (itemIds.length > 0) {
      await prisma.calendarItem.updateMany({
        where: {
          id: { in: itemIds },
          coachId: user.id,
        },
        data: {
          reviewedAt: new Date(),
        },
      });
    }

    return success({ reviewedCount: itemIds.length });
  } catch (error) {
    return handleError(error);
  }
}
