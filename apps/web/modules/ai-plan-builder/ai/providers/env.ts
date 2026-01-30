import type { AiJsonValue } from '../types';

import { AiPlanBuilderLlmError } from './errors';

export type AiPlanBuilderLlmProvider = 'openai' | 'mock';

export type AiPlanBuilderLlmConfig = {
  provider: AiPlanBuilderLlmProvider;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  openAiApiKey?: string;
};

export function getAiPlanBuilderLlmProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderLlmProvider {
  const raw = String(env.AI_PLAN_BUILDER_LLM_PROVIDER ?? 'openai').trim().toLowerCase();
  return raw === 'mock' ? 'mock' : 'openai';
}

export function shouldForceMockTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  // CI/test/harness must not call external providers.
  // NOTE: our test harness intentionally runs with NODE_ENV=development.
  const nodeEnv = String(env.NODE_ENV ?? '').toLowerCase();
  if (nodeEnv === 'test') return true;

  // Common CI marker
  if (String(env.CI ?? '').trim() === '1' || String(env.CI ?? '').trim().toLowerCase() === 'true') return true;

  // CoachKit AI Plan Builder harness marker (set by apps/web/scripts/test-ai-plan-builder.mjs)
  if (String(env.TEST_RUN_ID ?? '').trim()) return true;

  // Vitest markers
  if (String(env.VITEST ?? '').trim()) return true;
  if (String(env.VITEST_WORKER_ID ?? '').trim()) return true;

  // Playwright markers
  if (String(env.PLAYWRIGHT_TEST_BASE_URL ?? '').trim()) return true;
  if (String(env.PW_TEST ?? '').trim()) return true;

  return getAiPlanBuilderLlmProviderFromEnv(env) === 'mock';
}

export function getAiPlanBuilderLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderLlmConfig {
  const provider = shouldForceMockTransport(env) ? 'mock' : getAiPlanBuilderLlmProviderFromEnv(env);

  const timeoutMsRaw = Number(env.AI_PLAN_BUILDER_LLM_TIMEOUT_MS ?? 20000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(1000, Math.round(timeoutMsRaw)) : 20000;

  const maxTokensRaw = Number(env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS ?? 1200);
  const maxOutputTokens = Number.isFinite(maxTokensRaw) ? Math.max(128, Math.round(maxTokensRaw)) : 1200;

  const model = String(env.AI_PLAN_BUILDER_LLM_MODEL ?? '').trim();
  const openAiApiKey = String(env.OPENAI_API_KEY ?? '').trim();

  return {
    provider,
    model,
    timeoutMs,
    maxOutputTokens,
    openAiApiKey: openAiApiKey || undefined,
  };
}

export function assertValidLlmConfig(config: AiPlanBuilderLlmConfig) {
  if (!config.model) {
    throw new AiPlanBuilderLlmError(
      'CONFIG_MISSING',
      'LLM mode is enabled but AI_PLAN_BUILDER_LLM_MODEL is missing.',
      { isRetryable: false }
    );
  }

  if (config.provider === 'openai' && !config.openAiApiKey) {
    throw new AiPlanBuilderLlmError(
      'CONFIG_MISSING',
      'LLM mode is enabled but OPENAI_API_KEY is missing.',
      { isRetryable: false }
    );
  }
}

function redactString(text: string): string {
  let out = text;

  // Emails
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');

  // US-ish phone numbers
  out = out.replace(
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    '[REDACTED_PHONE]'
  );

  // Very simple street-address heuristic
  out = out.replace(
    /\b\d{1,5}\s+[^\n,]{1,40}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court)\b/gi,
    '[REDACTED_ADDRESS]'
  );

  return out;
}

export function redactAiJsonValue(value: AiJsonValue): AiJsonValue {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactAiJsonValue(v as AiJsonValue));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, AiJsonValue>;
    const out: Record<string, AiJsonValue> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactAiJsonValue(v);
    return out;
  }
  return value;
}
