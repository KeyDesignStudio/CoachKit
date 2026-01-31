import type { DraftPlanSetupV1, DraftPlanV1 } from '../rules/draft-generator';
import type { PlanDiffOp } from '../server/adaptation-diff';

export type AiPlanBuilderAIMode = 'deterministic' | 'llm';

export type AiJsonValue =
  | null
  | boolean
  | number
  | string
  | AiJsonValue[]
  | { [key: string]: AiJsonValue };

export type AiIntakeEvidenceItem = {
  questionKey: string;
  answerJson: AiJsonValue;
};

export type AiIntakeFlag = 'injury' | 'pain' | 'marathon' | 'triathlon';

export type AiCoachIntent = {
  /**
   * Human-entered coach notes, used only as a hint.
   * Must never be treated as a free-form prompt in deterministic mode.
   */
  note?: string;

  /**
   * Future: represent structured coach goals without natural language.
   */
  goalTag?: 'base' | 'build' | 'peak' | 'recover';
};

export type SummarizeIntakeInput = {
  /**
   * The only allowed intake input: normalized evidence items.
   * Note: answerJson is structured JSON, not free-form prompt text.
   */
  evidence: AiIntakeEvidenceItem[];

  /** Optional structured coach intent (not used today). */
  coachIntent?: AiCoachIntent;
};

export type SummarizeIntakeResult = {
  /** Deterministic profile map (keyed by questionKey). */
  profileJson: Record<string, AiJsonValue>;

  /** Deterministic, line-oriented summary (stable ordering). */
  summaryText: string;

  /** Small, explicit classification tags (no opaque blobs). */
  flags: AiIntakeFlag[];
};

export type SuggestDraftPlanInput = {
  /**
   * Draft plan setup parameters.
   * Must be fully explicit and deterministic-friendly.
   */
  setup: DraftPlanSetupV1;

  /** Optional structured coach intent (not used today). */
  coachIntent?: AiCoachIntent;
};

export type SuggestDraftPlanResult = {
  /** Fully structured plan JSON (no DB IDs). */
  planJson: DraftPlanV1;
};

export type AiDraftWeekSnapshot = {
  weekIndex: number;
  locked: boolean;
};

export type AiDraftSessionSnapshot = {
  id: string;
  weekIndex: number;
  ordinal: number;
  dayOfWeek: number;
  type: string;
  durationMinutes: number;
  notes: string | null;
  locked: boolean;
};

export type AiDraftPlanSnapshot = {
  weeks: AiDraftWeekSnapshot[];
  sessions: AiDraftSessionSnapshot[];
};

export type AiAdaptationTriggerType =
  | 'SORENESS'
  | 'TOO_HARD'
  | 'MISSED_KEY'
  | 'LOW_COMPLIANCE'
  | 'HIGH_COMPLIANCE';

export type SuggestProposalDiffsInput = {
  /**
   * Explicit trigger types (sorted by caller for determinism).
   * No DB IDs or opaque payloads.
   */
  triggerTypes: AiAdaptationTriggerType[];

  /** Current draft snapshot (includes lock state). */
  draft: AiDraftPlanSnapshot;

  /** Optional structured coach intent (not used today). */
  coachIntent?: AiCoachIntent;
};

export type SuggestProposalDiffsResult = {
  /** Ordered diff operations to apply to the draft. */
  diff: PlanDiffOp[];

  /** Deterministic rationale text (stable ordering). */
  rationaleText: string;

  /** Whether the diff respects current lock state. */
  respectsLocks: boolean;
};
