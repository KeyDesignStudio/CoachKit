import { computeStableSha256 } from '../rules/stable-hash';
import type { AiPlanBuilderAIMode } from './types';

export type AiCapabilityName = 'summarizeIntake' | 'suggestDraftPlan' | 'suggestProposalDiffs';

export type AiUsageAudit = {
  capability: AiCapabilityName;
  mode: AiPlanBuilderAIMode;
  inputHash: string;
  outputHash: string;
};

export type AiInvocationAuditMeta = {
  capability: AiCapabilityName;
  specVersion: string;
  effectiveMode: AiPlanBuilderAIMode;

  provider: 'deterministic' | 'mock' | 'openai' | 'unknown';
  model: string | null;

  inputHash: string;
  outputHash: string;

  durationMs: number;
  maxOutputTokens: number | null;
  timeoutMs: number | null;
  retryCount: number;
  fallbackUsed: boolean;
  errorCode: string | null;
};

export function computeAiUsageAudit(params: {
  capability: AiCapabilityName;
  mode: AiPlanBuilderAIMode;
  input: unknown;
  output: unknown;
}): AiUsageAudit {
  return {
    capability: params.capability,
    mode: params.mode,
    inputHash: computeStableSha256(params.input),
    outputHash: computeStableSha256(params.output),
  };
}

export function recordAiUsageAudit(audit: AiUsageAudit) {
  // Safety: hashes only; no PII or raw payloads.
  // This is a hook point for later persistence into DB audit tables.
  // For now we only emit debug logs.
  // eslint-disable-next-line no-console
  console.debug('AI_USAGE', audit);
}
