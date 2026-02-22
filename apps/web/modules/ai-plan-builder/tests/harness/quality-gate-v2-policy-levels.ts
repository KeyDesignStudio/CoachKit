import type { DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';
import type { QualityGateV2Scenario, QualityGateV2Thresholds } from './quality-gate-v2-scenarios';

export type QualityGateV2PolicyLevel = 'conservative' | 'safe' | 'performance';

export type QualityGateV2PolicyFloors = {
  minScore: number;
  maxHardViolations: number;
  maxSoftWarnings: number;
  minWeeklyMinutesInBandRate: number;
  minKeySessionBandPassRate: number;
  minNonConsecutiveIntensityRate: number;
  minNoLongThenIntensityRate: number;
  minExplainabilityCoverageRate: number;
  minAvailabilityAdherenceRate: number;
  minDoublesComplianceRate: number;
  minIntensityCapComplianceRate: number;
};

const policyFloorsByLevel: Record<QualityGateV2PolicyLevel, QualityGateV2PolicyFloors> = {
  conservative: {
    minScore: 92,
    maxHardViolations: 0,
    maxSoftWarnings: 1,
    minWeeklyMinutesInBandRate: 0.95,
    minKeySessionBandPassRate: 1,
    minNonConsecutiveIntensityRate: 1,
    minNoLongThenIntensityRate: 1,
    minExplainabilityCoverageRate: 1,
    minAvailabilityAdherenceRate: 1,
    minDoublesComplianceRate: 1,
    minIntensityCapComplianceRate: 1,
  },
  safe: {
    minScore: 80,
    maxHardViolations: 0,
    maxSoftWarnings: 5,
    minWeeklyMinutesInBandRate: 0.9,
    minKeySessionBandPassRate: 1,
    minNonConsecutiveIntensityRate: 1,
    minNoLongThenIntensityRate: 0.2,
    minExplainabilityCoverageRate: 1,
    minAvailabilityAdherenceRate: 1,
    minDoublesComplianceRate: 1,
    minIntensityCapComplianceRate: 1,
  },
  performance: {
    minScore: 86,
    maxHardViolations: 0,
    maxSoftWarnings: 4,
    minWeeklyMinutesInBandRate: 0.85,
    minKeySessionBandPassRate: 1,
    minNonConsecutiveIntensityRate: 1,
    minNoLongThenIntensityRate: 0.8,
    minExplainabilityCoverageRate: 1,
    minAvailabilityAdherenceRate: 1,
    minDoublesComplianceRate: 1,
    minIntensityCapComplianceRate: 1,
  },
};

export function resolveQualityGateV2PolicyLevel(setup: DraftPlanSetupV1): QualityGateV2PolicyLevel {
  if (setup.policyProfileId === 'coachkit-conservative-v1') return 'conservative';
  if (setup.policyProfileId === 'coachkit-performance-v1') return 'performance';
  return 'safe';
}

export function policyFloorsForLevel(level: QualityGateV2PolicyLevel): QualityGateV2PolicyFloors {
  return policyFloorsByLevel[level];
}

export function resolveScenarioThresholdsWithPolicyRatchet(params: {
  scenario: QualityGateV2Scenario;
}): {
  policyLevel: QualityGateV2PolicyLevel;
  explicitThresholds: QualityGateV2Thresholds;
  policyFloors: QualityGateV2PolicyFloors;
  effectiveThresholds: QualityGateV2Thresholds;
} {
  const policyLevel = resolveQualityGateV2PolicyLevel(params.scenario.setup);
  const explicitThresholds = params.scenario.thresholds;
  const policyFloors = policyFloorsForLevel(policyLevel);

  const effectiveThresholds: QualityGateV2Thresholds = {
    minScore: Math.max(explicitThresholds.minScore, policyFloors.minScore),
    maxHardViolations: Math.min(explicitThresholds.maxHardViolations, policyFloors.maxHardViolations),
    maxSoftWarnings: Math.min(explicitThresholds.maxSoftWarnings, policyFloors.maxSoftWarnings),
    minWeeklyMinutesInBandRate: Math.max(explicitThresholds.minWeeklyMinutesInBandRate, policyFloors.minWeeklyMinutesInBandRate),
    minKeySessionBandPassRate: Math.max(explicitThresholds.minKeySessionBandPassRate, policyFloors.minKeySessionBandPassRate),
    minNonConsecutiveIntensityRate: Math.max(
      explicitThresholds.minNonConsecutiveIntensityRate,
      policyFloors.minNonConsecutiveIntensityRate
    ),
    minNoLongThenIntensityRate: Math.max(explicitThresholds.minNoLongThenIntensityRate, policyFloors.minNoLongThenIntensityRate),
    minExplainabilityCoverageRate: Math.max(
      explicitThresholds.minExplainabilityCoverageRate,
      policyFloors.minExplainabilityCoverageRate
    ),
    minAvailabilityAdherenceRate: Math.max(explicitThresholds.minAvailabilityAdherenceRate, policyFloors.minAvailabilityAdherenceRate),
    minDoublesComplianceRate: Math.max(explicitThresholds.minDoublesComplianceRate, policyFloors.minDoublesComplianceRate),
    minIntensityCapComplianceRate: Math.max(explicitThresholds.minIntensityCapComplianceRate, policyFloors.minIntensityCapComplianceRate),
  };

  return {
    policyLevel,
    explicitThresholds,
    policyFloors,
    effectiveThresholds,
  };
}
