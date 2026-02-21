import type { DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

export type QualityGateV2Thresholds = {
  minScore: number;
  maxHardViolations: number;
  maxSoftWarnings: number;
  minWeeklyMinutesInBandRate: number;
  minKeySessionBandPassRate: number;
  minNonConsecutiveIntensityRate: number;
  minNoLongThenIntensityRate: number;
  minExplainabilityCoverageRate: number;
};

export type QualityGateV2Scenario = {
  id: string;
  description: string;
  setup: DraftPlanSetupV1;
  thresholds: QualityGateV2Thresholds;
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
      minNoLongThenIntensityRate: 1,
      minExplainabilityCoverageRate: 1,
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
    },
  },
];
