import { describe, expect, it } from 'vitest';

import { DeterministicAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/deterministic';
import { LlmAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/llm-stub';

import { AiPlanBuilderLlmError } from '@/modules/ai-plan-builder/ai/providers/errors';
import { getAiPlanBuilderLlmProviderFromEnv, shouldForceMockTransport } from '@/modules/ai-plan-builder/ai/providers/env';

describe('AI Plan Builder v1 (Tranche 9: OpenAI provider wiring)', () => {
  it('T9.1 provider selection: openai vs mock + test-force-mock', () => {
    expect(getAiPlanBuilderLlmProviderFromEnv({} as any)).toBe('openai');
    expect(getAiPlanBuilderLlmProviderFromEnv({ AI_PLAN_BUILDER_LLM_PROVIDER: 'openai' } as any)).toBe('openai');
    expect(getAiPlanBuilderLlmProviderFromEnv({ AI_PLAN_BUILDER_LLM_PROVIDER: 'mock' } as any)).toBe('mock');

    expect(shouldForceMockTransport({ NODE_ENV: 'test' } as any)).toBe(true);
    expect(shouldForceMockTransport({ TEST_RUN_ID: 'apb_test_123' } as any)).toBe(true);
    expect(shouldForceMockTransport({ NODE_ENV: 'production', AI_PLAN_BUILDER_LLM_PROVIDER: 'mock' } as any)).toBe(true);
    expect(shouldForceMockTransport({ NODE_ENV: 'production', AI_PLAN_BUILDER_LLM_PROVIDER: 'openai' } as any)).toBe(false);
  });

  it('T9.2 missing/failed LLM call falls back to deterministic (coach never blocked)', async () => {
    const det = new DeterministicAiPlanBuilderAI({ recordAudit: false });

    const failingTransport = {
      async generateStructuredJson() {
        throw new AiPlanBuilderLlmError('CONFIG_MISSING', 'Missing model/key', { isRetryable: false });
      },
    } as any;

    const llm = new LlmAiPlanBuilderAI({ deterministicFallback: det, transport: failingTransport });

    const input = {
      evidence: [
        { questionKey: 'goals', answerJson: 'Build aerobic base' },
        { questionKey: 'injuries', answerJson: [] },
      ],
    } as const;

    const expected = await det.summarizeIntake(input as any);
    const actual = await llm.summarizeIntake(input as any);

    expect(actual).toEqual(expected);
  });
});
