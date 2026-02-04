import { mergeBriefInput } from './merge';
import { buildAthleteBriefV1_1 } from './builder';
import type { AthleteBriefJson, AthleteProfileSnapshot } from './types';
import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function ensureAthleteBriefFromSources(params: {
  athleteId: string;
  coachId: string;
  athleteProfile?: AthleteProfileSnapshot | null;
}) {
  const input = mergeBriefInput({
    athleteProfile: params.athleteProfile ?? null,
  });
  const inputHash = computeStableSha256(input);
  const existing = await prisma.athleteBrief.findUnique({
    where: {
      athleteId_inputHash: {
        athleteId: params.athleteId,
        inputHash,
      },
    },
  });

  if (existing) {
    const brief = existing.briefJson as AthleteBriefJson;
    const riskFlags = brief.version === 'v1.1' ? brief.riskFlags ?? [] : brief.risks ?? [];
    return {
      row: existing,
      brief,
      summaryText: null,
      riskFlags,
      sourcesPresent: input.sourcesPresent,
    };
  }

  const { briefJson, summaryText, riskFlags } = buildAthleteBriefV1_1(input);
  const created = await prisma.athleteBrief.create({
    data: {
      athleteId: params.athleteId,
      coachId: params.coachId,
      inputHash,
      briefJson: briefJson as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    row: created,
    brief: briefJson,
    summaryText,
    riskFlags,
    sourcesPresent: input.sourcesPresent,
  };
}
