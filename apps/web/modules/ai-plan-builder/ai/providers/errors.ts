export type AiPlanBuilderLlmErrorCode =
  | 'CONFIG_MISSING'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_JSON'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'PROVIDER_ERROR';

export class AiPlanBuilderLlmError extends Error {
  readonly code: AiPlanBuilderLlmErrorCode;
  readonly isRetryable: boolean;

  constructor(code: AiPlanBuilderLlmErrorCode, message: string, options?: { isRetryable?: boolean; cause?: unknown }) {
    super(message);
    this.name = 'AiPlanBuilderLlmError';
    this.code = code;
    this.isRetryable = options?.isRetryable ?? false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).cause = options?.cause;
  }
}
