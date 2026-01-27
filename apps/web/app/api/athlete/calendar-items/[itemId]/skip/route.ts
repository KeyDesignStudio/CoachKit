import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

const skipSchema = z.object({
  commentBody: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireAthlete();
    let payload: z.infer<typeof skipSchema> = {};

    try {
      payload = skipSchema.parse(await request.json());
    } catch {
      payload = skipSchema.parse({});
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.calendarItem.findFirst({
        where: { id: context.params.itemId, athleteId: user.id, deletedAt: null },
        include: includeRefs,
      });

      if (!item) {
        throw notFound('Calendar item not found.');
      }

      if (item.status === CalendarItemStatus.COMPLETED_MANUAL || item.status === CalendarItemStatus.COMPLETED_SYNCED) {
        throw new ApiError(409, 'ALREADY_COMPLETED', 'Completed workouts cannot be marked missed.');
      }

      if (item.status !== CalendarItemStatus.SKIPPED) {
        const updated = await tx.calendarItem.update({
          where: { id: item.id },
          data: { status: CalendarItemStatus.SKIPPED, actionAt: new Date() },
          include: includeRefs,
        });
        if (payload.commentBody && payload.commentBody.trim().length > 0) {
          await tx.comment.create({
            data: {
              calendarItemId: item.id,
              authorId: user.id,
              body: payload.commentBody.trim(),
            },
          });
        }

        return { item: updated };
      }

      if (payload.commentBody && payload.commentBody.trim().length > 0) {
        await tx.comment.create({
          data: {
            calendarItemId: item.id,
            authorId: user.id,
            body: payload.commentBody.trim(),
          },
        });
      }

      return { item };
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
