import type { AiPlanBuilderAI } from './interface';
import type {
  SummarizeIntakeInput,
  SummarizeIntakeResult,
  SuggestDraftPlanInput,
  SuggestDraftPlanResult,
  SuggestProposalDiffsInput,
  SuggestProposalDiffsResult,
} from './types';

import { DeterministicAiPlanBuilderAI } from './deterministic';
import { computeAiUsageAudit, recordAiUsageAudit } from './audit';

function logSimulated(params: Record<string, unknown>) {
  // Safety: metadata only; do not log raw content.
  // eslint-disable-next-line no-console
  console.info('LLM_CALL_SIMULATED', params);
}

export class LlmAiPlanBuilderAI implements AiPlanBuilderAI {
  private readonly delegate: AiPlanBuilderAI;

  constructor(delegate: AiPlanBuilderAI = new DeterministicAiPlanBuilderAI({ recordAudit: false })) {
    this.delegate = delegate;
  }

  async summarizeIntake(input: SummarizeIntakeInput): Promise<SummarizeIntakeResult> {
    logSimulated({
      capability: 'summarizeIntake',
      evidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0,
      hasCoachIntent: Boolean(input.coachIntent),
    });

    const result = await this.delegate.summarizeIntake(input);
    recordAiUsageAudit(
      computeAiUsageAudit({ capability: 'summarizeIntake', mode: 'llm', input, output: result })
    );
    return result;
  }

  async suggestDraftPlan(input: SuggestDraftPlanInput): Promise<SuggestDraftPlanResult> {
    logSimulated({
      capability: 'suggestDraftPlan',
      weeksToEvent: Number(input.setup?.weeksToEvent ?? 0),
      availabilityDaysCount: Array.isArray(input.setup?.weeklyAvailabilityDays)
        ? input.setup.weeklyAvailabilityDays.length
        : 0,
      hasCoachIntent: Boolean(input.coachIntent),
    });

    const result = await this.delegate.suggestDraftPlan(input);
    recordAiUsageAudit(
      computeAiUsageAudit({ capability: 'suggestDraftPlan', mode: 'llm', input, output: result })
    );
    return result;
  }

  async suggestProposalDiffs(input: SuggestProposalDiffsInput): Promise<SuggestProposalDiffsResult> {
    logSimulated({
      capability: 'suggestProposalDiffs',
      triggerTypesCount: Array.isArray(input.triggerTypes) ? input.triggerTypes.length : 0,
      draftWeeksCount: Array.isArray(input.draft?.weeks) ? input.draft.weeks.length : 0,
      draftSessionsCount: Array.isArray(input.draft?.sessions) ? input.draft.sessions.length : 0,
      hasCoachIntent: Boolean(input.coachIntent),
    });

    const result = await this.delegate.suggestProposalDiffs(input);
    recordAiUsageAudit(
      computeAiUsageAudit({ capability: 'suggestProposalDiffs', mode: 'llm', input, output: result })
    );
    return result;
  }
}
