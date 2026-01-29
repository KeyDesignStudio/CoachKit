import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';

import { requireAiPlanBuilderV1Enabled } from './flag';
import { computeEvidenceHash } from '../rules/evidence-hash';
import { extractProfileDeterministic } from '../rules/profile-extractor';

export const extractProfileSchema = z.object({
  intakeResponseId: z.string().min(1),
});

export const updateCoachOverridesSchema = z.object({
  profileId: z.string().min(1),
  coachOverridesJson: z.unknown(),
});

export const approveProfileSchema = z.object({
  profileId: z.string().min(1),
});

export async function extractAiProfileFromIntake(params: {
  coachId: string;
  athleteId: string;
  intakeResponseId: string;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const intake = await prisma.athleteIntakeResponse.findUnique({
    where: { id: params.intakeResponseId },
    select: { id: true, athleteId: true, coachId: true, status: true },
  });

  if (!intake || intake.athleteId !== params.athleteId || intake.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'Intake response not found.');
  }

  if (intake.status !== 'SUBMITTED') {
    throw new ApiError(409, 'INTAKE_NOT_SUBMITTED', 'Intake must be submitted before extraction.');
  }

  const evidence = await prisma.intakeEvidence.findMany({
    where: { intakeResponseId: intake.id, athleteId: params.athleteId },
    select: { questionKey: true, answerJson: true },
    orderBy: [{ questionKey: 'asc' }],
  });

  const evidenceHash = computeEvidenceHash(evidence);

  const existing = await prisma.athleteProfileAI.findUnique({
    where: { athleteId_evidenceHash: { athleteId: params.athleteId, evidenceHash } },
  });

  if (existing) {
    return { profile: existing, evidenceHash, wasCreated: false };
  }

  const extracted = extractProfileDeterministic(evidence);

  const created = await prisma.athleteProfileAI.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      evidenceHash,
      extractedProfileJson: extracted.profileJson as Prisma.InputJsonValue,
      extractedSummaryText: extracted.summaryText,
      extractedFlagsJson: extracted.flags as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
    },
  });

  return { profile: created, evidenceHash, wasCreated: true };
}

export async function updateAiProfileCoachOverrides(params: {
  coachId: string;
  athleteId: string;
  profileId: string;
  coachOverridesJson: unknown;
}) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const existing = await prisma.athleteProfileAI.findUnique({
    where: { id: params.profileId },
    select: { id: true, athleteId: true, coachId: true },
  });

  if (!existing || existing.athleteId !== params.athleteId || existing.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'AI profile not found.');
  }

  return prisma.athleteProfileAI.update({
    where: { id: existing.id },
    data: {
      coachOverridesJson: params.coachOverridesJson as Prisma.InputJsonValue,
    },
  });
}

export async function approveAiProfile(params: { coachId: string; athleteId: string; profileId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const existing = await prisma.athleteProfileAI.findUnique({
    where: { id: params.profileId },
    select: { id: true, athleteId: true, coachId: true, status: true },
  });

  if (!existing || existing.athleteId !== params.athleteId || existing.coachId !== params.coachId) {
    throw new ApiError(404, 'NOT_FOUND', 'AI profile not found.');
  }

  if (existing.status !== 'DRAFT') {
    return prisma.athleteProfileAI.findUniqueOrThrow({ where: { id: existing.id } });
  }

  return prisma.athleteProfileAI.update({
    where: { id: existing.id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
    },
  });
}

export async function getLatestAiProfile(params: { coachId: string; athleteId: string }) {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  return prisma.athleteProfileAI.findFirst({
    where: { athleteId: params.athleteId, coachId: params.coachId },
    orderBy: [{ createdAt: 'desc' }],
  });
}
