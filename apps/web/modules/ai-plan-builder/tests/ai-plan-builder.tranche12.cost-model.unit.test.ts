import { describe, expect, it } from 'vitest';

import { estimateCostUsdFromOutputTokens, estimateRollupCost } from '@/modules/ai-plan-builder/admin/cost-model';

describe('AI Plan Builder v1 (Tranche 12: cost model)', () => {
  it('T12.U1 cost estimate is stable and non-negative', () => {
    expect(estimateCostUsdFromOutputTokens({ model: 'mock', outputTokens: 123_000 })).toBe(0);
    expect(estimateCostUsdFromOutputTokens({ model: 'gpt-4o-mini', outputTokens: 0 })).toBe(0);
    expect(estimateCostUsdFromOutputTokens({ model: 'gpt-4o-mini', outputTokens: -10 })).toBe(0);

    const v = estimateCostUsdFromOutputTokens({ model: 'gpt-4o-mini', outputTokens: 1000 });
    expect(v).toBeGreaterThanOrEqual(0);

    // Stable rounding for snapshots/alerts.
    const v2 = estimateCostUsdFromOutputTokens({ model: 'gpt-4o-mini', outputTokens: 1000 });
    expect(v2).toBe(v);
  });

  it('T12.U2 rollup cost uses callCount * maxOutputTokensAvg', () => {
    const r = estimateRollupCost({ model: 'gpt-4o-mini', callCount: 10, maxOutputTokensAvg: 500 });
    expect(r.estimatedOutputTokens).toBe(5000);
    expect(r.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });
});
