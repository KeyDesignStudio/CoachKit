function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isAiPlanBuilderV1EnabledServer(): boolean {
  // Server-side flag. Defaults to false.
  // Intentionally supports both env names to simplify local/dev.
  return parseEnvFlag(process.env.AI_PLAN_BUILDER_V1) || parseEnvFlag(process.env.NEXT_PUBLIC_AI_PLAN_BUILDER_V1);
}

export const FEATURE_FLAGS_SERVER = {
  AI_PLAN_BUILDER_V1: isAiPlanBuilderV1EnabledServer,
} as const;
