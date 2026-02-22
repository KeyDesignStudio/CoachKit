import { describe, expect, it } from 'vitest';
import { evaluateQualityGateV2Scenario } from './harness/evaluate-quality-gate-v2';
import { qualityGateV2Scenarios } from './harness/quality-gate-v2-scenarios';

describe('ai-plan-builder quality gate v2', () => {
  it('passes expanded golden scenarios with strict safety thresholds', () => {
    for (const scenario of qualityGateV2Scenarios) {
      const result = evaluateQualityGateV2Scenario(scenario);
      const t = scenario.thresholds;

      expect(result.score, `${scenario.id} score`).toBeGreaterThanOrEqual(t.minScore);
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
});
