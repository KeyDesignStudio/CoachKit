import type { DraftPlanSetupV1, DraftPlanV1 } from '../rules/draft-generator';
import type { PlanDiffOp } from '../server/adaptation-diff';
import type { SessionDetailV1 } from '../rules/session-detail';

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

export type GenerateSessionDetailInput = {
  /** Stable, non-PII summary (from summarizeIntake if present). */
  athleteSummaryText: string;

  /** Snapshot of setup constraints for context only (must NOT change topology). */
  constraints: {
    riskTolerance: 'low' | 'med' | 'high';
    maxIntensityDaysPerWeek: number;
    longSessionDay: number | null;
    weeklyMinutesTarget: number;
  };

  /** The deterministic skeleton session fields. */
  session: {
    weekIndex: number;
    dayOfWeek: number;
    discipline: string;
    type: string;
    durationMinutes: number;
  };
};

export type GenerateSessionDetailResult = {
  detail: SessionDetailV1;
};

export type GenerateIntakeFromProfileInput = {
  /**
   * Structured, non-LLM snapshot of the athlete profile.
   * Must be derived from known DB fields only (no hallucinated facts).
   */
  profile: {
    disciplines: string[];
    goalsText: string | null;
    trainingPlanFrequency: string;
    trainingPlanDayOfWeek: number | null;
    trainingPlanWeekOfMonth: number | null;
    coachNotes: string | null;
  };
};

export type GenerateIntakeFromProfileResult = {
  /**
   * Draft intake JSON keyed by questionKey.
   * Values must be JSON-serializable.
   */
  draftJson: Record<string, AiJsonValue>;
};
