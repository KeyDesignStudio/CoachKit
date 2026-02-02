import type { AiPlanBuilderAI } from './interface';

import { DeterministicAiPlanBuilderAI } from './deterministic';
import { LlmAiPlanBuilderAI } from './llm-stub';

import type { AiInvocationAuditMeta } from './audit';
import { getAiPlanBuilderAIModeFromEnv, getAiPlanBuilderEffectiveMode } from './config';

export { getAiPlanBuilderAIModeFromEnv } from './config';

export type AiPlanBuilderHooks = {
  beforeLlmCall?: (params: {
    capability:
      | 'summarizeIntake'
      | 'suggestDraftPlan'
      | 'suggestProposalDiffs'
      | 'generateSessionDetail'
      | 'generateIntakeFromProfile';
  }) => void | Promise<void>;
  onInvocation?: (meta: AiInvocationAuditMeta) => void | Promise<void>;
};

class ConfiguredAiPlanBuilderAI implements AiPlanBuilderAI {
  private readonly deterministic: DeterministicAiPlanBuilderAI;
  private readonly llm: LlmAiPlanBuilderAI;

  constructor(options?: { hooks?: AiPlanBuilderHooks }) {
    const shouldRecordHashAudit = !options?.hooks?.onInvocation;

    this.deterministic = new DeterministicAiPlanBuilderAI({
      recordAudit: shouldRecordHashAudit,
      onInvocation: options?.hooks?.onInvocation,
    });

    this.llm = new LlmAiPlanBuilderAI({
      deterministicFallback: new DeterministicAiPlanBuilderAI({ recordAudit: false }),
      beforeLlmCall: options?.hooks?.beforeLlmCall,
      onInvocation: options?.hooks?.onInvocation,
    });
  }

  async summarizeIntake(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('summarizeIntake');
    return mode === 'llm' ? this.llm.summarizeIntake(input) : this.deterministic.summarizeIntake(input);
  }

  async suggestDraftPlan(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('suggestDraftPlan');
    return mode === 'llm' ? this.llm.suggestDraftPlan(input) : this.deterministic.suggestDraftPlan(input);
  }

  async suggestProposalDiffs(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('suggestProposalDiffs');
    return mode === 'llm' ? this.llm.suggestProposalDiffs(input) : this.deterministic.suggestProposalDiffs(input);
  }

  async generateSessionDetail(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('generateSessionDetail');
    return mode === 'llm' ? this.llm.generateSessionDetail(input) : this.deterministic.generateSessionDetail(input);
  }

  async generateIntakeFromProfile(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('generateIntakeFromProfile');
    return mode === 'llm' ? this.llm.generateIntakeFromProfile(input) : this.deterministic.generateIntakeFromProfile(input);
  }

  async generateAthleteBriefFromIntake(input: any) {
    const mode = getAiPlanBuilderEffectiveMode('generateAthleteBriefFromIntake');
    return mode === 'llm'
      ? this.llm.generateAthleteBriefFromIntake(input)
      : this.deterministic.generateAthleteBriefFromIntake(input);
  }
}

/**
 * Single import point for all AI Plan Builder capabilities.
 *
 * Defaults to deterministic mode when AI_PLAN_BUILDER_AI_MODE is unset.
 * Never throws at startup.
 */
export function getAiPlanBuilderAI(): AiPlanBuilderAI {
  return new ConfiguredAiPlanBuilderAI();
}

/**
 * Server-only helper: injects hooks for DB-backed rate limiting and audit.
 * Still never throws at startup.
 */
export function getAiPlanBuilderAIWithHooks(hooks: AiPlanBuilderHooks): AiPlanBuilderAI {
  // Ensure we still honor the legacy global env switch (for compatibility / docs).
  // Per-capability overrides are resolved inside ConfiguredAiPlanBuilderAI.
  getAiPlanBuilderAIModeFromEnv();
  return new ConfiguredAiPlanBuilderAI({ hooks });
}
