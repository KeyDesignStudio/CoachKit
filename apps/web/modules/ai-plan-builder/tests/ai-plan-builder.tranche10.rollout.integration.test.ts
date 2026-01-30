import { describe, expect, it } from 'vitest';

import { getAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/factory';

describe('AI Plan Builder v1 (Tranche 10: rollout integration)', () => {
  it('T10.I1 per-capability override can force deterministic when global=llm', async () => {
    const prev = {
      mode: process.env.AI_PLAN_BUILDER_AI_MODE,
      cap: process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE,
    };

    process.env.AI_PLAN_BUILDER_AI_MODE = 'llm';
    process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE = 'deterministic';

    const infoCalls: any[] = [];
    const prevInfo = console.info;
    console.info = ((...args: any[]) => infoCalls.push(args)) as any;

    try {
      await getAiPlanBuilderAI().summarizeIntake({ evidence: [] } as any);
    } finally {
      console.info = prevInfo;
      if (typeof prev.mode === 'string') process.env.AI_PLAN_BUILDER_AI_MODE = prev.mode;
      else delete process.env.AI_PLAN_BUILDER_AI_MODE;
      if (typeof prev.cap === 'string') process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE = prev.cap;
      else delete process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE;
    }

    expect(infoCalls.some((c) => c?.[0] === 'LLM_CALL_ATTEMPT')).toBe(false);
  });

  it('T10.I2 per-capability override can force LLM when global=deterministic', async () => {
    const prev = {
      mode: process.env.AI_PLAN_BUILDER_AI_MODE,
      cap: process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE,
      tokens: process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE,
    };

    process.env.AI_PLAN_BUILDER_AI_MODE = 'deterministic';
    process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE = 'llm';
    process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE = '111';

    const infoCalls: any[] = [];
    const prevInfo = console.info;
    console.info = ((...args: any[]) => infoCalls.push(args)) as any;

    try {
      await getAiPlanBuilderAI().summarizeIntake({ evidence: [] } as any);
    } finally {
      console.info = prevInfo;
      if (typeof prev.mode === 'string') process.env.AI_PLAN_BUILDER_AI_MODE = prev.mode;
      else delete process.env.AI_PLAN_BUILDER_AI_MODE;
      if (typeof prev.cap === 'string') process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE = prev.cap;
      else delete process.env.AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE;
      if (typeof prev.tokens === 'string') process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE = prev.tokens;
      else delete process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_SUMMARIZE_INTAKE;
    }

    const attempt = infoCalls.find((c) => c?.[0] === 'LLM_CALL_ATTEMPT');
    expect(Boolean(attempt)).toBe(true);
    expect(attempt?.[1]?.maxOutputTokens).toBe(111);
  });
});
