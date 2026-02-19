import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { assertCoachOwnsTargets } from '@/lib/group-sessions';

export const dynamic = 'force-dynamic';

const idSchema = z.string().cuid().or(z.string().cuid2());

const createSquadTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional().nullable(),
  targetSquadIds: z.array(idSchema).min(1),
  targetPresetJson: z.unknown().optional().nullable(),
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

export async function GET() {
  try {
    const { user } = await requireCoach();

    const squadTemplates = await prisma.squadTemplate.findMany({
      where: { coachId: user.id },
      include: squadTemplateInclude,
      orderBy: [{ updatedAt: 'desc' }],
    });

    return success({ squadTemplates });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = createSquadTemplateSchema.parse(await request.json());
    const targetSquadIds = dedupe(payload.targetSquadIds);

    await assertCoachOwnsTargets(
      user.id,
      targetSquadIds.map((squadId) => ({ squadId }))
    );

    const created = await prisma.$transaction(async (tx) => {
      const template = await tx.squadTemplate.create({
        data: {
          coachId: user.id,
          name: payload.name,
          description: payload.description ?? null,
          targetPresetJson: (payload.targetPresetJson ?? null) as Prisma.InputJsonValue,
        },
      });

      await tx.squadTemplateTarget.createMany({
        data: targetSquadIds.map((squadId) => ({
          squadTemplateId: template.id,
          squadId,
        })),
      });

      return tx.squadTemplate.findUnique({
        where: { id: template.id },
        include: squadTemplateInclude,
      });
    });

    if (!created) {
      throw new ApiError(500, 'SQUAD_TEMPLATE_CREATE_FAILED', 'Failed to load created squad template.');
    }

    return success({ squadTemplate: created }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
