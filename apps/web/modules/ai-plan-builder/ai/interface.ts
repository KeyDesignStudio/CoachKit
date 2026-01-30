import type {
  SummarizeIntakeInput,
  SummarizeIntakeResult,
  SuggestDraftPlanInput,
  SuggestDraftPlanResult,
  SuggestProposalDiffsInput,
  SuggestProposalDiffsResult,
} from './types';

/**
 * Single capability contract for AI Plan Builder.
 *
 * This interface is the ONLY place CoachKit is allowed to depend on "AI" behaviour.
 * Implementations must:
 * - Accept only structured inputs (no free-form prompts)
 * - Return fully structured outputs (deterministic-friendly)
 * - Avoid DB access (caller provides snapshots)
 */
export interface AiPlanBuilderAI {
  /**
   * Convert intake evidence into a deterministic profile summary.
   *
   * Inputs: intake evidence (+ optional structured coach intent).
   * Outputs: extracted profileJson, summaryText, and explicit flags.
   */
  summarizeIntake(input: SummarizeIntakeInput): Promise<SummarizeIntakeResult>;

  /**
   * Suggest a full draft plan JSON (no DB IDs).
   *
   * Inputs: setup parameters (+ optional structured coach intent).
   * Outputs: planJson suitable for persistence.
   */
  suggestDraftPlan(input: SuggestDraftPlanInput): Promise<SuggestDraftPlanResult>;

  /**
   * Suggest change proposal diffs for an existing draft plan.
   *
   * Inputs: trigger types + current draft snapshot (+ optional coach intent).
   * Outputs: ordered diff ops + rationale text + lock-respect signal.
   */
  suggestProposalDiffs(input: SuggestProposalDiffsInput): Promise<SuggestProposalDiffsResult>;
}
