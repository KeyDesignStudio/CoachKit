import type { AssistantPatternCategory, AssistantSeverity, Prisma } from '@prisma/client';

export type AssistantPatternSeed = {
  key: string;
  name: string;
  category: AssistantPatternCategory;
  description: string;
  version: number;
  severityDefault: AssistantSeverity;
  cooldownDays: number;
  logicConfig: Prisma.JsonObject;
};

export const ASSISTANT_PATTERN_DEFINITIONS_V1: AssistantPatternSeed[] = [
  {
    key: 'sleep_underperformance_v1',
    name: 'Sleep-linked key session quality drop',
    category: 'READINESS',
    description: 'Detects reduced key-session quality when sleep falls below threshold.',
    version: 1,
    severityDefault: 'MEDIUM',
    cooldownDays: 7,
    logicConfig: {
      windowDays: 35,
      cooldownDays: 7,
      requiredSignals: ['sleep_hours', 'session_outcome'],
      keySessionClassifier: {
        calendarItem: {
          intensityTypes: ['THRESHOLD', 'VO2', 'Z4', 'Z5'],
          titleRegex: '(threshold|vo2|interval|tempo|race pace)',
        },
      },
      thresholds: {
        lowSleepHours: 6,
        minKeySessions: 5,
        minLowSleepKeySessions: 3,
        completionDeltaPct: 15,
        rpeDelta: 1,
      },
      severityRules: {
        high: 'completion_delta_pct>=25 OR missed_intervals_count>=3',
        medium: 'completion_delta_pct>=15',
        low: 'otherwise',
      },
    },
  },
  {
    key: 'monday_skip_cluster_v1',
    name: 'Monday skip clustering after hard weekend',
    category: 'ADHERENCE',
    description: 'Detects repeated Monday misses following hard Sunday load.',
    version: 1,
    severityDefault: 'MEDIUM',
    cooldownDays: 14,
    logicConfig: {
      windowDays: 42,
      cooldownDays: 14,
      requiredSignals: ['calendar_status', 'daily_load'],
      thresholds: {
        targetWeekday: 1,
        minMisses: 3,
        priorDayHard: {
          durationMinutes: 90,
          intensityCount: 1,
        },
      },
      missStatus: ['SKIPPED'],
      severityRules: {
        high: 'miss_count>=4',
        medium: 'miss_count==3',
        low: 'otherwise',
      },
    },
  },
  {
    key: 'fatigue_intensity_collision_v1',
    name: 'Rising fatigue + intensity collision',
    category: 'RISK',
    description: 'Detects rapid load ramp with clustered intensity sessions.',
    version: 1,
    severityDefault: 'HIGH',
    cooldownDays: 7,
    logicConfig: {
      windowDays: 42,
      cooldownDays: 7,
      requiredSignals: ['rolling_load', 'intensity_density'],
      thresholds: {
        acuteDays: 7,
        chronicDays: 28,
        acwrHigh: 1.25,
        intensityClusterDays: 3,
        minIntensitySessionsInCluster: 2,
        fatigueScoreHigh: 7,
      },
      severityRules: {
        high: 'acwr>=1.4 AND cluster_hits>=2',
        medium: 'acwr>=1.25 AND cluster_hits>=1',
        low: 'otherwise',
      },
    },
  },
  {
    key: 'heat_context_penalty_v1',
    name: 'Heat/environment penalty pattern',
    category: 'ENVIRONMENT',
    description: 'Detects repeated quality drop under hotter conditions.',
    version: 1,
    severityDefault: 'MEDIUM',
    cooldownDays: 10,
    logicConfig: {
      windowDays: 56,
      cooldownDays: 10,
      requiredSignals: ['temperature', 'outcome_proxy'],
      thresholds: {
        hotTempC: 26,
        minHotInstances: 3,
        minComparisonInstances: 3,
        pacePenaltyPct: 4,
        hrPenaltyBpm: 5,
        rpeDelta: 1,
      },
      matching: {
        sameDiscipline: true,
        durationTolerancePct: 15,
        routeOptional: true,
      },
      severityRules: {
        high: 'pace_penalty_pct>=7 OR hr_penalty_bpm>=8',
        medium: 'pace_penalty_pct>=4 OR hr_penalty_bpm>=5',
        low: 'otherwise',
      },
    },
  },
  {
    key: 'long_session_fade_v1',
    name: 'Long-session fade (durability)',
    category: 'DURABILITY',
    description: 'Detects repeated second-half fade in long sessions.',
    version: 1,
    severityDefault: 'MEDIUM',
    cooldownDays: 7,
    logicConfig: {
      windowDays: 42,
      cooldownDays: 7,
      requiredSignals: ['long_session_split'],
      thresholds: {
        minLongSessionMinutes: 75,
        minSessions: 4,
        fadePct: 5,
        hrDriftPct: 5,
      },
      severityRules: {
        high: 'fade_instances>=3 AND max_fade_pct>=8',
        medium: 'fade_instances>=2',
        low: 'otherwise',
      },
    },
  },
];
