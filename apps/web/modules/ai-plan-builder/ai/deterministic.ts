import type { AiPlanBuilderAI } from './interface';
import type {
  AiJsonValue,
  SummarizeIntakeInput,
  SummarizeIntakeResult,
  SuggestDraftPlanInput,
  SuggestDraftPlanResult,
  SuggestProposalDiffsInput,
  SuggestProposalDiffsResult,
  GenerateIntakeFromProfileInput,
  GenerateIntakeFromProfileResult,
  GenerateAthleteBriefFromIntakeInput,
  GenerateAthleteBriefFromIntakeResult,
} from './types';

import { extractProfileDeterministic } from '../rules/profile-extractor';
import { generateDraftPlanDeterministicV1 } from '../rules/draft-generator';
import { suggestProposalDiffsDeterministicV1 } from '../rules/proposal-diff-generator';
import { buildDeterministicSessionDetailV1 } from '../rules/session-detail';
import { buildAthleteBriefDeterministic, athleteBriefSchema } from '../rules/athlete-brief';

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
        maxOutputTokens: null,
        timeoutMs: null,
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
        maxOutputTokens: null,
        timeoutMs: null,
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
        maxOutputTokens: null,
        timeoutMs: null,
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

  async generateSessionDetail(input: any): Promise<any> {
    const startedAt = Date.now();

    const detail = buildDeterministicSessionDetailV1({
      discipline: String(input?.session?.discipline ?? ''),
      type: String(input?.session?.type ?? ''),
      durationMinutes: Number(input?.session?.durationMinutes ?? 0),
    });

    const briefParsed = athleteBriefSchema.safeParse(input?.athleteBrief ?? null);
    if (briefParsed.success) {
      const brief = briefParsed.data;
      const riskFlags = brief.version === 'v1.1' ? brief.riskFlags ?? [] : brief.risks ?? [];
      const focusLines =
        brief.version === 'v1.1'
          ? [brief.planGuidance, ...riskFlags].filter(Boolean)
          : [...(brief.planGuidance?.focusNotes ?? []), ...riskFlags].filter(Boolean);

      if (focusLines.length) {
        detail.targets.notes = `${detail.targets.notes} Focus: ${focusLines.slice(0, 2).join(' ')}`.slice(0, 500);
      }

      const cueAdditions =
        brief.version === 'v1.1'
          ? [
              brief.coachingPreferences?.tone,
              brief.coachingPreferences?.feedbackStyle,
              brief.coachingPreferences?.checkinCadence,
            ]
              .filter((value): value is string => Boolean(value))
              .slice(0, 2)
          : [...(brief.planGuidance?.coachingCues ?? []), brief.planGuidance?.tone]
              .filter((value): value is string => Boolean(value))
              .slice(0, 2);

      if (cueAdditions.length) {
        detail.cues = Array.from(new Set([...(detail.cues ?? []), ...cueAdditions])).slice(0, 3);
      }

      const safetyLines =
        brief.version === 'v1.1'
          ? [
              brief.constraintsAndSafety?.injuryStatus,
              ...(brief.constraintsAndSafety?.painHistory ?? []),
              ...riskFlags,
            ]
              .filter(Boolean)
              .slice(0, 3)
          : [...(brief.planGuidance?.safetyNotes ?? []), ...riskFlags].filter(Boolean).slice(0, 3);

      if (safetyLines.length) {
        detail.safetyNotes = `${detail.safetyNotes ?? ''} ${safetyLines.join(' ')}`.trim().slice(0, 800);
      }
    }

    const result = { detail };

    const audit = computeAiUsageAudit({ capability: 'generateSessionDetail', mode: 'deterministic', input, output: result });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'generateSessionDetail',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('generateSessionDetail'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        maxOutputTokens: null,
        timeoutMs: null,
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

  async generateIntakeFromProfile(input: GenerateIntakeFromProfileInput): Promise<GenerateIntakeFromProfileResult> {
    const startedAt = Date.now();

    const profile = input?.profile ?? {
      disciplines: [],
      primaryGoal: null,
      secondaryGoals: [],
      focus: null,
      timelineWeeks: null,
      experienceLevel: null,
      weeklyMinutesTarget: null,
      consistencyLevel: null,
      availableDays: [],
      scheduleVariability: null,
      sleepQuality: null,
      trainingPlanSchedule: null,
      coachNotes: null,
    };

    const timelineLabel = (() => {
      if (!profile.timelineWeeks) return null;
      if (profile.timelineWeeks <= 0) return null;
      if (profile.timelineWeeks <= 8) return 'In 6–8 weeks';
      if (profile.timelineWeeks <= 12) return 'In 2–3 months';
      if (profile.timelineWeeks <= 24) return 'In 3–6 months';
      if (profile.timelineWeeks <= 48) return 'In 6–12 months';
      return 'No date in mind';
    })();

    const shortDay = (day: string) => day.slice(0, 3);
    const availabilityDays = Array.isArray(profile.availableDays) ? profile.availableDays.map(shortDay) : [];

    const draftJson: Record<string, AiJsonValue> = {
      disciplines: Array.isArray(profile.disciplines) ? profile.disciplines.map(String) : [],
      goal_details: profile.primaryGoal ? String(profile.primaryGoal) : null,
      goal_focus: profile.focus ? String(profile.focus) : null,
      goal_timeline: timelineLabel,
      experience_level: profile.experienceLevel ? String(profile.experienceLevel) : null,
      weekly_minutes: profile.weeklyMinutesTarget ?? null,
      recent_consistency: profile.consistencyLevel ? String(profile.consistencyLevel) : null,
      availability_days: availabilityDays,
      schedule_variability: profile.scheduleVariability ? String(profile.scheduleVariability) : null,
      sleep_quality: profile.sleepQuality ? String(profile.sleepQuality) : null,
    };

    const result: GenerateIntakeFromProfileResult = { draftJson };

    const audit = computeAiUsageAudit({
      capability: 'generateIntakeFromProfile',
      mode: 'deterministic',
      input,
      output: result,
    });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'generateIntakeFromProfile',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('generateIntakeFromProfile'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        maxOutputTokens: null,
        timeoutMs: null,
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

  async generateAthleteBriefFromIntake(
    input: GenerateAthleteBriefFromIntakeInput
  ): Promise<GenerateAthleteBriefFromIntakeResult> {
    const startedAt = Date.now();

    const brief = buildAthleteBriefDeterministic({
      profile: input.athleteProfile ?? null,
    });

    const result = { brief };
    const audit = computeAiUsageAudit({
      capability: 'generateAthleteBriefFromIntake',
      mode: 'deterministic',
      input,
      output: result,
    });

    if (this.onInvocation) {
      await this.onInvocation({
        capability: 'generateAthleteBriefFromIntake',
        specVersion: getAiPlanBuilderCapabilitySpecVersion('generateAthleteBriefFromIntake'),
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
        durationMs: Math.max(0, Date.now() - startedAt),
        maxOutputTokens: null,
        timeoutMs: null,
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
