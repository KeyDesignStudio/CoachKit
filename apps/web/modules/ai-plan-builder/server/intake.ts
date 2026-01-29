import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';

export const intakeDraftSchema = z.object({
  draftJson: z.unknown().optional(),
});

export const intakeSubmitSchema = z.object({
  intakeResponseId: z.string().min(1),
});

export async function getLatestSubmittedIntake(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.athleteIntakeResponse.findFirst({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: 'SUBMITTED',
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createIntakeDraft(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.athleteIntakeResponse.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      status: 'DRAFT',
      draftJson: {},
    },
  });
}

export async function updateIntakeDraft(params: {
  coachId: string;
  athleteId: string;
  intakeResponseId: string;
  draftJson: unknown;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const existing = await prisma.athleteIntakeResponse.findUnique({
    where: { id: params.intakeResponseId },
    select: { id: true, athleteId: true, coachId: true, status: true },
  });

  if (!existing || existing.athleteId !== params.athleteId || existing.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Intake draft not found.');
  }

  if (existing.status !== 'DRAFT') {
    throw new ApiError(409, 'INTAKE_NOT_DRAFT', 'Only DRAFT intake responses can be edited.');
  }

  return prisma.athleteIntakeResponse.update({
    where: { id: existing.id },
    data: {
      draftJson: params.draftJson as Prisma.InputJsonValue,
    },
  });
}

export async function submitIntake(params: { coachId: string; athleteId: string; intakeResponseId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const response = await prisma.athleteIntakeResponse.findUnique({
    where: { id: params.intakeResponseId },
    select: { id: true, athleteId: true, coachId: true, status: true, draftJson: true },
  });

  if (!response || response.athleteId !== params.athleteId || response.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Intake response not found.');
  }

  if (response.status !== 'DRAFT') {
    throw new ApiError(409, 'INTAKE_ALREADY_SUBMITTED', 'This intake response has already been submitted.');
  }

  const draft = response.draftJson ?? {};
  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new ApiError(400, 'INVALID_DRAFT', 'draftJson must be an object.');
  }

  const entries = Object.entries(draft as Record<string, unknown>);

  const submitted = await prisma.$transaction(async (tx) => {
    const updated = await tx.athleteIntakeResponse.update({
      where: { id: response.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    if (entries.length > 0) {
      await tx.intakeEvidence.createMany({
        data: entries.map(([questionKey, answerJson]) => ({
          athleteId: params.athleteId,
          coachId: params.coachId,
          intakeResponseId: response.id,
          questionKey,
          answerJson: answerJson as Prisma.InputJsonValue,
        })),
      });
    }

    return updated;
  });

  return {
    intakeResponse: submitted,
    evidenceCreatedCount: entries.length,
  };
}

export async function listEvidenceForIntake(params: { coachId: string; athleteId: string; intakeResponseId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.intakeEvidence.findMany({
    where: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      intakeResponseId: params.intakeResponseId,
    },
    orderBy: [{ createdAt: 'asc' }, { questionKey: 'asc' }],
  });
}
