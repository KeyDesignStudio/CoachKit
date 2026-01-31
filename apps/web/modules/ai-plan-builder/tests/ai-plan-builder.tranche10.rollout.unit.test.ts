import { describe, expect, it } from 'vitest';

import {
  getAiPlanBuilderCapabilityModeFromEnv,
  getAiPlanBuilderEffectiveMode,
  getAiPlanBuilderLlmMaxOutputTokensFromEnv,
  getAiPlanBuilderLlmRetryCountFromEnv,
} from '@/modules/ai-plan-builder/ai/config';

import { ApiError } from '@/lib/errors';
import { consumeLlmRateLimitOrThrow, type AiRateLimitStore } from '@/modules/ai-plan-builder/server/llm-rate-limit';

describe('AI Plan Builder v1 (Tranche 10: rollout + guardrails)', () => {
  it('T10.1 per-capability mode resolves override vs inherit', () => {
    expect(getAiPlanBuilderCapabilityModeFromEnv('summarizeIntake', {} as any)).toBe('inherit');

    expect(
      getAiPlanBuilderEffectiveMode('summarizeIntake', {
        AI_PLAN_BUILDER_AI_MODE: 'llm',
        AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE: 'inherit',
      } as any)
    ).toBe('llm');

    expect(
      getAiPlanBuilderEffectiveMode('summarizeIntake', {
        AI_PLAN_BUILDER_AI_MODE: 'deterministic',
        AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE: 'llm',
      } as any)
    ).toBe('llm');

    expect(
      getAiPlanBuilderEffectiveMode('summarizeIntake', {
        AI_PLAN_BUILDER_AI_MODE: 'llm',
        AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE: 'deterministic',
      } as any)
    ).toBe('deterministic');
  });

  it('T10.2 per-capability token limits override global default', () => {
    expect(
      getAiPlanBuilderLlmMaxOutputTokensFromEnv('summarizeIntake', {
        AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS: '1500',
        AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE: '800',
      } as any)
    ).toBe(800);

    expect(
      getAiPlanBuilderLlmMaxOutputTokensFromEnv('summarizeIntake', {
        AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS: '1500',
      } as any)
    ).toBe(1500);

    expect(getAiPlanBuilderLlmMaxOutputTokensFromEnv('summarizeIntake', {} as any, { fallback: 1200 })).toBe(1200);
  });

  it('T10.3 retry count defaults to 1 and clamps to [0..2]', () => {
    expect(getAiPlanBuilderLlmRetryCountFromEnv({} as any)).toBe(1);
    expect(getAiPlanBuilderLlmRetryCountFromEnv({ AI_PLAN_BUILDER_LLM_RETRY_COUNT: '-1' } as any)).toBe(0);
    expect(getAiPlanBuilderLlmRetryCountFromEnv({ AI_PLAN_BUILDER_LLM_RETRY_COUNT: '0' } as any)).toBe(0);
    expect(getAiPlanBuilderLlmRetryCountFromEnv({ AI_PLAN_BUILDER_LLM_RETRY_COUNT: '2' } as any)).toBe(2);
    expect(getAiPlanBuilderLlmRetryCountFromEnv({ AI_PLAN_BUILDER_LLM_RETRY_COUNT: '99' } as any)).toBe(2);
  });

  it('T10.4 rate limiter enforces per-hour budget', async () => {
    const now = new Date('2026-01-30T12:00:00.000Z');
    const events: Array<{ actorType: string; actorId: string; createdAt: Date }> = [];

    const store: AiRateLimitStore = {
      async countEventsSince({ actorType, actorId, since }) {
        return events.filter((e) => e.actorType === actorType && e.actorId === actorId && e.createdAt >= since).length;
      },
      async createEvent({ actorType, actorId }) {
        events.push({ actorType, actorId, createdAt: now });
      },
    };

    await consumeLlmRateLimitOrThrow(
      { actorType: 'COACH', actorId: 'c1', capability: 'summarizeIntake' },
      { now, store, limitPerHour: 2 }
    );
    await consumeLlmRateLimitOrThrow(
      { actorType: 'COACH', actorId: 'c1', capability: 'summarizeIntake' },
      { now, store, limitPerHour: 2 }
    );

    await expect(
      consumeLlmRateLimitOrThrow(
        { actorType: 'COACH', actorId: 'c1', capability: 'summarizeIntake' },
        { now, store, limitPerHour: 2 }
      )
    ).rejects.toMatchObject({ status: 429, code: 'LLM_RATE_LIMITED' } satisfies Partial<ApiError>);
  });
});
