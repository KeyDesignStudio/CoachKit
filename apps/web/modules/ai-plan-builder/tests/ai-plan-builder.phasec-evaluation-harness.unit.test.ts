import { describe, expect, it } from 'vitest';

import { evaluatePhaseCScenario } from './harness/evaluate-plan-scenario';
import { phaseCGoldenScenarios } from './harness/phasec-golden-scenarios';

describe('ai-plan-builder phase C evaluation harness', () => {
  it('enforces foundational hard constraints across golden scenarios', () => {
    const forbiddenHardCodes = new Set([
      'OFF_DAY_SESSION',
      'MAX_DOUBLES_EXCEEDED',
      'MAX_INTENSITY_DAYS_EXCEEDED',
      'CONSECUTIVE_INTENSITY_DAYS',
      'BEGINNER_RUN_CAP_EXCEEDED',
      'BEGINNER_BRICK_TOO_EARLY',
    ]);

    for (const scenario of phaseCGoldenScenarios) {
      const result = evaluatePhaseCScenario(scenario.setup);

      expect(result.metrics.nonConsecutiveIntensityRate, `${scenario.id} has stacked intensity weeks`).toBeGreaterThanOrEqual(0.75);
      expect(result.metrics.keySessionBandPassRate, `${scenario.id} should preserve key-session structure`).toBeGreaterThanOrEqual(0.75);

      for (const code of result.hardViolationCodes) {
        expect(forbiddenHardCodes.has(code), `${scenario.id} contains forbidden hard violation ${code}`).toBe(false);
      }
    }
  });

  it('regression summary remains stable for golden scenarios', () => {
    const summary = phaseCGoldenScenarios.map((scenario) => {
      const result = evaluatePhaseCScenario(scenario.setup);
      return {
        id: scenario.id,
        description: scenario.description,
        metrics: result.metrics,
        hardViolationCodes: result.hardViolationCodes,
        softWarningCodes: result.softWarningCodes,
        regressionSummary: result.regressionSummary,
      };
    });

    expect(summary).toMatchSnapshot();
  });

  it('event-near taper scenario trends down in final week', () => {
    const taper = phaseCGoldenScenarios.find((s) => s.id === 'event-near-taper');
    expect(taper).toBeTruthy();
    if (!taper) return;

    const result = evaluatePhaseCScenario(taper.setup);
    expect(result.metrics.taperLastWeekDeltaMinutes).not.toBeNull();
    expect(Number(result.metrics.taperLastWeekDeltaMinutes)).toBeLessThanOrEqual(0);
  });
});
