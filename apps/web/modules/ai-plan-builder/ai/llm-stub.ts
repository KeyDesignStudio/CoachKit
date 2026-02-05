import { z } from 'zod';

import type { AiPlanBuilderAI } from './interface';
import type {
  AiJsonValue,
  SummarizeIntakeInput,
  SummarizeIntakeResult,
  SuggestDraftPlanInput,
  SuggestDraftPlanResult,
  SuggestProposalDiffsInput,
  SuggestProposalDiffsResult,
  GenerateSessionDetailInput,
  GenerateSessionDetailResult,
  GenerateIntakeFromProfileInput,
  GenerateIntakeFromProfileResult,
  GenerateAthleteBriefFromIntakeInput,
  GenerateAthleteBriefFromIntakeResult,
} from './types';
import { athleteBriefSchema } from '../rules/athlete-brief';

import { DeterministicAiPlanBuilderAI } from './deterministic';
import { computeAiUsageAudit, recordAiUsageAudit, type AiInvocationAuditMeta } from './audit';
import { planDiffSchema } from '../server/adaptation-diff';

import { AiPlanBuilderLlmError } from './providers/errors';
import { getAiPlanBuilderLlmConfig, getAiPlanBuilderLlmTransport } from './providers/factory';
import { redactAiJsonValue } from './providers/env';
import {
  getAiPlanBuilderCapabilitySpecVersion,
  getAiPlanBuilderLlmMaxOutputTokensFromEnv,
  getAiPlanBuilderLlmRetryCountFromEnv,
} from './config';

import { sessionDetailV1Schema } from '../rules/session-detail';

const summarizeIntakeResultSchema = z
  .object({
    profileJson: z.record(z.any()),
    summaryText: z.string(),
    flags: z.array(z.enum(['injury', 'pain', 'marathon', 'triathlon'])),
  })
  .strict();

const draftPlanSetupSchema = z
  .object({
    weekStart: z.enum(['monday', 'sunday']).optional().default('monday'),
    eventDate: z.string().min(1),
    weeksToEvent: z.number().int().min(1).max(52),
    weeklyAvailabilityDays: z.array(z.number().int().min(0).max(6)),
    weeklyAvailabilityMinutes: z.union([z.number().int().min(0), z.record(z.number().int().min(0))]),
    disciplineEmphasis: z.enum(['balanced', 'swim', 'bike', 'run']),
    riskTolerance: z.enum(['low', 'med', 'high']),
    maxIntensityDaysPerWeek: z.number().int().min(1).max(3),
    maxDoublesPerWeek: z.number().int().min(0).max(3),
    longSessionDay: z.number().int().min(0).max(6).nullable().optional(),
    weeklyMinutesByWeek: z.array(z.number().int().min(0).max(10_000)).optional(),
    disciplineSplitTargets: z
      .object({
        swim: z.number().min(0).optional(),
        bike: z.number().min(0).optional(),
        run: z.number().min(0).optional(),
        strength: z.number().min(0).optional(),
      })
      .optional(),
    sessionTypeDistribution: z
      .object({
        technique: z.number().min(0).optional(),
        endurance: z.number().min(0).optional(),
        tempo: z.number().min(0).optional(),
        threshold: z.number().min(0).optional(),
        recovery: z.number().min(0).optional(),
      })
      .optional(),
    recoveryEveryNWeeks: z.number().int().min(2).max(8).optional(),
    recoveryWeekMultiplier: z.number().min(0.5).max(0.95).optional(),
    sessionsPerWeekOverride: z.number().int().min(3).max(10).optional(),
  })
  .strict();

const draftPlanV1Schema = z
  .object({
    version: z.literal('v1'),
    setup: draftPlanSetupSchema,
    weeks: z.array(
      z
        .object({
          weekIndex: z.number().int().min(0).max(52),
          locked: z.boolean(),
          sessions: z.array(
            z
              .object({
                weekIndex: z.number().int().min(0).max(52),
                ordinal: z.number().int().min(0).max(50),
                dayOfWeek: z.number().int().min(0).max(6),
                discipline: z.enum(['swim', 'bike', 'run', 'strength', 'rest']),
                type: z.enum(['endurance', 'tempo', 'threshold', 'technique', 'recovery', 'strength', 'rest']),
                durationMinutes: z.number().int().min(0).max(10_000),
                notes: z.string().nullable().optional(),
                locked: z.boolean(),
              })
              .strict()
          ),
        })
        .strict()
    ),
  })
  .strict();

const suggestDraftPlanResultSchema = z.object({ planJson: draftPlanV1Schema }).strict();

const suggestProposalDiffsResultSchema = z
  .object({
    diff: planDiffSchema,
    rationaleText: z.string(),
    respectsLocks: z.boolean(),
  })
  .strict();

