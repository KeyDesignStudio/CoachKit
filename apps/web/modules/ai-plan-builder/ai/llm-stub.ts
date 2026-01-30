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
} from './types';

import { DeterministicAiPlanBuilderAI } from './deterministic';
import { computeAiUsageAudit, recordAiUsageAudit } from './audit';
import { planDiffSchema } from '../server/adaptation-diff';

import { AiPlanBuilderLlmError } from './providers/errors';
import { getAiPlanBuilderLlmConfig, getAiPlanBuilderLlmTransport } from './providers/factory';
import { redactAiJsonValue } from './providers/env';

const summarizeIntakeResultSchema = z
  .object({
    profileJson: z.record(z.any()),
    summaryText: z.string(),
    flags: z.array(z.enum(['injury', 'pain', 'marathon', 'triathlon'])),
  })
  .strict();

const draftPlanSetupSchema = z
  .object({
    eventDate: z.string().min(1),
    weeksToEvent: z.number().int().min(1).max(52),
    weeklyAvailabilityDays: z.array(z.number().int().min(0).max(6)),
    weeklyAvailabilityMinutes: z.union([z.number().int().min(0), z.record(z.number().int().min(0))]),
    disciplineEmphasis: z.enum(['balanced', 'swim', 'bike', 'run']),
    riskTolerance: z.enum(['low', 'med', 'high']),
    maxIntensityDaysPerWeek: z.number().int().min(1).max(3),
    maxDoublesPerWeek: z.number().int().min(0).max(3),
    longSessionDay: z.number().int().min(0).max(6).nullable().optional(),
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

  constructor(options?: {
    deterministicFallback?: AiPlanBuilderAI;
    transport?: ReturnType<typeof getAiPlanBuilderLlmTransport>;
  }) {
    const fallback = options?.deterministicFallback ?? new DeterministicAiPlanBuilderAI({ recordAudit: false });
    this.delegate = fallback;
    this.transportOverride = options?.transport;
  }

  private async generateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const attempts = 2;
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

  private async callOrFallback<T>(params: {
    capability: 'summarizeIntake' | 'suggestDraftPlan' | 'suggestProposalDiffs';
    input: unknown;
    schema: z.ZodTypeAny;
    system: string;
    deterministicFallback: () => Promise<T>;
  }): Promise<T> {
    const auditBase = computeAiUsageAudit({
      capability: params.capability,
      mode: 'llm',
      input: params.input,
      output: { pending: true },
    });

    try {
      const cfg = getAiPlanBuilderLlmConfig();
      const transport = this.transportOverride ?? getAiPlanBuilderLlmTransport();

      logMeta('LLM_CALL_ATTEMPT', {
        capability: params.capability,
        provider: cfg.provider,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs,
        maxOutputTokens: cfg.maxOutputTokens,
        inputHash: auditBase.inputHash,
      });

      const output = await this.generateWithRetry(async () =>
        transport.generateStructuredJson({
          system: `APB_CAPABILITY=${params.capability}\n${params.system}`,
          input: JSON.stringify(params.input),
          schema: params.schema,
          model: cfg.model || 'mock',
          maxOutputTokens: cfg.maxOutputTokens,
          timeoutMs: cfg.timeoutMs,
        })
      );

      recordAiUsageAudit(
        computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output })
      );

      logMeta('LLM_CALL_SUCCEEDED', {
        capability: params.capability,
        inputHash: auditBase.inputHash,
        outputHash: computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output }).outputHash,
      });

      return output as T;
    } catch (err) {
      const fallback = await params.deterministicFallback();
      const audit = computeAiUsageAudit({ capability: params.capability, mode: 'llm', input: params.input, output: fallback });

      logMeta('LLM_FALLBACK_USED', {
        capability: params.capability,
        reason: err instanceof AiPlanBuilderLlmError ? err.code : 'UNKNOWN',
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
}
