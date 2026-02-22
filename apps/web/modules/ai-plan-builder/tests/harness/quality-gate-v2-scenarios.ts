import type { DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';
import type { DraftConstraintViolation } from '@/modules/ai-plan-builder/rules/constraint-validator';

export type QualityGateV2Thresholds = {
  minScore: number;
  maxHardViolations: number;
  maxSoftWarnings: number;
  minWeeklyMinutesInBandRate: number;
  minKeySessionBandPassRate: number;
  minNonConsecutiveIntensityRate: number;
  minNoLongThenIntensityRate: number;
  minExplainabilityCoverageRate: number;
  minAvailabilityAdherenceRate: number;
  minDoublesComplianceRate: number;
  minIntensityCapComplianceRate: number;
};

export type QualityGateV2Scenario = {
  id: string;
  description: string;
  setup: DraftPlanSetupV1;
  thresholds: QualityGateV2Thresholds;
  evidence?: {
    minWeekCount?: number;
    minTotalSessions?: number;
    maxSessionsOnAnyDay?: number;
    forbiddenHardViolationCodes?: DraftConstraintViolation['code'][];
    forbiddenSoftWarningCodes?: DraftConstraintViolation['code'][];
  };
};

const baseSetup: DraftPlanSetupV1 = {
  weekStart: 'monday',
  startDate: '2026-02-02',
  eventDate: '2026-05-11',
  weeksToEvent: 14,
  weeklyAvailabilityDays: [1, 2, 3, 4, 6],
  weeklyAvailabilityMinutes: 360,
  disciplineEmphasis: 'balanced',
  riskTolerance: 'med',
  maxIntensityDaysPerWeek: 2,
  maxDoublesPerWeek: 1,
  longSessionDay: 6,
  policyProfileId: 'coachkit-safe-v1',
};

export const qualityGateV2Scenarios: QualityGateV2Scenario[] = [
  {
    id: 'beginner-safe-5k',
    description: 'Beginner run focus with strict no-doubles and conservative ramp.',
    setup: {
      ...baseSetup,
      disciplineEmphasis: 'run',
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      weeklyAvailabilityMinutes: 220,
      weeksToEvent: 10,
      eventDate: '2026-04-13',
      programPolicy: 'COUCH_TO_5K',
      coachGuidanceText: 'Beginner athlete. Couch to 5k progression.',
      requestContext: {
        experienceLevel: 'Beginner',
        injuryStatus: '',
        constraintsNotes: '',
        availabilityDays: ['Tue', 'Wed', 'Thu', 'Sat', 'Sun'],
      },
    },
    thresholds: {
      minScore: 80,
      maxHardViolations: 0,
      maxSoftWarnings: 5,
      minWeeklyMinutesInBandRate: 0.9,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 0.2,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 10,
      minTotalSessions: 30,
      maxSessionsOnAnyDay: 1,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'BEGINNER_RUN_CAP_EXCEEDED', 'BEGINNER_BRICK_TOO_EARLY'],
    },
  },
  {
    id: 'injury-and-travel-constrained',
    description: 'Injury + travel must downshift safely while maintaining session intent.',
    setup: {
      ...baseSetup,
      weeksToEvent: 12,
      eventDate: '2026-04-27',
      weeklyAvailabilityMinutes: 320,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      coachGuidanceText:
        'Mild achilles pain and travel for business on Mar 3-8. Keep consistency and avoid aggressive loading.',
      requestContext: {
        injuryStatus: 'Mild achilles pain',
        constraintsNotes: 'Travel Mar 3-8',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Sat'],
      },
    },
    thresholds: {
      minScore: 100,
      maxHardViolations: 0,
      maxSoftWarnings: 0,
      minWeeklyMinutesInBandRate: 1,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 12,
      minTotalSessions: 40,
      maxSessionsOnAnyDay: 1,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'MAX_INTENSITY_DAYS_EXCEEDED'],
      forbiddenSoftWarningCodes: ['WEEKLY_MINUTES_OUT_OF_BOUNDS'],
    },
  },
  {
    id: 'low-time-multisport',
    description: 'Limited time windows still preserve key-session structure with safe distribution.',
    setup: {
      ...baseSetup,
      weeklyAvailabilityMinutes: 210,
      maxDoublesPerWeek: 0,
      coachGuidanceText: 'Busy athlete with strict work schedule and short windows.',
      requestContext: {
        availableTimeMinutes: 45,
        dailyTimeWindows: {
          Mon: 'am',
          Tue: 'am',
          Wed: 'pm',
          Thu: 'pm',
          Sat: 'am',
        },
        availabilityDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Sat'],
      },
    },
    thresholds: {
      minScore: 100,
      maxHardViolations: 0,
      maxSoftWarnings: 0,
      minWeeklyMinutesInBandRate: 1,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 14,
      minTotalSessions: 50,
      maxSessionsOnAnyDay: 1,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION'],
      forbiddenSoftWarningCodes: ['WEEKLY_MINUTES_OUT_OF_BOUNDS'],
    },
  },
  {
    id: 'return-from-break',
    description: 'Athlete returning from time off should restart conservatively and avoid spikes.',
    setup: {
      ...baseSetup,
      weeksToEvent: 8,
      eventDate: '2026-03-30',
      weeklyAvailabilityMinutes: 260,
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      coachGuidanceText: 'Returning from 3 weeks off due to illness. Rebuild safely and avoid intensity stacking.',
      requestContext: {
        experienceLevel: 'Intermediate',
        injuryStatus: 'recent illness recovery',
        constraintsNotes: 'Restart block conservatively after break',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Fri', 'Sun'],
      },
    },
    thresholds: {
      minScore: 100,
      maxHardViolations: 0,
      maxSoftWarnings: 0,
      minWeeklyMinutesInBandRate: 1,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 8,
      minTotalSessions: 24,
      maxSessionsOnAnyDay: 1,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'BEGINNER_RUN_CAP_EXCEEDED'],
      forbiddenSoftWarningCodes: ['WEEKLY_MINUTES_OUT_OF_BOUNDS'],
    },
  },
  {
    id: 'event-near-taper',
    description: 'Final pre-event block should trend down into taper while preserving intent.',
    setup: {
      ...baseSetup,
      weeksToEvent: 6,
      eventDate: '2026-03-16',
      weeklyAvailabilityMinutes: 420,
      riskTolerance: 'med',
      coachGuidanceText: 'Final block before event. Taper correctly in final two weeks.',
      requestContext: {
        eventName: 'Olympic triathlon',
        eventDate: '2026-03-16',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Fri', 'Sun'],
      },
    },
    thresholds: {
      minScore: 95,
      maxHardViolations: 0,
      maxSoftWarnings: 1,
      minWeeklyMinutesInBandRate: 1,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 6,
      minTotalSessions: 24,
      maxSessionsOnAnyDay: 2,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION'],
    },
  },
  {
    id: 'ironman-26w-policy-pack',
    description: '26-week Ironman build should stay safety-compliant under higher volume profile.',
    setup: {
      ...baseSetup,
      weeksToEvent: 26,
      eventDate: '2026-08-03',
      weeklyAvailabilityDays: [1, 2, 3, 4, 5, 6, 0],
      weeklyAvailabilityMinutes: 720,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 2,
      policyProfileId: 'coachkit-performance-v1',
      programPolicy: 'COUCH_TO_IRONMAN_26',
      coachGuidanceText: 'Long-course triathlon build. Keep run durability protected.',
      requestContext: {
        experienceLevel: 'Intermediate',
        availabilityDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        constraintsNotes: '',
      },
    },
    thresholds: {
      minScore: 88,
      maxHardViolations: 0,
      maxSoftWarnings: 4,
      minWeeklyMinutesInBandRate: 0.9,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 0.2,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 26,
      minTotalSessions: 150,
      maxSessionsOnAnyDay: 2,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'MAX_INTENSITY_DAYS_EXCEEDED'],
    },
  },
  {
    id: 'half-to-full-marathon-bridge',
    description: 'Half-to-full bridge should remain run-centric, progressive, and capped on intensity.',
    setup: {
      ...baseSetup,
      weeksToEvent: 18,
      eventDate: '2026-06-08',
      weeklyAvailabilityDays: [1, 2, 4, 5, 0],
      weeklyAvailabilityMinutes: 460,
      disciplineEmphasis: 'run',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      programPolicy: 'HALF_TO_FULL_MARATHON',
      coachGuidanceText: 'Half marathon athlete progressing to full marathon safely.',
      requestContext: {
        experienceLevel: 'Intermediate',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Fri', 'Sun'],
        constraintsNotes: '',
      },
    },
    thresholds: {
      minScore: 84,
      maxHardViolations: 0,
      maxSoftWarnings: 4,
      minWeeklyMinutesInBandRate: 0.9,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 0.2,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 18,
      minTotalSessions: 90,
      maxSessionsOnAnyDay: 2,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION'],
    },
  },
  {
    id: 'conservative-profile-zero-doubles',
    description: 'Conservative profile with strict no-doubles must stay single-session/day and in availability.',
    setup: {
      ...baseSetup,
      weeksToEvent: 16,
      eventDate: '2026-05-25',
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 280,
      disciplineEmphasis: 'run',
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      policyProfileId: 'coachkit-conservative-v1',
      coachGuidanceText: 'Beginner-intermediate runner. Durability first, no doubles.',
      requestContext: {
        experienceLevel: 'Beginner',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Sat'],
        constraintsNotes: 'No double days due to work + parenting load',
      },
    },
    thresholds: {
      minScore: 95,
      maxHardViolations: 0,
      maxSoftWarnings: 1,
      minWeeklyMinutesInBandRate: 0.95,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 16,
      minTotalSessions: 48,
      maxSessionsOnAnyDay: 1,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'CONSECUTIVE_INTENSITY_DAYS'],
    },
  },
  {
    id: 'performance-profile-controlled-doubles',
    description: 'Performance profile allows doubles but must remain capped and avoid off-day drift.',
    setup: {
      ...baseSetup,
      weeksToEvent: 20,
      eventDate: '2026-06-22',
      weeklyAvailabilityDays: [1, 2, 3, 4, 5, 6, 0],
      weeklyAvailabilityMinutes: 640,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'high',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 2,
      policyProfileId: 'coachkit-performance-v1',
      coachGuidanceText: 'Advanced triathlete building race specificity while managing stress stacking.',
      requestContext: {
        experienceLevel: 'Advanced',
        availabilityDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        constraintsNotes: 'Keep doubles controlled to two max per week.',
      },
    },
    thresholds: {
      minScore: 88,
      maxHardViolations: 0,
      maxSoftWarnings: 4,
      minWeeklyMinutesInBandRate: 0.9,
      minKeySessionBandPassRate: 1,
      minNonConsecutiveIntensityRate: 1,
      minNoLongThenIntensityRate: 0.9,
      minExplainabilityCoverageRate: 1,
      minAvailabilityAdherenceRate: 1,
      minDoublesComplianceRate: 1,
      minIntensityCapComplianceRate: 1,
    },
    evidence: {
      minWeekCount: 20,
      minTotalSessions: 120,
      maxSessionsOnAnyDay: 2,
      forbiddenHardViolationCodes: ['MAX_DOUBLES_EXCEEDED', 'OFF_DAY_SESSION', 'MAX_INTENSITY_DAYS_EXCEEDED'],
    },
  },
];
