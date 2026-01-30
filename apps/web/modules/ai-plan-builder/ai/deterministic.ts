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

import { computeAiUsageAudit, recordAiUsageAudit, type AiInvocationAuditMeta } from './audit';
import { getAiPlanBuilderCapabilitySpecVersion } from './config';

export class DeterministicAiPlanBuilderAI implements AiPlanBuilderAI {
  private readonly shouldRecordAudit: boolean;
  private readonly onInvocation?: (meta: AiInvocationAuditMeta) => void | Promise<void>;

  constructor(options?: {
    recordAudit?: boolean;
    onInvocation?: (meta: AiInvocationAuditMeta) => void | Promise<void>;
  }) {
    this.shouldRecordAudit = options?.recordAudit ?? true;
    this.onInvocation = options?.onInvocation;
  }

  async summarizeIntake(input: SummarizeIntakeInput): Promise<SummarizeIntakeResult> {
    const startedAt = Date.now();
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

    const audit = computeAiUsageAudit({ capability: 'summarizeIntake', mode: 'deterministic', input, output: result });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'summarizeIntake',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('summarizeIntake'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        retryCount: 0,
        fallbackUsed: false,
        errorCode: null,
      });
    }

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(audit);
    }

    return result;
  }

  async suggestDraftPlan(input: SuggestDraftPlanInput): Promise<SuggestDraftPlanResult> {
    const startedAt = Date.now();
    const planJson = generateDraftPlanDeterministicV1(input.setup);

    const result: SuggestDraftPlanResult = { planJson };

    const audit = computeAiUsageAudit({ capability: 'suggestDraftPlan', mode: 'deterministic', input, output: result });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'suggestDraftPlan',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('suggestDraftPlan'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        retryCount: 0,
        fallbackUsed: false,
        errorCode: null,
      });
    }

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(audit);
    }

    return result;
  }

  async suggestProposalDiffs(input: SuggestProposalDiffsInput): Promise<SuggestProposalDiffsResult> {
    const startedAt = Date.now();
    const out = suggestProposalDiffsDeterministicV1({
      triggerTypes: input.triggerTypes,
      draft: input.draft,
    });

    const result: SuggestProposalDiffsResult = {
      diff: out.diff,
      rationaleText: out.rationaleText,
      respectsLocks: out.respectsLocks,
    };

    const audit = computeAiUsageAudit({ capability: 'suggestProposalDiffs', mode: 'deterministic', input, output: result });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'suggestProposalDiffs',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('suggestProposalDiffs'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        retryCount: 0,
        fallbackUsed: false,
        errorCode: null,
      });
    }

    if (this.shouldRecordAudit) {
      recordAiUsageAudit(audit);
    }

    return result;
  }
}
