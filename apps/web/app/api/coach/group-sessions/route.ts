import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { GroupVisibilityType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { parseWeeklyRecurrenceRule } from '@/lib/recurrence';
import { assertCoachOwnsTargets, buildTargetsForVisibility } from '@/lib/group-sessions';

export const dynamic = 'force-dynamic';

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTimeLocal must be HH:MM (24h).' });

const nonEmptyString = z.string().trim().min(1);

const createGroupSessionSchema = z.object({
  title: nonEmptyString,
  discipline: nonEmptyString,
  location: nonEmptyString.optional(),
  startTimeLocal: localTime,
  durationMinutes: z.number().int().min(1).max(600),
  distanceMeters: z.number().positive().optional().nullable(),
  intensityTarget: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional().default([]),
  equipment: z.array(z.string().trim().min(1)).optional().default([]),
  workoutStructure: z.unknown().optional().nullable(),
  notes: z.string().trim().max(20000).optional().nullable(),
  description: z.string().trim().max(20000).optional(),
  recurrenceRule: nonEmptyString,
  visibilityType: z.nativeEnum(GroupVisibilityType).default(GroupVisibilityType.ALL),
  optionalFlag: z.boolean().optional().default(false),
  targetAthleteIds: z.array(z.string().cuid()).optional(),
  targetSquadIds: z.array(z.string().cuid()).optional(),
});

const groupSessionInclude = {
  targets: {
    include: {
      athlete: {
        include: {
          user: true,
        },
      },
      squad: true,
    },
  },
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();

    const groupSessions = await prisma.groupSession.findMany({
      where: { coachId: user.id },
      include: groupSessionInclude,
      orderBy: { createdAt: 'desc' },
    });

    return success({ groupSessions });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = createGroupSessionSchema.parse(await request.json());

    parseWeeklyRecurrenceRule(payload.recurrenceRule);

    const targets = buildTargetsForVisibility(
      payload.visibilityType ?? GroupVisibilityType.ALL,
      payload.targetAthleteIds,
      payload.targetSquadIds,
    );

    await assertCoachOwnsTargets(user.id, targets);

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.groupSession.create({
        data: {
          coachId: user.id,
          title: payload.title,
          discipline: payload.discipline,
          location: payload.location ?? null,
          startTimeLocal: payload.startTimeLocal,
          durationMinutes: payload.durationMinutes,
          distanceMeters: payload.distanceMeters ?? null,
          intensityTarget: payload.intensityTarget ?? null,
          tags: payload.tags ?? [],
          equipment: payload.equipment ?? [],
          workoutStructure: (payload.workoutStructure ?? null) as Prisma.InputJsonValue,
          notes: payload.notes ?? null,
          description: payload.description ?? null,
          recurrenceRule: payload.recurrenceRule,
          visibilityType: payload.visibilityType,
          optionalFlag: payload.optionalFlag ?? false,
        },
      });

      if (targets.length) {
        await tx.groupSessionTarget.createMany({
          data: targets.map((target) => ({
            groupSessionId: created.id,
            athleteId: target.athleteId ?? null,
            squadId: target.squadId ?? null,
          })),
        });
      }

      return tx.groupSession.findUnique({
        where: { id: created.id },
        include: groupSessionInclude,
      });
    });

    if (!result) {
      throw new ApiError(500, 'GROUP_SESSION_CREATE_FAILED', 'Failed to load created group session.');
    }

    return success({ groupSession: result }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
