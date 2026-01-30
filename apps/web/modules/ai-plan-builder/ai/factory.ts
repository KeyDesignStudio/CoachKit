import type { AiPlanBuilderAI } from './interface';
import type { AiPlanBuilderAIMode } from './types';

import { DeterministicAiPlanBuilderAI } from './deterministic';
import { LlmAiPlanBuilderAI } from './llm-stub';

export function getAiPlanBuilderAIModeFromEnv(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderAIMode {
  const raw = String(env.AI_PLAN_BUILDER_AI_MODE ?? '').trim().toLowerCase();
  return raw === 'llm' ? 'llm' : 'deterministic';
}

/**
 * Single import point for all AI Plan Builder capabilities.
 *
 * Defaults to deterministic mode when AI_PLAN_BUILDER_AI_MODE is unset.
 * Never throws at startup.
 */
export function getAiPlanBuilderAI(): AiPlanBuilderAI {
  const mode = getAiPlanBuilderAIModeFromEnv();
  if (mode === 'llm') {
    return new LlmAiPlanBuilderAI();
  }
  return new DeterministicAiPlanBuilderAI();
}
