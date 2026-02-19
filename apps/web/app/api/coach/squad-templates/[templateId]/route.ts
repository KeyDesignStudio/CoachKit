import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { GroupVisibilityType } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { assertCoachOwnsTargets } from '@/lib/group-sessions';

export const dynamic = 'force-dynamic';

const idSchema = z.string().cuid().or(z.string().cuid2());
const weekdaySchema = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTimeLocal must be HH:MM (24h).' });
const targetPresetSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    discipline: z.string().trim().min(1).max(100).optional(),
    location: z.string().trim().max(200).optional(),
    locationLat: z.number().min(-90).max(90).optional().nullable(),
    locationLon: z.number().min(-180).max(180).optional().nullable(),
    startTimeLocal: localTimeSchema.optional(),
    durationMinutes: z.number().int().min(1).max(600).optional(),
    description: z.string().trim().max(20000).optional(),
    visibilityType: z.nativeEnum(GroupVisibilityType).optional(),
    selectedDays: z.array(weekdaySchema).min(1).max(7).optional(),
    targetAthleteIds: z.array(idSchema).max(200).optional(),
  })
  .strict();

const updateSquadTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    targetSquadIds: z.array(idSchema).min(1).max(200).optional(),
    targetPresetJson: targetPresetSchema.optional().nullable(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided.',
  });

const squadTemplateInclude = {
  targets: {
    include: {
      squad: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.SquadTemplateInclude;

function dedupe(ids: string[]) {
  return Array.from(new Set(ids.map((v) => v.trim()).filter(Boolean)));
}

type RouteParams = {
  params: {
    templateId: string;
  };
};

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    idSchema.parse(params.templateId);
    const payload = updateSquadTemplateSchema.parse(await request.json());

    const existing = await prisma.squadTemplate.findFirst({
      where: {
        id: params.templateId,
        coachId: user.id,
      },
      select: { id: true },
    });

    if (!existing) {
      throw notFound('Squad template not found.');
    }

    const patchData: Prisma.SquadTemplateUpdateInput = {};
    if (payload.name !== undefined) {
      patchData.name = payload.name;
    }
    if (payload.description !== undefined) {
      patchData.description = payload.description ?? null;
    }
    if (payload.targetPresetJson !== undefined) {
      patchData.targetPresetJson = (payload.targetPresetJson ?? null) as Prisma.InputJsonValue;
    }

    const targetSquadIds = payload.targetSquadIds ? dedupe(payload.targetSquadIds) : null;
    if (targetSquadIds) {
      await assertCoachOwnsTargets(
        user.id,
        targetSquadIds.map((squadId) => ({ squadId }))
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.squadTemplate.update({
        where: { id: existing.id },
        data: patchData,
      });

      if (targetSquadIds) {
        await tx.squadTemplateTarget.deleteMany({
          where: { squadTemplateId: existing.id },
        });

        await tx.squadTemplateTarget.createMany({
          data: targetSquadIds.map((squadId) => ({
            squadTemplateId: existing.id,
            squadId,
          })),
        });
      }

      return tx.squadTemplate.findUnique({
        where: { id: existing.id },
        include: squadTemplateInclude,
      });
    });

    if (!updated) {
      throw new ApiError(500, 'SQUAD_TEMPLATE_UPDATE_FAILED', 'Failed to load updated squad template.');
    }

    return success({ squadTemplate: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { user } = await requireCoach();
    idSchema.parse(params.templateId);

    const existing = await prisma.squadTemplate.findFirst({
      where: {
        id: params.templateId,
        coachId: user.id,
      },
      select: { id: true },
    });

    if (!existing) {
      throw notFound('Squad template not found.');
    }

    await prisma.squadTemplate.delete({
      where: { id: existing.id },
    });

    return success({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
