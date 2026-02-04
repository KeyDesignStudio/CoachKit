import { mergeBriefInput } from './merge';
import { buildAthleteBriefV1_1 } from './builder';
import type { AthleteBriefJson, AthleteProfileSnapshot } from './types';
import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';

export async function ensureAthleteBriefFromSources(params: {
  athleteId: string;
  coachId: string;
  athleteProfile?: AthleteProfileSnapshot | null;
}) {
  const input = mergeBriefInput({
    athleteProfile: params.athleteProfile ?? null,
  });
  const inputHash = computeStableSha256(input);
  const { briefJson, summaryText, riskFlags } = buildAthleteBriefV1_1(input);
  const normalizedBrief = {
    ...briefJson,
    generatedAt: inputHash,
    updatedAt: inputHash,
  } as AthleteBriefJson;

  return {
    row: null,
    brief: normalizedBrief,
    summaryText,
    riskFlags,
    sourcesPresent: input.sourcesPresent,
  };
}
