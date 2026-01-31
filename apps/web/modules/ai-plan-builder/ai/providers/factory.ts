import type { AiPlanBuilderLlmTransport } from './transport';

import { OpenAiTransport } from './openai-transport';
import { MockTransport } from './mock-transport';
import {
  assertValidLlmConfig,
  getAiPlanBuilderLlmConfigFromEnv,
  shouldForceMockTransport,
  type AiPlanBuilderLlmConfig,
} from './env';

export function getAiPlanBuilderLlmConfig(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderLlmConfig {
  return getAiPlanBuilderLlmConfigFromEnv(env);
}

/**
 * Returns a transport without throwing at startup.
 * Misconfiguration is surfaced at call-time via typed errors.
 */
export function getAiPlanBuilderLlmTransport(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderLlmTransport {
  if (shouldForceMockTransport(env)) return new MockTransport();

  const cfg = getAiPlanBuilderLlmConfigFromEnv(env);
  assertValidLlmConfig(cfg);

  // Only OpenAI provider is supported today.
  return new OpenAiTransport({ apiKey: cfg.openAiApiKey! });
}
