import type { DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

export type PhaseCGoldenScenario = {
  id: string;
  description: string;
  setup: DraftPlanSetupV1;
};

const baseSetup: DraftPlanSetupV1 = {
  weekStart: 'monday',
  startDate: '2026-02-02',
  eventDate: '2026-04-27',
  weeksToEvent: 12,
  weeklyAvailabilityDays: [1, 2, 3, 4, 6],
  weeklyAvailabilityMinutes: 360,
  disciplineEmphasis: 'balanced',
  riskTolerance: 'med',
  maxIntensityDaysPerWeek: 2,
  maxDoublesPerWeek: 1,
  longSessionDay: 6,
  policyProfileId: 'coachkit-safe-v1',
};

export const phaseCGoldenScenarios: PhaseCGoldenScenario[] = [
  {
    id: 'beginner-couch-to-5k',
    description: 'Beginner runner with conservative profile and no doubles.',
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
      coachGuidanceText: 'Beginner athlete. Couch to 5k goal.',
      requestContext: {
        experienceLevel: 'Beginner',
        injuryStatus: '',
        constraintsNotes: '',
        availabilityDays: ['Tue', 'Wed', 'Thu', 'Sat', 'Sun'],
      },
    },
  },
  {
    id: 'injury-constrained',
    description: 'Injury constrained athlete should reduce intensity and stay within safe load bands.',
    setup: {
      ...baseSetup,
      weeklyAvailabilityMinutes: 300,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      coachGuidanceText: 'Athlete has mild achilles pain. Prioritize safe progression.',
      requestContext: {
        injuryStatus: 'Mild achilles pain',
        disciplineInjuryNotes: 'No hard run intensity. Avoid downhill.',
        availabilityDays: ['Mon', 'Tue', 'Thu', 'Sat'],
      },
    },
  },
  {
    id: 'travel-constrained',
    description: 'Travel weeks should down-shift load and avoid aggressive stacking.',
    setup: {
      ...baseSetup,
      weeklyAvailabilityMinutes: 380,
      coachGuidanceText: 'Travel for business Mar 3-8 and Mar 20-24. Keep consistency and reduce travel weeks.',
      requestContext: {
        constraintsNotes: 'Travel Mar 3-8 and Mar 20-24',
        availabilityDays: ['Mon', 'Wed', 'Thu', 'Sat', 'Sun'],
      },
    },
  },
  {
    id: 'low-time-window',
    description: 'Athlete with limited session time should preserve key intent within strict time budget.',
    setup: {
      ...baseSetup,
      weeklyAvailabilityMinutes: 210,
      maxDoublesPerWeek: 0,
      coachGuidanceText: 'Busy athlete with short available windows.',
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
  },
  {
    id: 'event-near-taper',
    description: 'Event-near profile should taper down in final weeks.',
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
  },
];

