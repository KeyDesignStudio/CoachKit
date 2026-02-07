import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { GroupVisibilityType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { parseWeeklyRecurrenceRule } from '@/lib/recurrence';
import { assertCoachOwnsTargets, buildTargetsForVisibility, type GroupSessionTargetInput } from '@/lib/group-sessions';

export const dynamic = 'force-dynamic';

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTimeLocal must be HH:MM (24h).' });

const nonEmptyString = z.string().trim().min(1);

const idSchema = z.string().cuid().or(z.string().cuid2());

const updateGroupSessionSchema = z
  .object({
    title: nonEmptyString.optional(),
    discipline: nonEmptyString.optional(),
    location: nonEmptyString.optional().nullable(),
    startTimeLocal: localTime.optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    distanceMeters: z.number().positive().optional().nullable(),
    intensityTarget: z.string().trim().min(1).optional().nullable(),
    tags: z.array(z.string().trim().min(1)).optional(),
    equipment: z.array(z.string().trim().min(1)).optional(),
    workoutStructure: z.unknown().optional().nullable(),
    notes: z.string().trim().max(20000).optional().nullable(),
    description: z.string().trim().max(20000).optional().nullable(),
    recurrenceRule: nonEmptyString.optional(),
    visibilityType: z.nativeEnum(GroupVisibilityType).optional(),
    targetAthleteIds: z.array(idSchema).optional(),
    targetSquadIds: z.array(idSchema).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided.',
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

type RouteParams = {
  params: {
    groupSessionId: string;
  };
};

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    const payload = updateGroupSessionSchema.parse(await request.json());
    const { groupSessionId } = params;

    if (payload.recurrenceRule) {
      parseWeeklyRecurrenceRule(payload.recurrenceRule);
    }

    const existing = await prisma.groupSession.findFirst({
      where: { id: groupSessionId, coachId: user.id },
    });

    if (!existing) {
      throw notFound('Group session not found.');
    }

    const patchData: Prisma.GroupSessionUpdateInput = {};

    if (payload.title !== undefined) {
      patchData.title = payload.title;
    }

    if (payload.discipline !== undefined) {
      patchData.discipline = payload.discipline;
    }

    if (payload.location !== undefined) {
      patchData.location = payload.location ?? null;
    }

    if (payload.startTimeLocal !== undefined) {
      patchData.startTimeLocal = payload.startTimeLocal;
    }

    if (payload.durationMinutes !== undefined) {
      patchData.durationMinutes = payload.durationMinutes;
    }

    if (payload.distanceMeters !== undefined) {
      patchData.distanceMeters = payload.distanceMeters ?? null;
    }

    if (payload.intensityTarget !== undefined) {
      patchData.intensityTarget = payload.intensityTarget ?? null;
    }

    if (payload.tags !== undefined) {
      patchData.tags = payload.tags;
    }

    if (payload.equipment !== undefined) {
      patchData.equipment = payload.equipment;
    }

    if (payload.workoutStructure !== undefined) {
      patchData.workoutStructure = payload.workoutStructure as Prisma.InputJsonValue;
    }

    if (payload.notes !== undefined) {
      patchData.notes = payload.notes ?? null;
    }

    if (payload.description !== undefined) {
      patchData.description = payload.description ?? null;
    }

    if (payload.recurrenceRule !== undefined) {
      patchData.recurrenceRule = payload.recurrenceRule;
    }

    if (payload.visibilityType !== undefined) {
      patchData.visibilityType = payload.visibilityType;
    }

    const shouldReplaceTargets =
      payload.visibilityType !== undefined ||
      payload.targetAthleteIds !== undefined ||
      payload.targetSquadIds !== undefined;

    const updated = await prisma.$transaction(async (tx) => {
      let targetsToApply: GroupSessionTargetInput[] | null = null;

      if (shouldReplaceTargets) {
        const effectiveVisibility = payload.visibilityType ?? existing.visibilityType;
        targetsToApply = buildTargetsForVisibility(
          effectiveVisibility,
          payload.targetAthleteIds,
          payload.targetSquadIds,
        );

        await assertCoachOwnsTargets(user.id, targetsToApply);
      }

      await tx.groupSession.update({
        where: { id: existing.id },
        data: patchData,
      });

      if (targetsToApply) {
        await tx.groupSessionTarget.deleteMany({ where: { groupSessionId: existing.id } });

        if (targetsToApply.length) {
          await tx.groupSessionTarget.createMany({
            data: targetsToApply.map((target) => ({
              groupSessionId: existing.id,
              athleteId: target.athleteId ?? null,
              squadId: target.squadId ?? null,
            })),
          });
        }
      }

      return tx.groupSession.findUnique({ where: { id: existing.id }, include: groupSessionInclude });
    });

    if (!updated) {
      throw new ApiError(500, 'GROUP_SESSION_UPDATE_FAILED', 'Failed to load updated group session.');
    }

    return success({ groupSession: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    const { groupSessionId } = params;

    const existing = await prisma.groupSession.findFirst({ where: { id: groupSessionId, coachId: user.id } });

    if (!existing) {
      throw notFound('Group session not found.');
    }

    await prisma.groupSession.delete({ where: { id: existing.id } });

    return success({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
