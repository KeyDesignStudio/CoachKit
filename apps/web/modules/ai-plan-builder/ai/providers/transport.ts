import type { z } from 'zod';

export type GenerateStructuredJsonParams<TSchema extends z.ZodTypeAny> = {
  system: string;
  input: string;
  schema: TSchema;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

export interface AiPlanBuilderLlmTransport {
  generateStructuredJson<TSchema extends z.ZodTypeAny>(
    params: GenerateStructuredJsonParams<TSchema>
  ): Promise<z.infer<TSchema>>;
}