function logMeta(event: string, params: Record<string, unknown>) {
  // Safety: metadata only; do not log raw prompts/outputs.
  // eslint-disable-next-line no-console
  console.info(event, params);
}

export class LlmAiPlanBuilderAI implements AiPlanBuilderAI {
  private readonly delegate: AiPlanBuilderAI;
  private readonly transportOverride?: ReturnType<typeof getAiPlanBuilderLlmTransport>;
  private readonly beforeLlmCall?: (params: {
    capability:
      | 'summarizeIntake'
      | 'suggestDraftPlan'
      | 'suggestProposalDiffs'
      | 'generateSessionDetail'
      | 'generateIntakeFromProfile'
      | 'generateAthleteBriefFromIntake';
  }) => void | Promise<void>;
  private readonly onInvocation?: (meta: AiInvocationAuditMeta) => void | Promise<void>;

  constructor(options?: {
    deterministicFallback?: AiPlanBuilderAI;
    transport?: ReturnType<typeof getAiPlanBuilderLlmTransport>;
    beforeLlmCall?: (params: {
      capability:
        | 'summarizeIntake'
        | 'suggestDraftPlan'
        | 'suggestProposalDiffs'
        | 'generateSessionDetail'
        | 'generateIntakeFromProfile'
        | 'generateAthleteBriefFromIntake';
    }) => void | Promise<void>;
    onInvocation?: (meta: AiInvocationAuditMeta) => void | Promise<void>;
  }) {
    const fallback = options?.deterministicFallback ?? new DeterministicAiPlanBuilderAI({ recordAudit: false });
    this.delegate = fallback;
    this.transportOverride = options?.transport;
    this.beforeLlmCall = options?.beforeLlmCall;
    this.onInvocation = options?.onInvocation;
  }

  private async generateWithRetry<T>(fn: () => Promise<T>, retryCount: number): Promise<T> {
    const attempts = Math.max(1, 1 + Math.max(0, retryCount));
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof AiPlanBuilderLlmError && err.isRetryable && attempt < attempts) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  private getErrorCode(err: unknown): string {
    if (err instanceof AiPlanBuilderLlmError) return err.code;
    const maybeCode = (err as any)?.code;
    return typeof maybeCode === 'string' && maybeCode.length ? maybeCode : 'UNKNOWN';
  }

  private async callOrFallback<T>(params: {
    capability:
      | 'summarizeIntake'
      | 'suggestDraftPlan'
      | 'suggestProposalDiffs'
      | 'generateSessionDetail'
      | 'generateIntakeFromProfile'
      | 'generateAthleteBriefFromIntake';
    input: unknown;
    schema: z.ZodTypeAny;
    system: string;
    deterministicFallback: () => Promise<T>;
  }): Promise<T> {
    const startedAt = Date.now();
    const auditBase = computeAiUsageAudit({
      capability: params.capability,
      mode: 'llm',
      input: params.input,
      output: { pending: true },
    });

    const specVersion = getAiPlanBuilderCapabilitySpecVersion(params.capability);
    const retryCount = getAiPlanBuilderLlmRetryCountFromEnv();

    try {
      const cfg = getAiPlanBuilderLlmConfig();
      const transport = this.transportOverride ?? getAiPlanBuilderLlmTransport();

      const maxOutputTokens = getAiPlanBuilderLlmMaxOutputTokensFromEnv(params.capability, process.env, {
        fallback: cfg.maxOutputTokens,
      });

      if (this.beforeLlmCall) {
        await this.beforeLlmCall({ capability: params.capability });
      }

      logMeta('LLM_CALL_ATTEMPT', {
        capability: params.capability,
        provider: cfg.provider,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        maxOutputTokens,
        retryCount,
        inputHash: auditBase.inputHash,
      });

      const output = await this.generateWithRetry(
        async () =>
          transport.generateStructuredJson({
            system: `APB_CAPABILITY=${params.capability}\n${params.system}`,
            input: JSON.stringify(params.input),
            schema: params.schema,
            model: cfg.model || 'mock',
            maxOutputTokens,
            timeoutMs: cfg.timeoutMs,
          }),
        retryCount
      );

      recordAiUsageAudit(
        computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output })
      );

