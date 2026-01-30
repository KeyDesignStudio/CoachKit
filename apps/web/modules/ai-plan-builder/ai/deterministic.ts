import type { AiPlanBuilderAI } from './interface';
import type {
  AiJsonValue,
  SummarizeIntakeInput,
  SummarizeIntakeResult,
  SuggestDraftPlanInput,
  SuggestDraftPlanResult,
  SuggestProposalDiffsInput,
  SuggestProposalDiffsResult,
} from './types';

import { extractProfileDeterministic } from '../rules/profile-extractor';
import { generateDraftPlanDeterministicV1 } from '../rules/draft-generator';
import { suggestProposalDiffsDeterministicV1 } from '../rules/proposal-diff-generator';

import { computeAiUsageAudit, recordAiUsageAudit } from './audit';

export class DeterministicAiPlanBuilderAI implements AiPlanBuilderAI {
  private readonly shouldRecordAudit: boolean;

  constructor(options?: { recordAudit?: boolean }) {
    this.shouldRecordAudit = options?.recordAudit ?? true;
  }

  async summarizeIntake(input: SummarizeIntakeInput): Promise<SummarizeIntakeResult> {
    const extracted = extractProfileDeterministic(
      (input.evidence ?? []).map((e) => ({ questionKey: e.questionKey, answerJson: e.answerJson }))
    );

    const allowedFlags: ReadonlySet<SummarizeIntakeResult['flags'][number]> = new Set([
      'injury',
      'pain',
      'marathon',
      'triathlon',
    ]);

    const isAiIntakeFlag = (value: unknown): value is SummarizeIntakeResult['flags'][number] =>
      typeof value === 'string' && allowedFlags.has(value as SummarizeIntakeResult['flags'][number]);

    const flags = (Array.isArray((extracted as any).flags) ? (extracted as any).flags : []).filter(isAiIntakeFlag);

    const result: SummarizeIntakeResult = {
      profileJson: extracted.profileJson as Record<string, AiJsonValue>,
      summaryText: extracted.summaryText,
      flags,
    };

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(
        computeAiUsageAudit({ capability: 'summarizeIntake', mode: 'deterministic', input, output: result })
      );
    }

    return result;
  }

  async suggestDraftPlan(input: SuggestDraftPlanInput): Promise<SuggestDraftPlanResult> {
    const planJson = generateDraftPlanDeterministicV1(input.setup);

    const result: SuggestDraftPlanResult = { planJson };

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(
        computeAiUsageAudit({ capability: 'suggestDraftPlan', mode: 'deterministic', input, output: result })
      );
    }

    return result;
  }

  async suggestProposalDiffs(input: SuggestProposalDiffsInput): Promise<SuggestProposalDiffsResult> {
    const out = suggestProposalDiffsDeterministicV1({
      triggerTypes: input.triggerTypes,
      draft: input.draft,
    });

    const result: SuggestProposalDiffsResult = {
      diff: out.diff,
      rationaleText: out.rationaleText,
      respectsLocks: out.respectsLocks,
    };

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(
        computeAiUsageAudit({ capability: 'suggestProposalDiffs', mode: 'deterministic', input, output: result })
      );
    }

    return result;
  }
}
