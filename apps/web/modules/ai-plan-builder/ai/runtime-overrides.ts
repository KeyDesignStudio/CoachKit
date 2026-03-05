import type { AiCapabilityName } from './audit';
import type { AiPlanBuilderAIMode } from './types';
import type { AiPlanBuilderCapabilityMode } from './config';
import type { AiPlanBuilderLlmProvider } from './providers/env';

export type AiCapabilityRuntimeOverride = {
  mode?: AiPlanBuilderCapabilityMode;
  model?: string;
  maxOutputTokens?: number;
  rateLimitPerHour?: number;
};

export type AiRuntimeOverrideMap = {
  aiMode?: AiPlanBuilderAIMode;
  llmProvider?: AiPlanBuilderLlmProvider;
  llmModel?: string;
  llmTimeoutMs?: number;
  llmMaxOutputTokens?: number;
  llmRetryCount?: number;
  llmRateLimitPerHour?: number;
  capabilities?: Partial<Record<AiCapabilityName, AiCapabilityRuntimeOverride>>;
};

let runtimeOverrides: AiRuntimeOverrideMap | null = null;
let runtimeOverridesUpdatedAt: Date | null = null;

export function setAiPlanBuilderRuntimeOverrides(overrides: AiRuntimeOverrideMap | null) {
  runtimeOverrides = overrides;
  runtimeOverridesUpdatedAt = new Date();
}

export function getAiPlanBuilderRuntimeOverrides(): AiRuntimeOverrideMap | null {
  return runtimeOverrides;
}

export function getAiPlanBuilderRuntimeOverridesUpdatedAt(): Date | null {
  return runtimeOverridesUpdatedAt;
}
