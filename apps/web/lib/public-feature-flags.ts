function parsePublicFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

// Client-side flag. Defaults to false.
export const AI_PLAN_BUILDER_V1 = parsePublicFlag(process.env.NEXT_PUBLIC_AI_PLAN_BUILDER_V1);

export const FEATURE_FLAGS_PUBLIC = {
  AI_PLAN_BUILDER_V1,
} as const;
