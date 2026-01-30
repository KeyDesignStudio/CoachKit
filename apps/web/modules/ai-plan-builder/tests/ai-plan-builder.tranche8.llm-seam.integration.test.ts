import { describe, expect, it } from 'vitest';

import { getAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/factory';

describe('AI Plan Builder v1 (Tranche 8: LLM seam integration)', () => {
  it('T8.I1 factory-mode outputs are identical in deterministic vs llm mode (all capabilities)', async () => {
    const setup = {
      eventDate: '2026-09-01',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'bike',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    } as const;

    const summarizeInput = {
      evidence: [
        { questionKey: 'goals', answerJson: 'Build aerobic base' },
        { questionKey: 'injuries', answerJson: [] },
      ],
    } as const;

    const proposalInput = {
      triggerTypes: ['SORENESS', 'HIGH_COMPLIANCE'],
      draft: {
        weeks: [{ weekIndex: 0, locked: false }, { weekIndex: 1, locked: false }],
        sessions: [
          { id: 's0', weekIndex: 1, ordinal: 0, dayOfWeek: 1, type: 'threshold', durationMinutes: 40, notes: null, locked: false },
          { id: 's1', weekIndex: 1, ordinal: 1, dayOfWeek: 3, type: 'endurance', durationMinutes: 60, notes: null, locked: false },
        ],
      },
    } as const;

    const prev = process.env.AI_PLAN_BUILDER_AI_MODE;

    process.env.AI_PLAN_BUILDER_AI_MODE = 'deterministic';
    const detSummarize = await getAiPlanBuilderAI().summarizeIntake(summarizeInput as any);
    const detDraft = await getAiPlanBuilderAI().suggestDraftPlan({ setup } as any);
    const detProposal = await getAiPlanBuilderAI().suggestProposalDiffs(proposalInput as any);

    process.env.AI_PLAN_BUILDER_AI_MODE = 'llm';
    const llmSummarize = await getAiPlanBuilderAI().summarizeIntake(summarizeInput as any);
    const llmDraft = await getAiPlanBuilderAI().suggestDraftPlan({ setup } as any);
    const llmProposal = await getAiPlanBuilderAI().suggestProposalDiffs(proposalInput as any);

    if (typeof prev === 'string') process.env.AI_PLAN_BUILDER_AI_MODE = prev;
    else delete process.env.AI_PLAN_BUILDER_AI_MODE;

    expect(llmSummarize).toEqual(detSummarize);
    expect(llmDraft).toEqual(detDraft);
    expect(llmProposal).toEqual(detProposal);
  });
});
