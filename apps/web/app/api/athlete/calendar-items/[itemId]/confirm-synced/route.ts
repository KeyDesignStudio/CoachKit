import { NextRequest } from 'next/server';
import { CalendarItemStatus, CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const confirmSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
  painFlag: z.boolean().optional(),
  commentBody: z.string().trim().max(2000).optional(),
});

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
  completedActivities: {
    select: {
      id: true,
      durationMinutes: true,
      distanceKm: true,
      rpe: true,
      notes: true,
      painFlag: true,
      source: true,
      confirmedAt: true,
    },
    orderBy: { startTime: 'desc' as const },
    take: 1,
  },
};

export async function POST(request: NextRequest, context: { params: { itemId: string } }) {
  try {
    const { user } = await requireAthlete();
    const payload = confirmSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.calendarItem.findFirst({
        where: { id: context.params.itemId, athleteId: user.id },
        include: includeRefs,
      });

      if (!item) {
        throw notFound('Calendar item not found.');
      }

      if (item.status === CalendarItemStatus.COMPLETED_MANUAL) {
        throw new ApiError(409, 'ALREADY_COMPLETED', 'This workout is already completed manually.');
      }

      if (item.status === CalendarItemStatus.SKIPPED) {
        throw new ApiError(409, 'ALREADY_SKIPPED', 'Skipped workouts cannot be completed.');
      }

      const completion = await tx.completedActivity.findFirst({
        where: {
          calendarItemId: item.id,
          source: CompletionSource.STRAVA,
        },
        select: {
          id: true,
          confirmedAt: true,
        },
      });

      if (!completion) {
        throw new ApiError(409, 'NO_SYNCED_ACTIVITY', 'No Strava-synced activity found for this workout.');
      }

      if (!completion.confirmedAt) {
        await tx.completedActivity.update({
          where: { id: completion.id },
          data: {
            confirmedAt: new Date(),
            notes: payload.notes ?? null,
            painFlag: payload.painFlag ?? false,
          },
        });
      }

      // Ensure the calendar item is now coach-visible as completed.
      if (item.status !== CalendarItemStatus.COMPLETED_SYNCED) {
        await tx.calendarItem.update({
          where: { id: item.id },
          data: { status: CalendarItemStatus.COMPLETED_SYNCED },
        });
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

      const updatedItem = await tx.calendarItem.findFirst({
        where: { id: item.id },
        include: includeRefs,
      });

      if (!updatedItem) {
        throw notFound('Calendar item not found.');
      }

      return updatedItem;
    });

    return success({ item: result });
  } catch (error) {
    return handleError(error);
  }
}
