import { describe, expect, it } from 'vitest';

import { evaluateQualityGateV2Scenario } from './harness/evaluate-quality-gate-v2';
import { resolveQualityGateV2PolicyLevel } from './harness/quality-gate-v2-policy-levels';
import { qualityGateV2Scenarios } from './harness/quality-gate-v2-scenarios';

type EvalRow = ReturnType<typeof evaluateQualityGateV2Scenario>;

function avg(rows: EvalRow[], key: keyof EvalRow) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;
}

function min(rows: EvalRow[], key: keyof EvalRow) {
  if (!rows.length) return 0;
  return Math.min(...rows.map((row) => Number(row[key] ?? Number.POSITIVE_INFINITY)));
}

describe('ai-plan-builder quality gate v2 scorecard', () => {
  it('meets global scorecard floors across the expanded scenario pack', () => {
    const rows = qualityGateV2Scenarios.map((scenario) => evaluateQualityGateV2Scenario(scenario));

    const scorecard = {
      scenarioCount: rows.length,
      avgScore: avg(rows, 'score'),
      minScore: min(rows, 'score'),
      avgWeeklyMinutesInBandRate: avg(rows, 'weeklyMinutesInBandRate'),
      avgKeySessionBandPassRate: avg(rows, 'keySessionBandPassRate'),
      avgNonConsecutiveIntensityRate: avg(rows, 'nonConsecutiveIntensityRate'),
      avgNoLongThenIntensityRate: avg(rows, 'noLongThenIntensityRate'),
      avgExplainabilityCoverageRate: avg(rows, 'explainabilityCoverageRate'),
      avgAvailabilityAdherenceRate: avg(rows, 'availabilityAdherenceRate'),
      avgDoublesComplianceRate: avg(rows, 'doublesComplianceRate'),
      avgIntensityCapComplianceRate: avg(rows, 'intensityCapComplianceRate'),
      maxHardViolations: Math.max(...rows.map((row) => Number(row.hardViolationCount ?? 0))),
      maxSoftWarnings: Math.max(...rows.map((row) => Number(row.softWarningCount ?? 0))),
    };

    // Global G2 floors. These protect against broad quality drift in CI.
    expect(scorecard.scenarioCount).toBeGreaterThanOrEqual(9);
    expect(scorecard.avgScore).toBeGreaterThanOrEqual(90);
    expect(scorecard.minScore).toBeGreaterThanOrEqual(80);
    expect(scorecard.avgWeeklyMinutesInBandRate).toBeGreaterThanOrEqual(0.9);
    expect(scorecard.avgKeySessionBandPassRate).toBeGreaterThanOrEqual(0.95);
    expect(scorecard.avgNonConsecutiveIntensityRate).toBeGreaterThanOrEqual(0.95);
    expect(scorecard.avgNoLongThenIntensityRate).toBeGreaterThanOrEqual(0.85);
    expect(scorecard.avgExplainabilityCoverageRate).toBeGreaterThanOrEqual(1);
    expect(scorecard.avgAvailabilityAdherenceRate).toBeGreaterThanOrEqual(1);
    expect(scorecard.avgDoublesComplianceRate).toBeGreaterThanOrEqual(1);
    expect(scorecard.avgIntensityCapComplianceRate).toBeGreaterThanOrEqual(1);
    expect(scorecard.maxHardViolations).toBeLessThanOrEqual(0);
    expect(scorecard.maxSoftWarnings).toBeLessThanOrEqual(5);

    const byPolicyLevel = qualityGateV2Scenarios.reduce<Record<string, EvalRow[]>>((acc, scenario) => {
      const level = resolveQualityGateV2PolicyLevel(scenario.setup);
      acc[level] = acc[level] ?? [];
      acc[level]!.push(evaluateQualityGateV2Scenario(scenario));
      return acc;
    }, {});

    expect((byPolicyLevel.conservative ?? []).length).toBeGreaterThanOrEqual(1);
    expect((byPolicyLevel.safe ?? []).length).toBeGreaterThanOrEqual(1);
    expect((byPolicyLevel.performance ?? []).length).toBeGreaterThanOrEqual(1);
    expect(avg(byPolicyLevel.conservative ?? [], 'score')).toBeGreaterThanOrEqual(95);
    expect(avg(byPolicyLevel.safe ?? [], 'score')).toBeGreaterThanOrEqual(92);
    expect(avg(byPolicyLevel.performance ?? [], 'score')).toBeGreaterThanOrEqual(86);
  });
});
