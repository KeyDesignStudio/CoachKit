import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach, assertCoachOwnsAthlete } from '@/lib/auth';
import { parseDateOnly } from '@/lib/date';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Dates must be YYYY-MM-DD.' });

const copyWeekSchema = z.object({
  athleteId: z.string().min(1),
  fromWeekStart: isoDate,
  toWeekStart: isoDate,
  mode: z.enum(['overwrite', 'skipExisting']).default('skipExisting'),
});

type CopyWeekPayload = z.infer<typeof copyWeekSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

type CopyMode = CopyWeekPayload['mode'];

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = copyWeekSchema.parse(await request.json());

    await assertCoachOwnsAthlete(payload.athleteId, user.id);

    const fromWeekStart = parseDateOnly(payload.fromWeekStart, 'fromWeekStart');
    const toWeekStart = parseDateOnly(payload.toWeekStart, 'toWeekStart');

    assertMonday(fromWeekStart, 'fromWeekStart');
    assertMonday(toWeekStart, 'toWeekStart');

    const fromWeekEnd = addDaysUtc(fromWeekStart, 6);
    const toWeekEnd = addDaysUtc(toWeekStart, 6);

    const result = await prisma.$transaction(async (tx) => {
      const sourceItems = await tx.calendarItem.findMany({
        where: {
          coachId: user.id,
          athleteId: payload.athleteId,
          deletedAt: null,
          date: {
            gte: fromWeekStart,
            lte: fromWeekEnd,
          },
        },
        orderBy: [{ date: 'asc' }, { plannedStartTimeLocal: 'asc' }],
        select: {
          date: true,
          plannedStartTimeLocal: true,
          discipline: true,
          subtype: true,
          title: true,
          plannedDurationMinutes: true,
          plannedDistanceKm: true,
          intensityType: true,
          intensityTargetJson: true,
          workoutDetail: true,
          attachmentsJson: true,
          templateId: true,
        },
      });

      if (!sourceItems.length) {
        return { createdCount: 0, skippedCount: 0 };
      }

      const existingTargets = await tx.calendarItem.findMany({
        where: {
          coachId: user.id,
          athleteId: payload.athleteId,
          deletedAt: null,
          date: {
            gte: toWeekStart,
            lte: toWeekEnd,
          },
        },
        select: {
          id: true,
          date: true,
          plannedStartTimeLocal: true,
          title: true,
          templateId: true,
        },
      });

      const conflictMap = new Map<string, { id: string }>();
      existingTargets.forEach((item) => {
        const key = buildConflictKey(item.date, item.plannedStartTimeLocal, item.title, item.templateId);
        conflictMap.set(key, { id: item.id });
      });

      const dataToCreate: Prisma.CalendarItemCreateManyInput[] = [];
      const conflictsToDelete = new Set<string>();
      const newKeys = new Set<string>();
      let skippedCount = 0;

      for (const source of sourceItems) {
        const offsetDays = Math.round((source.date.getTime() - fromWeekStart.getTime()) / DAY_MS);
        const targetDate = addDaysUtc(toWeekStart, offsetDays);
        const key = buildConflictKey(targetDate, source.plannedStartTimeLocal, source.title, source.templateId);

        const seenInTransaction = newKeys.has(key);
        const hasConflict = conflictMap.has(key);

        if (payload.mode === 'skipExisting') {
          if (seenInTransaction || hasConflict) {
            skippedCount += 1;
            continue;
          }
        }

        if (payload.mode === 'overwrite') {
          if (hasConflict) {
            const conflict = conflictMap.get(key);
            if (conflict) {
              conflictsToDelete.add(conflict.id);
              conflictMap.delete(key);
            }
          }

          if (seenInTransaction) {
            skippedCount += 1;
            continue;
          }
        }

        newKeys.add(key);
        dataToCreate.push({
          athleteId: payload.athleteId,
          coachId: user.id,
          date: targetDate,
          plannedStartTimeLocal: source.plannedStartTimeLocal ?? null,
          discipline: source.discipline,
          subtype: source.subtype ?? null,
          title: source.title,
          plannedDurationMinutes: source.plannedDurationMinutes ?? null,
          plannedDistanceKm: source.plannedDistanceKm ?? null,
          intensityType: source.intensityType ?? null,
          intensityTargetJson: source.intensityTargetJson as Prisma.InputJsonValue,
          workoutDetail: source.workoutDetail ?? null,
          attachmentsJson: source.attachmentsJson as Prisma.InputJsonValue,
          status: CalendarItemStatus.PLANNED,
          templateId: source.templateId ?? null,
          groupSessionId: null,
        });
      }

      if (payload.mode === 'overwrite' && conflictsToDelete.size) {
        await tx.calendarItem.deleteMany({ where: { id: { in: Array.from(conflictsToDelete) } } });
      }

      if (dataToCreate.length) {
        await tx.calendarItem.createMany({ data: dataToCreate });
      }

      return { createdCount: dataToCreate.length, skippedCount };
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}

function assertMonday(date: Date, fieldName: string) {
  if (date.getUTCDay() !== 1) {
    throw new ApiError(400, 'INVALID_WEEK_START', `${fieldName} must align to a Monday.`);
  }
}

function addDaysUtc(date: Date, days: number) {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function buildConflictKey(date: Date, start: string | null, title: string, templateId: string | null) {
  if (templateId) {
    return `TEMPLATE|${templateId}`;
  }

  const normalizedTitle = title.trim().toLowerCase();
  return `DATE|${date.toISOString()}|${start ?? ''}|${normalizedTitle}`;
}
