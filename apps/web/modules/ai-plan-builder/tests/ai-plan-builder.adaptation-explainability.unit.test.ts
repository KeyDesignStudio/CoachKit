import { describe, expect, it } from 'vitest';

import { assessTriggerQuality, buildReasonChain } from '@/modules/ai-plan-builder/server/adaptation-explainability';

describe('adaptation explainability', () => {
  it('ranks triggers by confidence and keeps high-impact sets queueable', () => {
    const assessment = assessTriggerQuality([
      { id: 't1', triggerType: 'SORENESS', evidenceJson: { sorenessCount: 2 } },
      { id: 't2', triggerType: 'HIGH_COMPLIANCE', evidenceJson: { compliance: 0.82, totalFeedbackCount: 8 } },
    ]);
    expect(assessment.ranked.length).toBe(2);
    expect(assessment.ranked[0]?.triggerType).toBe('SORENESS');
    expect(assessment.shouldQueue).toBe(true);
  });

  it('suppresses low-confidence, low-impact noisy trigger sets', () => {
    const assessment = assessTriggerQuality([{ id: 't1', triggerType: 'HIGH_COMPLIANCE', evidenceJson: { compliance: 0.55, totalFeedbackCount: 1 } }]);
    expect(assessment.shouldQueue).toBe(false);
    expect(String(assessment.suppressionReason ?? '')).toContain('suppressing');
  });

  it('builds reason chain in signal -> trigger -> action -> effect format', () => {
    const reasonChain = buildReasonChain({
      ranked: [
        {
          triggerId: 't1',
          triggerType: 'TOO_HARD',
          confidence: 0.71,
          impact: 'high',
          reason: '3 sessions reported as too hard.',
        },
      ],
      actionSummary: 'Why: TOO_HARD. Changed: week volume (W3 -10%).',
    });

    expect(reasonChain).toHaveLength(4);
    expect(reasonChain[0]).toMatch(/^Signal:/);
    expect(reasonChain[1]).toMatch(/^Trigger:/);
    expect(reasonChain[2]).toMatch(/^Action:/);
    expect(reasonChain[3]).toMatch(/^Expected effect:/);
  });
});
