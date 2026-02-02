import { describe, expect, it } from 'vitest';

import { draftPlanSetupV1Schema } from '@/modules/ai-plan-builder/server/draft-plan';

function baseSetup() {
  return {
    weeklyAvailabilityDays: [1, 3, 5],
    weeklyAvailabilityMinutes: 240,
    disciplineEmphasis: 'balanced' as const,
    riskTolerance: 'med' as const,
    maxIntensityDaysPerWeek: 2,
    maxDoublesPerWeek: 0,
  };
}

describe('AI Plan Builder v1 plan setup (weeks derivation)', () => {
  it('derives weeksToEvent from startDate + completionDate (monday week start)', () => {
    const out = draftPlanSetupV1Schema.parse({
      ...baseSetup(),
      weekStart: 'monday',
      startDate: '2026-01-05',
      completionDate: '2026-02-01',
    });

    expect(out.eventDate).toBe('2026-02-01');
    expect(out.weeksToEvent).toBe(4);
  });

  it('derives weeksToEvent from startDate + completionDate (sunday week start)', () => {
    const out = draftPlanSetupV1Schema.parse({
      ...baseSetup(),
      weekStart: 'sunday',
      startDate: '2026-01-05',
      completionDate: '2026-02-01',
    });

    expect(out.eventDate).toBe('2026-02-01');
    expect(out.weeksToEvent).toBe(5);
  });

  it('respects weeksToEventOverride over derived and explicit weeksToEvent', () => {
    const out = draftPlanSetupV1Schema.parse({
      ...baseSetup(),
      weekStart: 'monday',
      startDate: '2026-01-05',
      completionDate: '2026-02-01',
      weeksToEvent: 3,
      weeksToEventOverride: 6,
    });

    expect(out.weeksToEvent).toBe(6);
  });

  it('accepts legacy drafts without startDate (eventDate + weeksToEvent)', () => {
    const out = draftPlanSetupV1Schema.parse({
      ...baseSetup(),
      weekStart: 'monday',
      eventDate: '2026-02-01',
      weeksToEvent: 6,
    });

    expect(out.startDate).toBeUndefined();
    expect(out.eventDate).toBe('2026-02-01');
    expect(out.weeksToEvent).toBe(6);
  });
});
