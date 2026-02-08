import { NextRequest } from 'next/server';
import { CalendarItemStatus, CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { getStoredStartUtcFromCalendarItem } from '@/lib/calendar-local-day';

export const dynamic = 'force-dynamic';

const completeSchema = z.object({
  durationMinutes: z.number().int().positive().max(1000),
  distanceKm: z.number().nonnegative().max(1000).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
  painFlag: z.boolean().optional(),
  commentBody: z.string().trim().max(2000).optional(),
});

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

export async function POST(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireAthlete();
    const payload = completeSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.calendarItem.findFirst({
        where: { id: context.params.itemId, athleteId: user.id, deletedAt: null },
        include: includeRefs,
      });

      if (!item) {
        throw notFound('Calendar item not found.');
      }

      if (item.status === CalendarItemStatus.COMPLETED_MANUAL || item.status === CalendarItemStatus.COMPLETED_SYNCED) {
        throw new ApiError(409, 'ALREADY_COMPLETED', 'This workout is already completed.');
      }

      if (item.status === CalendarItemStatus.SKIPPED) {
        throw new ApiError(409, 'ALREADY_SKIPPED', 'Missed workouts cannot be completed.');
      }

      const existingManual = await tx.completedActivity.findFirst({
        where: {
          calendarItemId: item.id,
          source: CompletionSource.MANUAL,
        },
        select: { id: true },
      });

      if (existingManual) {
        throw new ApiError(409, 'ALREADY_COMPLETED', 'This workout already has a manual completion.');
      }

      const startTime = getStoredStartUtcFromCalendarItem(item, user.timezone ?? 'UTC');

      const completedActivity = await tx.completedActivity.create({
        data: {
          source: CompletionSource.MANUAL,
          startTime,
          durationMinutes: payload.durationMinutes,
          distanceKm: payload.distanceKm ?? null,
          rpe: payload.rpe ?? null,
          notes: payload.notes ?? null,
          painFlag: payload.painFlag ?? false,
          athlete: {
            connect: { userId: user.id },
          },
          calendarItem: {
            connect: { id: item.id },
          },
        },
      });

      const updatedItem = await tx.calendarItem.update({
        where: { id: item.id },
        data: { status: CalendarItemStatus.COMPLETED_MANUAL, actionAt: completedActivity.createdAt },
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

      return { updatedItem, completedActivity };
    });

    return success({ item: result.updatedItem, completedActivity: result.completedActivity });
  } catch (error) {
    return handleError(error);
  }
}
