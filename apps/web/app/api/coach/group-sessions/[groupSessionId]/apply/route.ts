import { NextRequest } from 'next/server';
import { CalendarItemStatus, GroupVisibilityType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { expandWeeklyOccurrences } from '@/lib/recurrence';

export const dynamic = 'force-dynamic';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Dates must be YYYY-MM-DD.' });

const applySchema = z.object({
  from: dateOnly,
  to: dateOnly,
});

type RouteParams = {
  params: {
    groupSessionId: string;
  };
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    const payload = applySchema.parse(await request.json());

    const fromDate = parseDateOnly(payload.from, 'from');
    const toDate = parseDateOnly(payload.to, 'to');
    assertValidDateRange(fromDate, toDate);

    const groupSession = await prisma.groupSession.findFirst({
      where: { id: params.groupSessionId, coachId: user.id },
      include: { targets: true },
    });

    if (!groupSession) {
      throw notFound('Group session not found.');
    }

    const occurrences = expandWeeklyOccurrences(groupSession.recurrenceRule, fromDate, toDate);

    if (!occurrences.length) {
      return success({ createdCount: 0, skippedExistingCount: 0, createdIds: [] });
    }

    const targetAthleteIds = await resolveTargetAthletes(groupSession, user.id);

    if (!targetAthleteIds.length) {
      throw new ApiError(400, 'NO_TARGET_ATHLETES', 'No athletes matched the group session targets.');
    }

    const combos = buildApplyCombos(targetAthleteIds, occurrences);

    const result = await prisma.$transaction(async (tx) => {
      const existingItems = await tx.calendarItem.findMany({
        where: {
          coachId: user.id,
          groupSessionId: groupSession.id,
          athleteId: { in: targetAthleteIds },
          date: { gte: fromDate, lte: toDate },
        },
        select: { athleteId: true, date: true, plannedStartTimeLocal: true },
      });

      const existingKeys = new Set(
        existingItems.map((item) => buildCalendarKey(item.athleteId, item.date, item.plannedStartTimeLocal)),
      );

      const createdIds: string[] = [];
      let skippedExistingCount = 0;

      for (const combo of combos) {
        const key = buildCalendarKey(combo.athleteId, combo.date, groupSession.startTimeLocal);

        if (existingKeys.has(key)) {
          skippedExistingCount += 1;
          continue;
        }

        const created = await tx.calendarItem.create({
          data: {
            coachId: user.id,
            athleteId: combo.athleteId,
            date: combo.date,
            plannedStartTimeLocal: groupSession.startTimeLocal,
            plannedDurationMinutes: groupSession.durationMinutes,
            discipline: groupSession.discipline,
            title: groupSession.title,
            workoutDetail: groupSession.description ?? null,
            groupSessionId: groupSession.id,
            status: CalendarItemStatus.PLANNED,
          },
          select: { id: true },
        });

        existingKeys.add(key);
        createdIds.push(created.id);
      }

      return {
        createdCount: createdIds.length,
        skippedExistingCount,
        createdIds,
      };
    });

    return success(result);
  } catch (error) {
    return handleError(error);
  }
}

function buildApplyCombos(athleteIds: string[], occurrences: Date[]) {
  return athleteIds.flatMap((athleteId) =>
    occurrences.map((date) => ({
      athleteId,
      date,
    })),
  );
}

async function resolveTargetAthletes(groupSession: {
  id: string;
  coachId: string;
  visibilityType: GroupVisibilityType;
  targets: Array<{ athleteId: string | null; squadId: string | null }>;
}, coachId: string) {
  if (groupSession.visibilityType === GroupVisibilityType.ALL) {
    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId },
      select: { userId: true },
    });

    return athletes.map((athlete) => athlete.userId);
  }

  if (groupSession.visibilityType === GroupVisibilityType.SELECTED) {
    const athleteIds = groupSession.targets.map((target) => target.athleteId).filter((value): value is string => Boolean(value));

    if (!athleteIds.length) {
      throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'Group session has no selected athletes.');
    }

    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId, userId: { in: athleteIds } },
      select: { userId: true },
    });

    if (athletes.length !== athleteIds.length) {
      throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'One or more selected athletes no longer exist.');
    }

    return athletes.map((athlete) => athlete.userId);
  }

  const squadIds = groupSession.targets.map((target) => target.squadId).filter((value): value is string => Boolean(value));

  if (!squadIds.length) {
    throw new ApiError(400, 'INVALID_GROUP_SESSION_TARGETS', 'Group session has no squad targets.');
  }

  const squadMembers = await prisma.squadMember.findMany({
    where: { squadId: { in: squadIds } },
    select: { athleteId: true },
  });

  const athleteIds = Array.from(new Set(squadMembers.map((member) => member.athleteId)));

  if (!athleteIds.length) {
    throw new ApiError(400, 'NO_TARGET_ATHLETES', 'No athletes belong to the targeted squads.');
  }

  return athleteIds;
}

function buildCalendarKey(athleteId: string, date: Date, startTimeLocal: string | null) {
  return `${athleteId}|${date.toISOString()}|${startTimeLocal ?? ''}`;
}
