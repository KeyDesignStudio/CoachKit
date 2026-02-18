import type { AiCapabilityName } from './audit';
import type { AiPlanBuilderAIMode } from './types';

export type AiPlanBuilderCapabilityMode = 'inherit' | 'deterministic' | 'llm';

function normalizeMode(raw: unknown): AiPlanBuilderCapabilityMode {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'deterministic') return 'deterministic';
  if (v === 'llm') return 'llm';
  return 'inherit';
}

export function getAiPlanBuilderAIModeFromEnv(env: NodeJS.ProcessEnv = process.env): AiPlanBuilderAIMode {
  const raw = String(env.AI_PLAN_BUILDER_AI_MODE ?? '').trim().toLowerCase();
  return raw === 'llm' ? 'llm' : 'deterministic';
}

function getCapabilityModeEnvVar(capability: AiCapabilityName): string {
  switch (capability) {
    case 'summarizeIntake':
      return 'AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE';
    case 'suggestDraftPlan':
      return 'AI_PLAN_BUILDER_AI_CAP_SUGGEST_DRAFT_PLAN';
    case 'suggestProposalDiffs':
      return 'AI_PLAN_BUILDER_AI_CAP_SUGGEST_PROPOSAL_DIFFS';
    case 'generateSessionDetail':
      return 'AI_PLAN_BUILDER_AI_CAP_GENERATE_SESSION_DETAIL';
    case 'generateIntakeFromProfile':
      return 'AI_PLAN_BUILDER_AI_CAP_GENERATE_INTAKE_FROM_PROFILE';
    case 'generateAthleteBriefFromIntake':
      return 'AI_PLAN_BUILDER_AI_CAP_GENERATE_ATHLETE_BRIEF_FROM_INTAKE';
  }
}

export function getAiPlanBuilderCapabilityModeFromEnv(
  capability: AiCapabilityName,
  env: NodeJS.ProcessEnv = process.env
): AiPlanBuilderCapabilityMode {
  const key = getCapabilityModeEnvVar(capability);
  return normalizeMode(env[key]);
}

export function getAiPlanBuilderEffectiveMode(
  capability: AiCapabilityName,
  env: NodeJS.ProcessEnv = process.env
): AiPlanBuilderAIMode {
  const globalMode = getAiPlanBuilderAIModeFromEnv(env);
  const override = getAiPlanBuilderCapabilityModeFromEnv(capability, env);
  if (override === 'deterministic' || override === 'llm') return override;
  return globalMode;
}

export function getAiPlanBuilderCapabilitySpecVersion(capability: AiCapabilityName): string {
  switch (capability) {
    case 'summarizeIntake':
      return 'apb.summarizeIntake@v1';
    case 'suggestDraftPlan':
      return 'apb.suggestDraftPlan@v1';
    case 'suggestProposalDiffs':
      return 'apb.suggestProposalDiffs@v1';
    case 'generateSessionDetail':
      return 'apb.generateSessionDetail@v1';
    case 'generateIntakeFromProfile':
      return 'apb.generateIntakeFromProfile@v1';
    case 'generateAthleteBriefFromIntake':
      return 'apb.generateAthleteBriefFromIntake@v1';
  }
}

function parsePositiveInt(raw: unknown): number | null {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getCapabilitySuffix(capability: AiCapabilityName): string {
  switch (capability) {
    case 'summarizeIntake':
      return 'SUMMARIZE_INTAKE';
    case 'suggestDraftPlan':
      return 'SUGGEST_DRAFT_PLAN';
    case 'suggestProposalDiffs':
      return 'SUGGEST_PROPOSAL_DIFFS';
    case 'generateSessionDetail':
      return 'GENERATE_SESSION_DETAIL';
    case 'generateIntakeFromProfile':
      return 'GENERATE_INTAKE_FROM_PROFILE';
    case 'generateAthleteBriefFromIntake':
      return 'GENERATE_ATHLETE_BRIEF_FROM_INTAKE';
  }
}

export function getAiPlanBuilderLlmMaxOutputTokensFromEnv(
  capability: AiCapabilityName,
  env: NodeJS.ProcessEnv = process.env,
  options?: { fallback?: number }
): number {
  const fallback = Math.max(1, options?.fallback ?? 1200);

  const perCapKey = `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_${getCapabilitySuffix(capability)}`;

  const perCap = parsePositiveInt(env[perCapKey]);
  if (perCap !== null) return perCap;

  const global = parsePositiveInt(env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS);
  if (global !== null) return global;

  return fallback;
}

export function getAiPlanBuilderLlmRetryCountFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(String(env.AI_PLAN_BUILDER_LLM_RETRY_COUNT ?? ''), 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(2, raw));
}

export function getAiPlanBuilderLlmRateLimitPerHourFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number.parseInt(String(env.AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR ?? ''), 10);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, raw);
}

export function getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv(
  capability: AiCapabilityName,
  env: NodeJS.ProcessEnv = process.env
): number {
  const key = `AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR_${getCapabilitySuffix(capability)}`;
  const perCap = Number.parseInt(String(env[key] ?? ''), 10);
  if (Number.isFinite(perCap) && perCap > 0) return perCap;
  return getAiPlanBuilderLlmRateLimitPerHourFromEnv(env);
}

export function getAiPlanBuilderLlmModelForCapabilityFromEnv(
  capability: AiCapabilityName,
  env: NodeJS.ProcessEnv = process.env,
  options?: { fallback?: string }
): string {
  const key = `AI_PLAN_BUILDER_LLM_MODEL_${getCapabilitySuffix(capability)}`;
  const perCap = String(env[key] ?? '').trim();
  if (perCap) return perCap;
  const globalModel = String(env.AI_PLAN_BUILDER_LLM_MODEL ?? '').trim();
  if (globalModel) return globalModel;
  return String(options?.fallback ?? '').trim();
}
