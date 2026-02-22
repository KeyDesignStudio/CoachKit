import { describe, expect, it } from 'vitest';

import { evaluateQualityGateReadiness, evaluateUatReadiness } from '@/modules/ai-plan-builder/admin/readiness';

describe('ai-plan-builder J2 readiness telemetry', () => {
  it('reports quality gate readiness from the expanded scenario pack', () => {
    const result = evaluateQualityGateReadiness();
    expect(result.scenarioCount).toBeGreaterThanOrEqual(9);
    expect(result.status).toBe('PASS');
    expect(result.failingScenarios).toHaveLength(0);
  });

  it('parses UAT CSV and returns release-gate readiness', async () => {
    const result = await evaluateUatReadiness();
    expect(result.recordCount).toBeGreaterThanOrEqual(14);
    expect(result.missingCases).toHaveLength(0);
    expect(result.hasBlockingSeverity).toBe(false);
    expect(result.hasFailures).toBe(false);
    expect(result.status).toBe('PASS');
  });
});
