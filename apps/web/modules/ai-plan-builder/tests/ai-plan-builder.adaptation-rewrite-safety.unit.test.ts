import { describe, expect, it } from 'vitest';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';
import { rewriteProposalDiffForSafeApply } from '@/modules/ai-plan-builder/server/adaptation-action-engine';

describe('adaptation rewrite safety', () => {
  const setup = { startDate: '2026-01-01', weekStart: 'monday' as const };
  const sessions = [
    { id: 'past-session', weekIndex: 0, type: 'endurance', durationMinutes: 60 },
    { id: 'future-session', weekIndex: 999, type: 'endurance', durationMinutes: 60 },
  ];

  it('drops past-week and remove operations and clamps volume deltas', () => {
    const diff: PlanDiffOp[] = [
      { op: 'REMOVE_SESSION', draftSessionId: 'future-session' },
      { op: 'ADJUST_WEEK_VOLUME', weekIndex: 0, pctDelta: 0.5 },
      { op: 'ADJUST_WEEK_VOLUME', weekIndex: 999, pctDelta: 0.5 },
      { op: 'ADJUST_WEEK_VOLUME', weekIndex: 999, pctDelta: -0.9 },
    ];
    const result = rewriteProposalDiffForSafeApply({
      setup,
      sessions,
      diff,
      triggerTypes: ['HIGH_COMPLIANCE'],
    });

    expect(result.diff.some((op) => op.op === 'REMOVE_SESSION')).toBe(false);
    const weekOps = result.diff.filter((op) => op.op === 'ADJUST_WEEK_VOLUME');
    expect(weekOps.length).toBe(2);
    expect((weekOps[0] as any).pctDelta).toBeLessThanOrEqual(0.12);
    expect((weekOps[1] as any).pctDelta).toBeGreaterThanOrEqual(-0.2);
    expect(result.droppedOps).toBeGreaterThanOrEqual(1);
  });

  it('prevents protective intensity escalation and caps duration patches', () => {
    const diff: PlanDiffOp[] = [
      { op: 'SWAP_SESSION_TYPE', draftSessionId: 'future-session', newType: 'threshold' },
      {
        op: 'UPDATE_SESSION',
        draftSessionId: 'future-session',
        patch: { type: 'tempo', durationMinutes: 200 },
      },
    ];
    const result = rewriteProposalDiffForSafeApply({
      setup,
      sessions,
      diff,
      triggerTypes: ['SORENESS'],
    });

    const swap = result.diff.find((op) => op.op === 'SWAP_SESSION_TYPE') as Extract<PlanDiffOp, { op: 'SWAP_SESSION_TYPE' }> | undefined;
    expect(swap?.newType).toBe('endurance');

    const update = result.diff.find((op) => op.op === 'UPDATE_SESSION') as Extract<PlanDiffOp, { op: 'UPDATE_SESSION' }> | undefined;
    expect(update?.patch.type).toBe('endurance');
    // 60min baseline with 25% cap => max 75
    expect(update?.patch.durationMinutes).toBe(75);
  });
});
