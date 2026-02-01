import type { z } from 'zod';

import { AiPlanBuilderLlmError } from './errors';
import type { AiPlanBuilderLlmTransport, GenerateStructuredJsonParams } from './transport';

import { DeterministicAiPlanBuilderAI } from '../deterministic';

/**
 * Test-only transport. Returns deterministic fixtures; never makes network calls.
 */
export class MockTransport implements AiPlanBuilderLlmTransport {
  private readonly scriptedJsonByCall: Array<unknown>;
  private callIndex = 0;
  private readonly deterministic: DeterministicAiPlanBuilderAI;

  constructor(options?: { scriptedJsonByCall?: Array<unknown> }) {
    this.scriptedJsonByCall = options?.scriptedJsonByCall ?? [];
    this.deterministic = new DeterministicAiPlanBuilderAI({ recordAudit: false });
  }

  async generateStructuredJson<TSchema extends z.ZodTypeAny>(
    params: GenerateStructuredJsonParams<TSchema>
  ): Promise<z.infer<TSchema>> {
    const next = this.scriptedJsonByCall[this.callIndex];
    this.callIndex++;

    let payload: unknown;
    if (next !== undefined) {
      payload = next;
    } else {
      const m = String(params.system).match(/\bAPB_CAPABILITY\s*=\s*(summarizeIntake|suggestDraftPlan|suggestProposalDiffs|generateSessionDetail)\b/);
      const capability = m?.[1] ?? '';
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(params.input);
      } catch (err) {
        throw new AiPlanBuilderLlmError('INVALID_JSON', 'Mock transport received invalid JSON input.', {
          isRetryable: false,
          cause: err,
        });
      }

      if (capability === 'summarizeIntake') payload = await this.deterministic.summarizeIntake(parsedInput as any);
      else if (capability === 'suggestDraftPlan') payload = await this.deterministic.suggestDraftPlan(parsedInput as any);
      else if (capability === 'suggestProposalDiffs') payload = await this.deterministic.suggestProposalDiffs(parsedInput as any);
      else if (capability === 'generateSessionDetail') payload = await this.deterministic.generateSessionDetail(parsedInput as any);
      else {
        throw new AiPlanBuilderLlmError('PROVIDER_ERROR', 'Mock transport missing or invalid capability tag.', {
          isRetryable: false,
        });
      }
    }

    const parsed = params.schema.safeParse(payload);
    if (!parsed.success) {
      throw new AiPlanBuilderLlmError('SCHEMA_VALIDATION_FAILED', 'Mock transport payload failed schema validation.', {
        isRetryable: true,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