      const finalAudit = computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output });
      if (this.onInvocation) {
        await this.onInvocation({
          capability: params.capability,
          specVersion,
          effectiveMode: 'llm',
          provider: (cfg.provider as any) ?? 'unknown',
          model: cfg.model ?? null,
          inputHash: finalAudit.inputHash,
          outputHash: finalAudit.outputHash,
          durationMs: Math.max(0, Date.now() - startedAt),
          maxOutputTokens,
          timeoutMs: cfg.timeoutMs,
          retryCount,
          fallbackUsed: false,
          errorCode: null,
        });
      }

      logMeta('LLM_CALL_SUCCEEDED', {
        capability: params.capability,
        inputHash: auditBase.inputHash,
        outputHash: finalAudit.outputHash,
      });

      return output as T;
    } catch (err) {
      const fallback = await params.deterministicFallback();
      const audit = computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output: fallback });
      const errorCode = this.getErrorCode(err);

      if (this.onInvocation) {
        const cfg = (() => {
          try {
            return getAiPlanBuilderLlmConfig();
          } catch {
            return null;
          }
        })();

        await this.onInvocation({
          capability: params.capability,
          specVersion,
          effectiveMode: 'llm',
          provider: (cfg?.provider as any) ?? 'unknown',
          model: cfg?.model ?? null,
          inputHash: audit.inputHash,
          outputHash: audit.outputHash,
          durationMs: Math.max(0, Date.now() - startedAt),
          maxOutputTokens: cfg ? getAiPlanBuilderLlmMaxOutputTokensFromEnv(params.capability, process.env, { fallback: cfg.maxOutputTokens }) : null,
          timeoutMs: cfg?.timeoutMs ?? null,
          retryCount,
          fallbackUsed: true,
          errorCode,
        });
      }

      logMeta('LLM_FALLBACK_USED', {
        capability: params.capability,
        reason: errorCode,
        inputHash: audit.inputHash,
        outputHash: audit.outputHash,
      });

      recordAiUsageAudit(audit);
      return fallback;
    }
  }

  async summarizeIntake(input: SummarizeIntakeInput): Promise<SummarizeIntakeResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as SummarizeIntakeInput;

    return this.callOrFallback<SummarizeIntakeResult>({
      capability: 'summarizeIntake',
      input: redacted,
      schema: summarizeIntakeResultSchema,
      system:
        'You are a deterministic assistant. Produce a concise intake summary and flags. Output JSON only.',
      deterministicFallback: () => this.delegate.summarizeIntake(input),
    });
  }

  async suggestDraftPlan(input: SuggestDraftPlanInput): Promise<SuggestDraftPlanResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as SuggestDraftPlanInput;

    return this.callOrFallback<SuggestDraftPlanResult>({
      capability: 'suggestDraftPlan',
      input: redacted,
      schema: suggestDraftPlanResultSchema,
      system:
        'Generate a training plan JSON. Keep it practical and consistent. Output JSON only matching the required shape.',
      deterministicFallback: () => this.delegate.suggestDraftPlan(input),
    });
  }

  async suggestProposalDiffs(input: SuggestProposalDiffsInput): Promise<SuggestProposalDiffsResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as SuggestProposalDiffsInput;

    return this.callOrFallback<SuggestProposalDiffsResult>({
      capability: 'suggestProposalDiffs',
      input: redacted,
      schema: suggestProposalDiffsResultSchema,
      system:
        'Propose safe plan diffs based on triggers and locks. Output JSON only with diff ops and rationale text.',
      deterministicFallback: () => this.delegate.suggestProposalDiffs(input),
    });
  }

  async generateSessionDetail(input: GenerateSessionDetailInput): Promise<GenerateSessionDetailResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as GenerateSessionDetailInput;

    return this.callOrFallback<GenerateSessionDetailResult>({
      capability: 'generateSessionDetail',
      input: redacted,
      schema: z.object({ detail: sessionDetailV1Schema }).strict(),
      system:
        'You are a coaching assistant. Output JSON only matching the schema. Do NOT change schedule, dates, or minutes. Only fill in objective, structure blocks, and targets.',
      deterministicFallback: () => this.delegate.generateSessionDetail(input),
    });
  }

  async generateIntakeFromProfile(input: GenerateIntakeFromProfileInput): Promise<GenerateIntakeFromProfileResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as GenerateIntakeFromProfileInput;

    return this.callOrFallback<GenerateIntakeFromProfileResult>({
      capability: 'generateIntakeFromProfile',
      input: redacted,
      schema: z.object({ draftJson: z.record(z.any()) }).strict(),
      system:
        'Generate an intake draft JSON keyed by questionKey. Use only the provided profile fields. Output JSON only matching the schema.',
      deterministicFallback: () => this.delegate.generateIntakeFromProfile(input),
    });
  }

  async generateAthleteBriefFromIntake(
    input: GenerateAthleteBriefFromIntakeInput
  ): Promise<GenerateAthleteBriefFromIntakeResult> {
    const redacted = redactAiJsonValue(input as unknown as AiJsonValue) as unknown as GenerateAthleteBriefFromIntakeInput;

    return this.callOrFallback<GenerateAthleteBriefFromIntakeResult>({
      capability: 'generateAthleteBriefFromIntake',
      input: redacted,
      schema: z.object({ brief: athleteBriefSchema }).strict(),
      system:
        'You are a deterministic assistant. Produce a concise athlete brief JSON. Output JSON only matching the schema.',
      deterministicFallback: () => this.delegate.generateAthleteBriefFromIntake(input),
    });
  }
}
