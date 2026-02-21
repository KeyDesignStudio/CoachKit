import { describe, expect, it } from 'vitest';

import { evaluateProposalHardSafety, summarizeProposalAction } from '@/modules/ai-plan-builder/server/adaptation-action-engine';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';

describe('adaptation action engine hard safety', () => {
  const setup = { startDate: '2026-01-01', weekStart: 'monday' as const };
  const sessions = [
    { id: 's1', weekIndex: 3, type: 'endurance', durationMinutes: 60 },
    { id: 's2', weekIndex: 3, type: 'tempo', durationMinutes: 45 },
    { id: 's3', weekIndex: 4, type: 'endurance', durationMinutes: 70 },
  ];

  it('blocks removals and oversized week volume increases', () => {
    const diff: PlanDiffOp[] = [
      { op: 'REMOVE_SESSION', draftSessionId: 's1' },
      { op: 'ADJUST_WEEK_VOLUME', weekIndex: 4, pctDelta: 0.2 },
    ];
    const review = evaluateProposalHardSafety({
      setup,
      sessions,
      diff,
      triggerTypes: ['HIGH_COMPLIANCE'],
    });
    expect(review.ok).toBe(false);
    expect(review.reasons.some((r) => r.includes('Removing sessions'))).toBe(true);
    expect(review.reasons.some((r) => r.includes('+12%'))).toBe(true);
  });

  it('blocks protective trigger intensity escalation', () => {
    const diff: PlanDiffOp[] = [{ op: 'SWAP_SESSION_TYPE', draftSessionId: 's1', newType: 'threshold' }];
    const review = evaluateProposalHardSafety({
      setup,
      sessions,
      diff,
      triggerTypes: ['SORENESS'],
    });
    expect(review.ok).toBe(false);
    expect(review.reasons.some((r) => r.includes('cannot escalate'))).toBe(true);
  });

  it('produces stable coach summary text', () => {
    const summary = summarizeProposalAction({
      triggerTypes: ['TOO_HARD', 'SORENESS'],
      metrics: {
        totalDurationDeltaMinutes: -20,
        updateCount: 1,
        swapCount: 2,
        weekVolumeAdjustments: [{ weekIndex: 4, pctDelta: -0.1 }],
        removeCount: 0,
        noteCount: 2,
      },
    });
    expect(summary).toContain('Why: TOO_HARD, SORENESS');
    expect(summary).toContain('W5 -10%');
    expect(summary).toContain('-20 min total duration');
  });
});
