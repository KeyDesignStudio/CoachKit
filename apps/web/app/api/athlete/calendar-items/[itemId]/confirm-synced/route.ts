import { NextRequest } from 'next/server';
import { CalendarItemStatus, CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const confirmSchema = z.object({
  notesToSelf: z.string().trim().max(2000).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  painFlag: z.boolean().optional(),
  notesToCoach: z.string().trim().max(2000).optional(),
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
        where: { id: context.params.itemId, athleteId: user.id, deletedAt: null },
        include: includeRefs,
      });

      if (!item) {
        throw notFound('Calendar item not found.');
      }

      if (item.status === CalendarItemStatus.COMPLETED_MANUAL) {
        throw new ApiError(409, 'ALREADY_COMPLETED', 'This workout is already completed manually.');
      }

      if (item.status === CalendarItemStatus.SKIPPED) {
        throw new ApiError(409, 'ALREADY_SKIPPED', 'Missed workouts cannot be completed.');
      }

      const completion = await tx.completedActivity.findFirst({
        where: {
          calendarItemId: item.id,
          source: CompletionSource.STRAVA,
        },
        select: {
          id: true,
          confirmedAt: true,
          startTime: true,
          metricsJson: true,
        },
      });

      if (!completion) {
        throw new ApiError(409, 'NO_SYNCED_ACTIVITY', 'No Strava-synced activity found for this workout.');
      }

      const completionUpdate: Record<string, unknown> = {
        // Preserve existing confirmedAt if already confirmed.
        confirmedAt: completion.confirmedAt ?? new Date(),
      };

      if (payload.notesToSelf !== undefined) {
        completionUpdate.notes = payload.notesToSelf.trim().length ? payload.notesToSelf.trim() : null;
      }

      if (payload.rpe !== undefined) {
        completionUpdate.rpe = payload.rpe;
      }

      if (payload.painFlag !== undefined) {
        completionUpdate.painFlag = payload.painFlag;
      }

      await tx.completedActivity.update({
        where: { id: completion.id },
        data: completionUpdate,
      });

      let actionAt: Date | null = null;
      const candidate = (completion as any).metricsJson?.strava?.startDateUtc;
      if (typeof candidate === 'string' && candidate.length > 0) {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) actionAt = parsed;
      }
      if (!actionAt) {
        actionAt = completion.startTime ?? new Date();
      }

      // Ensure the calendar item is now coach-visible as completed.
      if (item.status !== CalendarItemStatus.COMPLETED_SYNCED || item.actionAt == null) {
        await tx.calendarItem.update({
          where: { id: item.id },
          data: { status: CalendarItemStatus.COMPLETED_SYNCED, actionAt },
        });
      }

      if (payload.notesToCoach && payload.notesToCoach.trim().length > 0) {
        await tx.comment.create({
          data: {
            calendarItemId: item.id,
            authorId: user.id,
            body: payload.notesToCoach.trim(),
          },
        });
      }

      const updatedItem = await tx.calendarItem.findFirst({
        where: { id: item.id, deletedAt: null },
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
