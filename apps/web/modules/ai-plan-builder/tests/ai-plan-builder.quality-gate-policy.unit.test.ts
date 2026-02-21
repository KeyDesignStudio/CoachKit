import { describe, expect, it } from 'vitest';

import { evaluateDraftQualityGate } from '@/modules/ai-plan-builder/rules/constraint-validator';
import { resolvePlanningPolicyProfile } from '@/modules/ai-plan-builder/rules/policy-registry';
import type { DraftPlanSetupV1, DraftPlanV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

function baseSetup(): DraftPlanSetupV1 {
  return {
    weekStart: 'monday',
    startDate: '2026-02-02',
    eventDate: '2026-03-16',
    weeksToEvent: 6,
    weeklyAvailabilityDays: [1, 2, 3, 4, 6],
    weeklyAvailabilityMinutes: 300,
    disciplineEmphasis: 'balanced',
    riskTolerance: 'med',
    maxIntensityDaysPerWeek: 2,
    maxDoublesPerWeek: 1,
    coachGuidanceText: 'Intermediate athlete',
    policyProfileId: 'coachkit-safe-v1',
  };
}

function draftForMinutes(totalMinutes: number): DraftPlanV1 {
  return {
    version: 'v1',
    setup: baseSetup(),
    weeks: [
      {
        weekIndex: 0,
        locked: false,
        sessions: [
          { weekIndex: 0, ordinal: 0, dayOfWeek: 1, discipline: 'run', type: 'endurance', durationMinutes: Math.max(20, totalMinutes), locked: false },
        ],
      },
    ],
  };
}

describe('quality-gate policy', () => {
  it('classifies moderate minute-band deviation as soft warning in safe profile', () => {
    const setup = baseSetup();
    const draft = draftForMinutes(380);
    const result = evaluateDraftQualityGate({ setup, draft });
    expect(result.profileId).toBe('coachkit-safe-v1');
    expect(result.softWarnings.some((v) => v.code === 'WEEKLY_MINUTES_OUT_OF_BOUNDS')).toBe(true);
  });

  it('classifies severe minute-band deviation as hard violation', () => {
    const setup = baseSetup();
    const draft = draftForMinutes(95);
    const result = evaluateDraftQualityGate({ setup, draft });
    expect(result.hardViolations.some((v) => v.code === 'WEEKLY_MINUTES_OUT_OF_BOUNDS')).toBe(true);
  });

  it('resolves conservative profile from explicit setup policy id', () => {
    const profile = resolvePlanningPolicyProfile({ policyProfileId: 'coachkit-conservative-v1', riskTolerance: 'high' });
    expect(profile.id).toBe('coachkit-conservative-v1');
    expect(profile.maxIntensityDaysHardCap).toBe(1);
  });
});

