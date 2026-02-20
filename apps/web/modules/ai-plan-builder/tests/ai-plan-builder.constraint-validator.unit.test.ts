import { describe, expect, it } from 'vitest';

import { validateDraftPlanAgainstSetup } from '@/modules/ai-plan-builder/rules/constraint-validator';
import type { DraftPlanV1, DraftPlanSetupV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

function buildBaseSetup(): DraftPlanSetupV1 {
  return {
    weekStart: 'monday',
    startDate: '2026-02-02',
    eventDate: '2026-03-16',
    weeksToEvent: 6,
    weeklyAvailabilityDays: [2, 3, 4, 6, 0],
    weeklyAvailabilityMinutes: 300,
    disciplineEmphasis: 'balanced',
    riskTolerance: 'med',
    maxIntensityDaysPerWeek: 1,
    maxDoublesPerWeek: 0,
    coachGuidanceText: 'Beginner athlete build',
  };
}

function buildDraftWithSessions(sessions: DraftPlanV1['weeks'][number]['sessions']): DraftPlanV1 {
  return {
    version: 'v1',
    setup: buildBaseSetup(),
    weeks: [{ weekIndex: 0, locked: false, sessions }],
  };
}

describe('constraint-validator', () => {
  it('flags unavailable day and max doubles violations', () => {
    const draft = buildDraftWithSessions([
      { weekIndex: 0, ordinal: 0, dayOfWeek: 1, discipline: 'run', type: 'endurance', durationMinutes: 40, locked: false },
      { weekIndex: 0, ordinal: 1, dayOfWeek: 2, discipline: 'bike', type: 'tempo', durationMinutes: 40, locked: false },
      { weekIndex: 0, ordinal: 2, dayOfWeek: 2, discipline: 'swim', type: 'technique', durationMinutes: 30, locked: false },
    ]);

    const violations = validateDraftPlanAgainstSetup({ setup: buildBaseSetup(), draft });
    expect(violations.some((v) => v.code === 'OFF_DAY_SESSION')).toBe(true);
    expect(violations.some((v) => v.code === 'MAX_DOUBLES_EXCEEDED')).toBe(true);
  });

  it('flags intensity/minutes and beginner caps', () => {
    const setup = {
      ...buildBaseSetup(),
      maxIntensityDaysPerWeek: 1,
      weeklyAvailabilityMinutes: 200,
    };
    const draft = buildDraftWithSessions([
      { weekIndex: 0, ordinal: 0, dayOfWeek: 2, discipline: 'run', type: 'tempo', durationMinutes: 70, notes: 'Key', locked: false },
      { weekIndex: 0, ordinal: 1, dayOfWeek: 3, discipline: 'bike', type: 'threshold', durationMinutes: 80, notes: 'Key', locked: false },
      { weekIndex: 0, ordinal: 2, dayOfWeek: 4, discipline: 'run', type: 'endurance', durationMinutes: 60, notes: 'Brick (run off bike)', locked: false },
      { weekIndex: 0, ordinal: 3, dayOfWeek: 6, discipline: 'bike', type: 'endurance', durationMinutes: 100, locked: false },
    ]);

    const violations = validateDraftPlanAgainstSetup({ setup, draft });
    expect(violations.some((v) => v.code === 'MAX_INTENSITY_DAYS_EXCEEDED')).toBe(true);
    expect(violations.some((v) => v.code === 'WEEKLY_MINUTES_OUT_OF_BOUNDS')).toBe(true);
    expect(violations.some((v) => v.code === 'BEGINNER_RUN_CAP_EXCEEDED')).toBe(true);
    expect(violations.some((v) => v.code === 'BEGINNER_BRICK_TOO_EARLY')).toBe(true);
  });
});

