import OpenAI from 'openai';
import type { z } from 'zod';

import { AiPlanBuilderLlmError } from './errors';
import type { AiPlanBuilderLlmTransport, GenerateStructuredJsonParams } from './transport';

function extractOutputText(response: any): string {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text;

  const output = response?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const text = c?.text;
          if (typeof text === 'string' && text.trim()) return text;
        }
      }
    }
  }

  return '';
}

async function withTimeout<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AiPlanBuilderLlmError('INVALID_JSON', 'LLM returned invalid JSON.', { isRetryable: true, cause: err });
  }
}

export class OpenAiTransport implements AiPlanBuilderLlmTransport {
  private readonly client: OpenAI;

  constructor(params: { apiKey: string }) {
    this.client = new OpenAI({ apiKey: params.apiKey });
  }

  async generateStructuredJson<TSchema extends z.ZodTypeAny>(
    params: GenerateStructuredJsonParams<TSchema>
  ): Promise<z.infer<TSchema>> {
    try {
      const text = await withTimeout(params.timeoutMs, async (signal) => {
        const resp = await this.client.responses.create(
          {
            model: params.model,
            input:
              params.system +
              '\n\n' +
              params.input +
              '\n\n' +
              'Return ONLY a single JSON object (no markdown, no code fences).',
            max_output_tokens: params.maxOutputTokens,
          } as any,
          { signal } as any
        );

        const out = extractOutputText(resp);
        if (!out) {
          throw new AiPlanBuilderLlmError('PROVIDER_ERROR', 'LLM returned no text output.', { isRetryable: true });
        }
        return out;
      });

      const json = safeJsonParse(text);
      const parsed = params.schema.safeParse(json);
      if (!parsed.success) {
        throw new AiPlanBuilderLlmError('SCHEMA_VALIDATION_FAILED', 'LLM JSON failed schema validation.', {
          isRetryable: true,
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (err) {
      const isAbort = (err as any)?.name === 'AbortError';
      if (isAbort) {
        throw new AiPlanBuilderLlmError('TIMEOUT', 'LLM request timed out.', { isRetryable: true, cause: err });
      }

      if (err instanceof AiPlanBuilderLlmError) throw err;
      throw new AiPlanBuilderLlmError('NETWORK', 'LLM request failed.', { isRetryable: true, cause: err });
    }
  }
}
