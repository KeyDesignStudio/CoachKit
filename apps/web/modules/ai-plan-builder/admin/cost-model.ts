export type CostModelRate = {
  costPer1kOutputTokensUsd: number;
};

// Directional estimates only (not billing-grade). Update as needed.
// Output tokens are estimated from stored token caps; input tokens are ignored in v1.
const MODEL_RATES: Record<string, CostModelRate> = {
  // OpenAI-family names (examples)
  'gpt-4o-mini': { costPer1kOutputTokensUsd: 0.0006 },
  'gpt-4.1-mini': { costPer1kOutputTokensUsd: 0.0012 },
  'gpt-4.1': { costPer1kOutputTokensUsd: 0.0040 },
  // Mock/deterministic
  mock: { costPer1kOutputTokensUsd: 0 },
  deterministic: { costPer1kOutputTokensUsd: 0 },
  unknown: { costPer1kOutputTokensUsd: 0 },
};

export function getCostModelRateForModel(model: string): CostModelRate {
  const key = String(model || 'unknown').trim();
  return MODEL_RATES[key] ?? MODEL_RATES.unknown;
}

export function estimateCostUsdFromOutputTokens(params: { model: string; outputTokens: number }): number {
  const outputTokens = Number.isFinite(params.outputTokens) ? Math.max(0, Math.floor(params.outputTokens)) : 0;
  const rate = getCostModelRateForModel(params.model).costPer1kOutputTokensUsd;
  const cost = (outputTokens / 1000) * rate;
  // Keep stable rounding for tests/UI.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function estimateRollupCost(params: {
  model: string;
  callCount: number;
  maxOutputTokensAvg: number;
}): { estimatedOutputTokens: number; estimatedCostUsd: number } {
  const callCount = Number.isFinite(params.callCount) ? Math.max(0, Math.floor(params.callCount)) : 0;
  const maxOutputTokensAvg = Number.isFinite(params.maxOutputTokensAvg)
    ? Math.max(0, Math.floor(params.maxOutputTokensAvg))
    : 0;

  const estimatedOutputTokens = callCount * maxOutputTokensAvg;
  const estimatedCostUsd = estimateCostUsdFromOutputTokens({ model: params.model, outputTokens: estimatedOutputTokens });

  return { estimatedOutputTokens, estimatedCostUsd };
}
