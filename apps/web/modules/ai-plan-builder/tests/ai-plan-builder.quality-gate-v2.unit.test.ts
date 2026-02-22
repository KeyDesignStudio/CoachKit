import { describe, expect, it } from 'vitest';
import { evaluateQualityGateV2Scenario } from './harness/evaluate-quality-gate-v2';
import { resolveScenarioThresholdsWithPolicyRatchet } from './harness/quality-gate-v2-policy-levels';
import { qualityGateV2Scenarios } from './harness/quality-gate-v2-scenarios';

describe('ai-plan-builder quality gate v2', () => {
  it('passes expanded golden scenarios with strict safety thresholds', () => {
    for (const scenario of qualityGateV2Scenarios) {
      const result = evaluateQualityGateV2Scenario(scenario);
      const thresholdResolution = resolveScenarioThresholdsWithPolicyRatchet({ scenario });
      const t = thresholdResolution.effectiveThresholds;

      expect(result.score, `${scenario.id} score (${thresholdResolution.policyLevel})`).toBeGreaterThanOrEqual(t.minScore);
      expect(result.hardViolationCount, `${scenario.id} hard violations`).toBeLessThanOrEqual(t.maxHardViolations);
      expect(result.softWarningCount, `${scenario.id} soft warnings`).toBeLessThanOrEqual(t.maxSoftWarnings);
      expect(result.weeklyMinutesInBandRate, `${scenario.id} weekly minutes in-band rate`).toBeGreaterThanOrEqual(t.minWeeklyMinutesInBandRate);
      expect(result.keySessionBandPassRate, `${scenario.id} key-session band pass rate`).toBeGreaterThanOrEqual(t.minKeySessionBandPassRate);
      expect(result.nonConsecutiveIntensityRate, `${scenario.id} non-consecutive intensity rate`).toBeGreaterThanOrEqual(
        t.minNonConsecutiveIntensityRate
      );
      expect(result.noLongThenIntensityRate, `${scenario.id} long-then-intensity spacing rate`).toBeGreaterThanOrEqual(
        t.minNoLongThenIntensityRate
      );
      expect(result.explainabilityCoverageRate, `${scenario.id} explainability coverage`).toBeGreaterThanOrEqual(
        t.minExplainabilityCoverageRate
      );
      expect(result.availabilityAdherenceRate, `${scenario.id} availability adherence rate`).toBeGreaterThanOrEqual(
        t.minAvailabilityAdherenceRate
      );
      expect(result.doublesComplianceRate, `${scenario.id} doubles compliance rate`).toBeGreaterThanOrEqual(
        t.minDoublesComplianceRate
      );
      expect(result.intensityCapComplianceRate, `${scenario.id} intensity cap compliance rate`).toBeGreaterThanOrEqual(
        t.minIntensityCapComplianceRate
      );

      if (scenario.evidence?.minWeekCount != null) {
        expect(result.weekCount, `${scenario.id} min week count`).toBeGreaterThanOrEqual(scenario.evidence.minWeekCount);
      }
      if (scenario.evidence?.minTotalSessions != null) {
        expect(result.totalSessionCount, `${scenario.id} min total session count`).toBeGreaterThanOrEqual(scenario.evidence.minTotalSessions);
      }
      if (scenario.evidence?.maxSessionsOnAnyDay != null) {
        expect(result.maxSessionsOnAnyDay, `${scenario.id} max sessions on any day`).toBeLessThanOrEqual(
          scenario.evidence.maxSessionsOnAnyDay
        );
      }
      for (const code of scenario.evidence?.forbiddenHardViolationCodes ?? []) {
        expect(result.hardViolationCodes, `${scenario.id} hard violation code ${code}`).not.toContain(code);
      }
      for (const code of scenario.evidence?.forbiddenSoftWarningCodes ?? []) {
        expect(result.softWarningCodes, `${scenario.id} soft warning code ${code}`).not.toContain(code);
      }
    }
  });

  it('keeps event-near taper trending down in final week', () => {
    const taper = qualityGateV2Scenarios.find((s) => s.id === 'event-near-taper');
    expect(taper).toBeTruthy();
    if (!taper) return;

    const result = evaluateQualityGateV2Scenario(taper);
    expect(result.taperLastWeekDeltaMinutes).not.toBeNull();
    expect(Number(result.taperLastWeekDeltaMinutes)).toBeLessThanOrEqual(0);
  });

  it('ratchets each scenario threshold with policy-level floors', () => {
    for (const scenario of qualityGateV2Scenarios) {
      const resolution = resolveScenarioThresholdsWithPolicyRatchet({ scenario });
      const explicit = resolution.explicitThresholds;
      const effective = resolution.effectiveThresholds;
      const floors = resolution.policyFloors;

      expect(effective.minScore, `${scenario.id} minScore ratchet`).toBe(Math.max(explicit.minScore, floors.minScore));
      expect(effective.maxHardViolations, `${scenario.id} maxHardViolations ratchet`).toBe(
        Math.min(explicit.maxHardViolations, floors.maxHardViolations)
      );
      expect(effective.maxSoftWarnings, `${scenario.id} maxSoftWarnings ratchet`).toBe(
        Math.min(explicit.maxSoftWarnings, floors.maxSoftWarnings)
      );
      expect(effective.minWeeklyMinutesInBandRate, `${scenario.id} minWeeklyMinutesInBandRate ratchet`).toBe(
        Math.max(explicit.minWeeklyMinutesInBandRate, floors.minWeeklyMinutesInBandRate)
      );
      expect(effective.minNoLongThenIntensityRate, `${scenario.id} minNoLongThenIntensityRate ratchet`).toBe(
        Math.max(explicit.minNoLongThenIntensityRate, floors.minNoLongThenIntensityRate)
      );
    }
  });
});
