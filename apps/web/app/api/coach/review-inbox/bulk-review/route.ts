import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const body = await request.json();
    const payload = bodySchema.parse(body);

    const result = await prisma.calendarItem.updateMany({
      where: {
        id: { in: payload.ids },
        coachId: user.id,
        reviewedAt: null,
        status: {
          in: [CalendarItemStatus.COMPLETED_MANUAL, CalendarItemStatus.COMPLETED_SYNCED, CalendarItemStatus.SKIPPED],
        },
      },
      data: {
        reviewedAt: new Date(),
      },
    });

    return success({ reviewedCount: result.count });
  } catch (error) {
    return handleError(error);
  }
}
