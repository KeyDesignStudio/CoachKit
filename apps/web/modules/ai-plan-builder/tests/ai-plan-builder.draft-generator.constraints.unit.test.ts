import { describe, expect, it } from 'vitest';

import { generateDraftPlanDeterministicV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

describe('AI Plan Builder v1: deterministic constraints', () => {
  it('respects availability days and maxDoublesPerWeek=0', () => {
    const out = generateDraftPlanDeterministicV1({
      weekStart: 'monday',
      eventDate: '2026-10-30',
      weeksToEvent: 24,
      weeklyAvailabilityDays: [0, 2, 3, 4, 6],
      weeklyAvailabilityMinutes: 400,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    });

    // Odd week index includes brick insertion path in generator.
    const week = out.weeks[3];
    expect(week).toBeDefined();

    const sessions = week?.sessions ?? [];
    const available = new Set([0, 2, 3, 4, 6]);

    const perDayCounts = new Map<number, number>();
    for (const session of sessions) {
      expect(available.has(session.dayOfWeek)).toBe(true);
      perDayCounts.set(session.dayOfWeek, (perDayCounts.get(session.dayOfWeek) ?? 0) + 1);
    }

    const maxSessionsOnAnyDay = Math.max(...Array.from(perDayCounts.values()));
    expect(maxSessionsOnAnyDay).toBeLessThanOrEqual(1);
  });

  it('allows at most one double day when maxDoublesPerWeek=1', () => {
    const out = generateDraftPlanDeterministicV1({
      weekStart: 'monday',
      eventDate: '2026-10-30',
      weeksToEvent: 24,
      weeklyAvailabilityDays: [0, 2, 3, 4, 6],
      weeklyAvailabilityMinutes: 420,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    });

    const week = out.weeks[3];
    expect(week).toBeDefined();

    const perDayCounts = new Map<number, number>();
    for (const session of week?.sessions ?? []) {
      perDayCounts.set(session.dayOfWeek, (perDayCounts.get(session.dayOfWeek) ?? 0) + 1);
    }

    const daysWithDouble = Array.from(perDayCounts.values()).filter((count) => count > 1).length;
    const maxSessionsOnAnyDay = Math.max(...Array.from(perDayCounts.values()));

    expect(daysWithDouble).toBeLessThanOrEqual(1);
    expect(maxSessionsOnAnyDay).toBeLessThanOrEqual(2);
  });
  it('applies beginner guardrails in early weeks (run caps + no early brick stack)', () => {
    const out = generateDraftPlanDeterministicV1({
      weekStart: 'monday',
      eventDate: '2026-10-30',
      weeksToEvent: 24,
      weeklyAvailabilityDays: [0, 2, 3, 4, 6],
      weeklyAvailabilityMinutes: 400,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'low',
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
      coachGuidanceText: 'Beginner athlete returning to training',
    });

    const week0 = out.weeks[0];
    expect(week0).toBeDefined();

    const week0Sessions = week0?.sessions ?? [];
    const runDurations = week0Sessions.filter((s) => s.discipline === 'run').map((s) => s.durationMinutes);
    for (const duration of runDurations) {
      expect(duration).toBeLessThanOrEqual(45);
    }

    const brickLike = week0Sessions.filter((s) => /brick/i.test(String(s.notes ?? '')));
    expect(brickLike.length).toBe(0);
  });
});
