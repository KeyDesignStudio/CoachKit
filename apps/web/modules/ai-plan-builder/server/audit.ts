import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const createAuditSchema = z.object({
  eventType: z.string().trim().min(1),
  proposalId: z.string().min(1).optional(),
  diffJson: z.unknown().optional(),
});

export async function createPlanChangeAudit(params: {
  coachId: string;
  athleteId: string;
  eventType: string;
  proposalId?: string;
  diffJson?: unknown;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.planChangeAudit.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      eventType: params.eventType,
      proposalId: params.proposalId ?? null,
      diffJson: (params.diffJson ?? null) as Prisma.InputJsonValue,
    },
  });
}
