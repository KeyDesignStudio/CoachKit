import { describe, expect, it } from 'vitest';

import { DeterministicAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/deterministic';
import { LlmAiPlanBuilderAI } from '@/modules/ai-plan-builder/ai/llm-stub';
import { getAiPlanBuilderAI, getAiPlanBuilderAIModeFromEnv } from '@/modules/ai-plan-builder/ai/factory';

describe('AI Plan Builder v1 (Tranche 8: LLM seam)', () => {
  it('T8.1 factory defaults to deterministic when env missing', () => {
    const mode = getAiPlanBuilderAIModeFromEnv({} as any);
    expect(mode).toBe('deterministic');

    const mode2 = getAiPlanBuilderAIModeFromEnv({ AI_PLAN_BUILDER_AI_MODE: '' } as any);
    expect(mode2).toBe('deterministic');
  });

  it('T8.2 factory respects global mode switch when env=llm', async () => {
    const mode = getAiPlanBuilderAIModeFromEnv({ AI_PLAN_BUILDER_AI_MODE: 'llm' } as any);
    expect(mode).toBe('llm');

    const prev = process.env.AI_PLAN_BUILDER_AI_MODE;
    process.env.AI_PLAN_BUILDER_AI_MODE = 'llm';
    try {
      const infoCalls: any[] = [];
      const prevInfo = console.info;
      console.info = ((...args: any[]) => infoCalls.push(args)) as any;
      try {
        await getAiPlanBuilderAI().summarizeIntake({ evidence: [] } as any);
      } finally {
        console.info = prevInfo;
      }

      expect(infoCalls.some((c) => c?.[0] === 'LLM_CALL_ATTEMPT')).toBe(true);
    } finally {
      if (typeof prev === 'string') process.env.AI_PLAN_BUILDER_AI_MODE = prev;
      else delete process.env.AI_PLAN_BUILDER_AI_MODE;
    }
  });

  it('T8.3 deterministic and LLM stub return identical results (all capabilities)', async () => {
    const det = new DeterministicAiPlanBuilderAI({ recordAudit: true });
    const llm = new LlmAiPlanBuilderAI({ deterministicFallback: new DeterministicAiPlanBuilderAI({ recordAudit: false }) });

    const summarizeInput = {
      evidence: [
        { questionKey: 'goals', answerJson: 'Build aerobic base' },
        { questionKey: 'injuries', answerJson: [] },
      ],
    } as const;

    const s1 = await det.summarizeIntake(summarizeInput as any);
    const s2 = await llm.summarizeIntake(summarizeInput as any);
    expect(s2).toEqual(s1);

    const setup = {
      eventDate: '2026-08-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    } as const;

    const d1 = await det.suggestDraftPlan({ setup } as any);
    const d2 = await llm.suggestDraftPlan({ setup } as any);
    expect(d2).toEqual(d1);

    const pInput = {
      triggerTypes: ['SORENESS', 'HIGH_COMPLIANCE'],
      draft: {
        weeks: [{ weekIndex: 0, locked: false }, { weekIndex: 1, locked: false }],
        sessions: [
          { id: 's0', weekIndex: 1, ordinal: 0, dayOfWeek: 1, type: 'threshold', durationMinutes: 40, notes: null, locked: false },
          { id: 's1', weekIndex: 1, ordinal: 1, dayOfWeek: 3, type: 'endurance', durationMinutes: 60, notes: null, locked: false },
        ],
      },
    } as const;

    const p1 = await det.suggestProposalDiffs(pInput as any);
    const p2 = await llm.suggestProposalDiffs(pInput as any);
    expect(p2).toEqual(p1);
  });
});
