import { describe, expect, it } from 'vitest';

import { generateDraftPlanDeterministicV1 } from '@/modules/ai-plan-builder/rules/draft-generator';

describe('AI Plan Builder v1: weekStart ordering', () => {
  it('defaults weekStart to monday when omitted', () => {
    const out = generateDraftPlanDeterministicV1({
      eventDate: '2026-06-01',
      weeksToEvent: 12,
      weeklyAvailabilityDays: [0, 1, 2, 3, 4, 5, 6],
      weeklyAvailabilityMinutes: 420,
      disciplineEmphasis: 'balanced',
      riskTolerance: 'med',
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: null,
    });

    expect(out.setup.weekStart).toBe('monday');
  });

  it('orders sessions within a week based on weekStart (Mon vs Sun)', () => {
    const baseSetup = {
      eventDate: '2026-06-01',
      weeksToEvent: 12,
      weeklyAvailabilityDays: [0, 1, 2, 3, 4, 5, 6],
      weeklyAvailabilityMinutes: 420,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: null as number | null,
    };

    const mon = generateDraftPlanDeterministicV1({ ...baseSetup, weekStart: 'monday' });
    const sun = generateDraftPlanDeterministicV1({ ...baseSetup, weekStart: 'sunday' });

    const week0Mon = mon.weeks[0]?.sessions ?? [];
    const week0Sun = sun.weeks[0]?.sessions ?? [];

    expect(week0Mon.length).toBeGreaterThan(0);
    expect(week0Sun.length).toBeGreaterThan(0);

    const offset = (dayOfWeek: number, weekStart: 'monday' | 'sunday') => {
      const d = ((Number(dayOfWeek) % 7) + 7) % 7;
      if (weekStart === 'sunday') return d;
      return (d + 6) % 7;
    };

    const isNonDecreasing = (values: number[]) => values.every((v, i) => i === 0 || v >= values[i - 1]!);

    expect(isNonDecreasing(week0Mon.map((s) => offset(s.dayOfWeek, 'monday')))).toBe(true);
    expect(isNonDecreasing(week0Sun.map((s) => offset(s.dayOfWeek, 'sunday')))).toBe(true);

    // Same plan content, different display ordering.
    expect(week0Mon.map((s) => s.dayOfWeek)).not.toEqual(week0Sun.map((s) => s.dayOfWeek));
  });
});
