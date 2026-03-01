import { ChallengeType } from '@prisma/client';
import { z } from 'zod';

const requiredString = z.string().trim().min(1);

export const challengeTypeSchema = z.nativeEnum(ChallengeType);

export const challengeCreateSchema = z
  .object({
    title: requiredString.max(120),
    description: z.string().trim().max(4000).optional().nullable(),
    squadId: z.string().cuid().or(z.string().cuid2()),
    type: challengeTypeSchema,
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional().nullable(),
    isOngoing: z.boolean().optional().default(false),
    disciplineScope: z.array(z.string().trim().min(1).max(32)).max(16).optional().default([]),
    scoringConfig: z.record(z.unknown()),
    participationConfig: z.record(z.unknown()).optional(),
    rewardConfig: z.record(z.unknown()).optional(),
    status: z.enum(['DRAFT', 'ACTIVE']).optional().default('DRAFT'),
    notifySquad: z.boolean().optional().default(false),
  })
  .superRefine((input, ctx) => {
    if (!input.isOngoing && !input.endAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required unless challenge is ongoing.',
        path: ['endAt'],
      });
    }

    if (!input.isOngoing && input.endAt && input.endAt < input.startAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date must be on or after start date.',
        path: ['endAt'],
      });
    }
  });

const volumeScoringSchema = z.object({
  metric: z.enum(['distance', 'time', 'elevation']),
  minSessionDurationMinutes: z.number().int().min(0).max(24 * 60).optional().nullable(),
  includeIndoor: z.boolean().optional().default(true),
});

const frequencyScoringSchema = z.object({
  metric: z.literal('sessions_completed').optional().default('sessions_completed'),
  targetCount: z.number().int().min(1).max(5000).optional().nullable(),
  minSessionDurationMinutes: z.number().int().min(0).max(24 * 60).optional().nullable(),
});

const performanceScoringSchema = z.object({
  metric: z.enum(['highest_average_power', 'fastest_5km', 'best_pace']),
  manualApproval: z.boolean().optional().default(false),
});

const pointsScoringSchema = z.object({
  metric: z.literal('points').optional().default('points'),
});

export const participationConfigSchema = z.object({
  autoJoin: z.boolean().default(true),
  allowLateJoin: z.boolean().default(true),
});

export const rewardConfigSchema = z.object({
  participationBadge: z.boolean().default(true),
  winnerBadges: z.boolean().default(true),
  prizeText: z.string().trim().max(240).optional().nullable(),
});

export type ChallengeParticipationConfig = z.infer<typeof participationConfigSchema>;
export type ChallengeRewardConfig = z.infer<typeof rewardConfigSchema>;

export type VolumeScoringConfig = z.infer<typeof volumeScoringSchema>;
export type FrequencyScoringConfig = z.infer<typeof frequencyScoringSchema>;
export type PerformanceScoringConfig = z.infer<typeof performanceScoringSchema>;
export type PointsScoringConfig = z.infer<typeof pointsScoringSchema>;

export function parseScoringConfig(type: ChallengeType, scoringConfig: unknown) {
  if (type === ChallengeType.VOLUME) return volumeScoringSchema.parse(scoringConfig);
  if (type === ChallengeType.FREQUENCY) return frequencyScoringSchema.parse(scoringConfig);
  if (type === ChallengeType.PERFORMANCE) return performanceScoringSchema.parse(scoringConfig);
  return pointsScoringSchema.parse(scoringConfig);
}

export function parseParticipationConfig(config: unknown): ChallengeParticipationConfig {
  return participationConfigSchema.parse(config ?? {});
}

export function parseRewardConfig(config: unknown): ChallengeRewardConfig {
  return rewardConfigSchema.parse(config ?? {});
}

export function challengeRulesSummary(type: ChallengeType, scoringConfig: unknown): string {
  if (type === ChallengeType.VOLUME) {
    const parsed = volumeScoringSchema.parse(scoringConfig);
    const metricLabel = parsed.metric === 'distance' ? 'distance' : parsed.metric === 'time' ? 'time' : 'elevation';
    const minDuration = parsed.minSessionDurationMinutes ? `, min ${parsed.minSessionDurationMinutes} min` : '';
    return `Highest total ${metricLabel}${minDuration}`;
  }

  if (type === ChallengeType.FREQUENCY) {
    const parsed = frequencyScoringSchema.parse(scoringConfig);
    const target = parsed.targetCount ? ` target ${parsed.targetCount}` : '';
    const minDuration = parsed.minSessionDurationMinutes ? `, min ${parsed.minSessionDurationMinutes} min` : '';
    return `Most sessions${target}${minDuration}`;
  }

  if (type === ChallengeType.PERFORMANCE) {
    const parsed = performanceScoringSchema.parse(scoringConfig);
    if (parsed.metric === 'highest_average_power') return 'Highest average power';
    if (parsed.metric === 'fastest_5km') return 'Fastest 5km pace';
    return 'Best pace';
  }

  return 'Most points';
}
