import { describe, expect, it } from 'vitest';

import { LlmAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/llm-stub';
import { MockTransport } from '@/modules/ai-plan-builder/ai/providers/mock-transport';

describe('AI Plan Builder v1 (Tranche 9: OpenAI provider wiring integration)', () => {
  it('T9.I1 retries once on schema failure then succeeds (mock transport scripted)', async () => {
    const transport = new MockTransport({
      scriptedJsonByCall: [
        // First attempt: schema failure
        {},
        // Second attempt: valid
        { profileJson: {}, summaryText: 'FROM_LLM', flags: [] },
      ],
    });

    const llm = new LlmAiPlanBuilderAI({ transport });

    const input = {
      evidence: [
        { questionKey: 'goals', answerJson: 'Build aerobic base' },
        { questionKey: 'injuries', answerJson: [] },
      ],
    } as const;

    const result = await llm.summarizeIntake(input as any);
    expect(result.summaryText).toBe('FROM_LLM');
  });
});
