import { z } from 'zod';

import { prisma } from '@/lib/prisma';

import type { AiCapabilityName } from '../ai/audit';
import {
  getAiPlanBuilderAIModeFromEnv,
  getAiPlanBuilderCapabilityModeFromEnv,
  getAiPlanBuilderLlmMaxOutputTokensFromEnv,
  getAiPlanBuilderLlmModelForCapabilityFromEnv,
  getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv,
  getAiPlanBuilderLlmRateLimitPerHourFromEnv,
  getAiPlanBuilderLlmRetryCountFromEnv,
} from '../ai/config';
import { getAiPlanBuilderRuntimeOverrides, setAiPlanBuilderRuntimeOverrides, type AiRuntimeOverrideMap } from '../ai/runtime-overrides';
import { getAiPlanBuilderLlmConfigFromEnv, type AiPlanBuilderLlmProvider } from '../ai/providers/env';

const capabilitySchema = z.enum([
  'summarizeIntake',
  'suggestDraftPlan',
  'suggestProposalDiffs',
  'generateSessionDetail',
  'generateIntakeFromProfile',
  'generateAthleteBriefFromIntake',
]);

const capabilityOverrideSchema = z
  .object({
    mode: z.enum(['inherit', 'deterministic', 'llm']).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    maxOutputTokens: z.number().int().min(128).max(8192).optional(),
    rateLimitPerHour: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

const runtimeOverridesSchema = z
  .object({
    aiMode: z.enum(['deterministic', 'llm']).optional(),
    llmProvider: z.enum(['openai', 'mock']).optional(),
    llmModel: z.string().trim().min(1).max(120).optional(),
    llmTimeoutMs: z.number().int().min(1000).max(120000).optional(),
    llmMaxOutputTokens: z.number().int().min(128).max(8192).optional(),
    llmRetryCount: z.number().int().min(0).max(2).optional(),
    llmRateLimitPerHour: z.number().int().min(1).max(5000).optional(),
    capabilities: z.record(capabilitySchema, capabilityOverrideSchema).optional(),
  })
  .strict();

export const aiEngineControlsUpsertSchema = z.object({
  overrides: runtimeOverridesSchema,
});

const CAPABILITIES: AiCapabilityName[] = [
  'summarizeIntake',
  'suggestDraftPlan',
  'suggestProposalDiffs',
  'generateSessionDetail',
  'generateIntakeFromProfile',
  'generateAthleteBriefFromIntake',
];

let lastRefreshAtMs = 0;

async function ensureEngineControlsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS apb_engine_controls (
      id TEXT PRIMARY KEY,
      override_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by_user_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function refreshAiEngineRuntimeOverridesFromDb(options?: { force?: boolean }) {
  const now = Date.now();
  if (!options?.force && now - lastRefreshAtMs < 30_000) return getAiPlanBuilderRuntimeOverrides();

  await ensureEngineControlsTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ override_json: unknown }>>(
    `SELECT override_json FROM apb_engine_controls WHERE id = 'global-v1' LIMIT 1`
  );
  const payload = rows[0]?.override_json ?? {};
  const parsed = runtimeOverridesSchema.safeParse(payload);
  const overrides = parsed.success ? (parsed.data as AiRuntimeOverrideMap) : {};
  setAiPlanBuilderRuntimeOverrides(overrides);
  lastRefreshAtMs = now;
  return overrides;
}

export async function upsertAiEngineControls(params: { overrides: AiRuntimeOverrideMap; actorUserId: string }) {
  await ensureEngineControlsTable();
  const parsed = runtimeOverridesSchema.parse(params.overrides ?? {});
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO apb_engine_controls (id, override_json, updated_by_user_id, updated_at)
      VALUES ('global-v1', $1::jsonb, $2, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        override_json = EXCLUDED.override_json,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = NOW()
    `,
    JSON.stringify(parsed),
    params.actorUserId
  );

  return refreshAiEngineRuntimeOverridesFromDb({ force: true });
}

function capabilityEnvSuffix(capability: AiCapabilityName): string {
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

function readRawEnvModel(capability: AiCapabilityName, env: NodeJS.ProcessEnv = process.env): string | null {
  const perCapKey = `AI_PLAN_BUILDER_LLM_MODEL_${capabilityEnvSuffix(capability)}`;
  const perCap = String(env[perCapKey] ?? '').trim();
  if (perCap) return perCap;
  const global = String(env.AI_PLAN_BUILDER_LLM_MODEL ?? '').trim();
  return global || null;
}

function resolveSource(params: { runtimeHasValue: boolean; envHasValue: boolean; defaultUsed: boolean }): 'runtime' | 'env' | 'default' {
  if (params.runtimeHasValue) return 'runtime';
  if (params.envHasValue) return 'env';
  return params.defaultUsed ? 'default' : 'env';
}

export async function getAiEngineControlsView() {
  await refreshAiEngineRuntimeOverridesFromDb();
  const runtime = getAiPlanBuilderRuntimeOverrides() ?? {};
  const llmCfg = getAiPlanBuilderLlmConfigFromEnv();
  const envProviderRaw = String(process.env.AI_PLAN_BUILDER_LLM_PROVIDER ?? '').trim().toLowerCase();
  const envTimeoutRaw = Number(process.env.AI_PLAN_BUILDER_LLM_TIMEOUT_MS ?? NaN);
  const envTokensRaw = Number(process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS ?? NaN);
  const envRetryRaw = Number.parseInt(String(process.env.AI_PLAN_BUILDER_LLM_RETRY_COUNT ?? ''), 10);
  const envRateRaw = Number.parseInt(String(process.env.AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR ?? ''), 10);

  const global = {
    aiMode: {
      value: getAiPlanBuilderAIModeFromEnv(),
      source: resolveSource({
        runtimeHasValue: Boolean(runtime.aiMode),
        envHasValue: Boolean(String(process.env.AI_PLAN_BUILDER_AI_MODE ?? '').trim()),
        defaultUsed: !String(process.env.AI_PLAN_BUILDER_AI_MODE ?? '').trim(),
      }),
    },
    llmProvider: {
      value: llmCfg.provider as AiPlanBuilderLlmProvider,
      source: resolveSource({
        runtimeHasValue: Boolean(runtime.llmProvider),
        envHasValue: Boolean(envProviderRaw),
        defaultUsed: !envProviderRaw,
      }),
    },
    llmModel: {
      value: String(llmCfg.model ?? '').trim() || null,
      source: resolveSource({
        runtimeHasValue: Boolean(runtime.llmModel),
        envHasValue: Boolean(String(process.env.AI_PLAN_BUILDER_LLM_MODEL ?? '').trim()),
        defaultUsed: !String(process.env.AI_PLAN_BUILDER_LLM_MODEL ?? '').trim(),
      }),
    },
    llmTimeoutMs: {
      value: llmCfg.timeoutMs,
      source: resolveSource({
        runtimeHasValue: Number.isFinite(Number(runtime.llmTimeoutMs ?? NaN)),
        envHasValue: Number.isFinite(envTimeoutRaw),
        defaultUsed: !Number.isFinite(envTimeoutRaw),
      }),
    },
    llmMaxOutputTokens: {
      value: llmCfg.maxOutputTokens,
      source: resolveSource({
        runtimeHasValue: Number.isFinite(Number(runtime.llmMaxOutputTokens ?? NaN)),
        envHasValue: Number.isFinite(envTokensRaw),
        defaultUsed: !Number.isFinite(envTokensRaw),
      }),
    },
    llmRetryCount: {
      value: getAiPlanBuilderLlmRetryCountFromEnv(),
      source: resolveSource({
        runtimeHasValue: Number.isFinite(Number(runtime.llmRetryCount ?? NaN)),
        envHasValue: Number.isFinite(envRetryRaw),
        defaultUsed: !Number.isFinite(envRetryRaw),
      }),
    },
    llmRateLimitPerHour: {
      value: getAiPlanBuilderLlmRateLimitPerHourFromEnv(),
      source: resolveSource({
        runtimeHasValue: Number.isFinite(Number(runtime.llmRateLimitPerHour ?? NaN)),
        envHasValue: Number.isFinite(envRateRaw),
        defaultUsed: !Number.isFinite(envRateRaw),
      }),
    },
  };

  const capabilities = CAPABILITIES.map((capability) => {
    const capRuntime = runtime.capabilities?.[capability];
    const envModeKey = `AI_PLAN_BUILDER_AI_CAP_${capabilityEnvSuffix(capability)}`;
    const envModeRaw = String(process.env[envModeKey] ?? '').trim();
    const envTokensKey = `AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS_${capabilityEnvSuffix(capability)}`;
    const envRateKey = `AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR_${capabilityEnvSuffix(capability)}`;

    return {
      capability,
      mode: {
        value: getAiPlanBuilderCapabilityModeFromEnv(capability),
        source: resolveSource({
          runtimeHasValue: Boolean(capRuntime?.mode),
          envHasValue: Boolean(envModeRaw),
          defaultUsed: !envModeRaw,
        }),
      },
      model: {
        value: getAiPlanBuilderLlmModelForCapabilityFromEnv(capability, process.env, { fallback: '' }) || null,
        source: resolveSource({
          runtimeHasValue: Boolean(capRuntime?.model),
          envHasValue: Boolean(readRawEnvModel(capability)),
          defaultUsed: !readRawEnvModel(capability),
        }),
      },
      maxOutputTokens: {
        value: getAiPlanBuilderLlmMaxOutputTokensFromEnv(capability, process.env, { fallback: llmCfg.maxOutputTokens }),
        source: resolveSource({
          runtimeHasValue: Number.isFinite(Number(capRuntime?.maxOutputTokens ?? NaN)),
          envHasValue:
            Number.isFinite(Number(process.env[envTokensKey] ?? NaN)) ||
            Number.isFinite(Number(process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS ?? NaN)),
          defaultUsed:
            !Number.isFinite(Number(process.env[envTokensKey] ?? NaN)) &&
            !Number.isFinite(Number(process.env.AI_PLAN_BUILDER_LLM_MAX_OUTPUT_TOKENS ?? NaN)),
        }),
      },
      rateLimitPerHour: {
        value: getAiPlanBuilderLlmRateLimitPerHourForCapabilityFromEnv(capability),
        source: resolveSource({
          runtimeHasValue: Number.isFinite(Number(capRuntime?.rateLimitPerHour ?? NaN)),
          envHasValue:
            Number.isFinite(Number.parseInt(String(process.env[envRateKey] ?? ''), 10)) ||
            Number.isFinite(Number.parseInt(String(process.env.AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR ?? ''), 10)),
          defaultUsed:
            !Number.isFinite(Number.parseInt(String(process.env[envRateKey] ?? ''), 10)) &&
            !Number.isFinite(Number.parseInt(String(process.env.AI_PLAN_BUILDER_LLM_RATE_LIMIT_PER_HOUR ?? ''), 10)),
        }),
      },
    };
  });

  return {
    runtimeOverrides: runtime,
    global,
    capabilities,
  };
}
