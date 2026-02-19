import { describe, expect, it } from 'vitest';

import { buildEffectiveSignalsForSources, extractSignalsFromQuestionMap } from '@/modules/ai-plan-builder/server/effective-input';

describe('AI Plan Builder effective input merge', () => {
  it('normalizes intake map fields', () => {
    const signals = extractSignalsFromQuestionMap({
      goal_details: 'Build marathon durability',
      goal_focus: 'Endurance',
      event_date: '2026-10-04',
      goal_timeline: 'In 3-6 months',
      weekly_minutes: 360,
      availability_days: ['Mon', 'Thu', 'Sat'],
      disciplines: ['run', 'strength'],
    });

    expect(signals.primaryGoal).toBe('Build marathon durability');
    expect(signals.focus).toBe('Endurance');
    expect(signals.eventDate).toBe('2026-10-04');
    expect(signals.timelineWeeks).toBe(24);
    expect(signals.weeklyMinutesTarget).toBe(360);
    expect(signals.availableDays).toEqual(['Monday', 'Thursday', 'Saturday']);
    expect(signals.disciplines).toEqual(['RUN', 'STRENGTH']);
  });

  it('applies precedence approved AI > intake > athlete profile and reports conflicts', () => {
    const merged = buildEffectiveSignalsForSources({
      athleteProfileSignals: {
        primaryGoal: 'Profile goal',
        weeklyMinutesTarget: 240,
      },
      intakeSignals: {
        primaryGoal: 'Intake goal',
        weeklyMinutesTarget: 300,
      },
      approvedAiSignals: {
        primaryGoal: 'Coach override goal',
      },
    });

    expect(merged.mergedSignals.primaryGoal).toBe('Coach override goal');
    expect(merged.mergedSignals.weeklyMinutesTarget).toBe(300);
    expect(merged.conflicts.some((c) => c.field === 'primaryGoal')).toBe(true);
    expect(merged.conflicts.some((c) => c.field === 'weeklyMinutesTarget')).toBe(true);
  });
});
