import { z } from 'zod';

export const sessionRecipeGoalSchema = z.enum([
  'aerobic-durability',
  'threshold-development',
  'tempo-control',
  'technique-quality',
  'recovery-absorption',
  'strength-resilience',
  'race-specificity',
]);

export const sessionRecipeTargetSchema = z
  .object({
    metric: z.enum(['RPE', 'ZONE', 'PACE', 'POWER', 'HEART_RATE']),
    value: z.string().min(1).max(120),
    notes: z.string().min(1).max(260).optional(),
  })
  .strict();

export const sessionRecipeIntervalSchema = z
  .object({
    reps: z.number().int().min(1).max(200).optional(),
    on: z.string().min(1).max(80),
    off: z.string().min(1).max(80).optional(),
    intent: z.string().min(1).max(220),
  })
  .strict();

export const sessionRecipeBlockSchema = z
  .object({
    key: z.enum(['warmup', 'main', 'cooldown', 'drill', 'strength']),
    durationMinutes: z.number().int().min(0).max(10_000).optional(),
    target: sessionRecipeTargetSchema.optional(),
    intervals: z.array(sessionRecipeIntervalSchema).max(12).optional(),
    notes: z.array(z.string().min(1).max(220)).max(6).optional(),
  })
  .strict();

export const sessionRecipeAdjustmentsSchema = z
  .object({
    ifMissed: z.array(z.string().min(1).max(220)).min(1).max(4),
    ifCooked: z.array(z.string().min(1).max(220)).min(1).max(4),
  })
  .strict();

export const sessionRecipeV2Schema = z
  .object({
    version: z.literal('v2'),
    primaryGoal: sessionRecipeGoalSchema,
    executionSummary: z.string().min(1).max(320),
    blocks: z.array(sessionRecipeBlockSchema).min(1).max(20),
    adjustments: sessionRecipeAdjustmentsSchema,
    qualityChecks: z.array(z.string().min(1).max(220)).min(1).max(5),
  })
  .strict();

export type SessionRecipeV2 = z.infer<typeof sessionRecipeV2Schema>;

