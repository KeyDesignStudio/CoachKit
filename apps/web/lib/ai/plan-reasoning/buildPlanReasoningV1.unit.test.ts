import { describe, expect, it } from 'vitest';

import { buildPlanReasoningV1 } from '@/lib/ai/plan-reasoning/buildPlanReasoningV1';
import type { AthleteProfileSnapshot } from '@/modules/ai/athlete-brief/types';

const baseProfile: AthleteProfileSnapshot = {
  firstName: null,
  lastName: null,
  gender: null,
  timezone: 'UTC',
  trainingSuburb: null,
  email: null,
  mobilePhone: null,
  dateOfBirth: null,
  disciplines: ['RUN', 'BIKE'],
  primaryGoal: 'Finish a half marathon',
  secondaryGoals: [],
  focus: null,
  eventName: null,
  eventDate: null,
  timelineWeeks: null,
  experienceLevel: 'Beginner',
  weeklyMinutesTarget: null,
  consistencyLevel: null,
  swimConfidence: 2,
  bikeConfidence: 3,
  runConfidence: 2,
  availableDays: ['Monday', 'Wednesday', 'Saturday'],
  scheduleVariability: 'High',
  sleepQuality: 'Poor',
  equipmentAccess: null,
  travelConstraints: null,
  injuryStatus: 'Knee soreness',
  constraintsNotes: 'Avoid back-to-back hard days',
  feedbackStyle: 'Direct',
  tonePreference: 'Supportive',
  checkInCadence: 'Weekly',
  structurePreference: 3,
  motivationStyle: 'Encouraging',
  trainingPlanSchedule: { frequency: 'WEEKLY', dayOfWeek: 1, weekOfMonth: null },
  coachNotes: null,
  painHistory: [],
  coachJournal: null,
};

const baseSetup = {
  weekStart: 'monday',
  startDate: '2026-02-10',
  completionDate: '2026-03-10',
  weeksToEvent: 4,
  weeklyAvailabilityDays: [1, 3, 6],
  weeklyAvailabilityMinutes: 240,
  disciplineEmphasis: 'run',
  maxIntensityDaysPerWeek: 2,
  maxDoublesPerWeek: 1,
  longSessionDay: 6,
};

const draftPlanJson = {
  version: 'v1',
  setup: baseSetup,
  weeks: [
    {
      weekIndex: 0,
      locked: false,
      sessions: [
        { weekIndex: 0, ordinal: 0, dayOfWeek: 1, discipline: 'RUN', type: 'Endurance', durationMinutes: 40 },
        { weekIndex: 0, ordinal: 1, dayOfWeek: 3, discipline: 'RUN', type: 'Tempo', durationMinutes: 30 },
        { weekIndex: 0, ordinal: 2, dayOfWeek: 6, discipline: 'BIKE', type: 'Endurance', durationMinutes: 60 },
      ],
    },
    {
      weekIndex: 1,
      locked: false,
      sessions: [
        { weekIndex: 1, ordinal: 0, dayOfWeek: 1, discipline: 'RUN', type: 'Intervals', durationMinutes: 35 },
        { weekIndex: 1, ordinal: 1, dayOfWeek: 6, discipline: 'BIKE', type: 'Endurance', durationMinutes: 70 },
      ],
    },
  ],
};

describe('buildPlanReasoningV1', () => {
  it('returns deterministic reasoning for a fixed fixture', () => {
    const reasoning = buildPlanReasoningV1({
      athleteProfile: baseProfile,
      setup: baseSetup,
      draftPlanJson,
    });

    expect(reasoning.version).toBe('v1');
    expect(reasoning.priorities.length).toBeGreaterThan(0);
    expect(reasoning.targets.weeklyMinutesTarget).toBeGreaterThan(0);
    expect(reasoning.weeks).toHaveLength(2);
    expect(reasoning.weeks[0].disciplineSplitMinutes.run).toBe(70);
  });

  it('reduces intensity target and flags risks when injury or poor sleep is present', () => {
    const reasoning = buildPlanReasoningV1({
      athleteProfile: baseProfile,
      setup: baseSetup,
      draftPlanJson,
    });

    expect(reasoning.targets.maxIntensityDaysPerWeek).toBe(1);
    expect(reasoning.risks.some((risk) => risk.key === 'injury')).toBe(true);
    expect(reasoning.risks.some((risk) => risk.key === 'sleep')).toBe(true);
  });

  it('adds variability constraints and conservative notes when schedule variability is high', () => {
    const reasoning = buildPlanReasoningV1({
      athleteProfile: baseProfile,
      setup: baseSetup,
      draftPlanJson,
    });

    expect(reasoning.constraints.some((c) => c.key === 'variability')).toBe(true);
    expect(reasoning.explanations.some((note) => note.toLowerCase().includes('variability'))).toBe(true);
  });

  it('includes plan source references and influence notes when provided', () => {
    const reasoning = buildPlanReasoningV1({
      athleteProfile: baseProfile,
      setup: baseSetup,
      draftPlanJson,
      planSources: [
        { planSourceVersionId: 'psv_1', title: 'Olympic Beginner 12wk', reasons: ['distance match', 'level match'] },
      ],
      planSourceInfluence: { notes: ['Discipline split aligned with plan source.'] },
    });

    expect(reasoning.sources?.length).toBe(1);
    expect(reasoning.sources?.[0].title).toBe('Olympic Beginner 12wk');
    expect(reasoning.explanations.some((note) => note.includes('Plan source influence'))).toBe(true);
  });
});
