import { describe, expect, it } from 'vitest';

import { normalizeWeekDurations, roundToIncrementMinutes } from './duration-rounding';

describe('ai-plan-builder duration rounding', () => {
  it('rounds short sessions to 5-minute increments', () => {
    expect(roundToIncrementMinutes(32, 5)).toBe(30);
    expect(roundToIncrementMinutes(33, 5)).toBe(35);
    expect(roundToIncrementMinutes(44, 5)).toBe(45);
  });

  it('rounds long sessions to 10-minute increments', () => {
    expect(roundToIncrementMinutes(92, 10)).toBe(90);
    expect(roundToIncrementMinutes(96, 10)).toBe(100);
  });

  it('rebalances weekly total to the nearest 5 minutes', () => {
    // Raw total 64 -> target 65. After per-session rounding, we should rebalance +5.
    const res = normalizeWeekDurations({
      sessions: [
        { durationMinutes: 32, locked: false, dayOfWeek: 1 },
        { durationMinutes: 32, locked: false, dayOfWeek: 3 },
      ],
      longSessionDay: null,
      longSessionThresholdMinutes: 90,
    });

    expect(res.targetTotalMinutes).toBe(65);
    expect(res.finalTotalMinutes).toBe(65);
    expect(res.sessions.map((s) => s.durationMinutes)).toEqual([35, 30]);
  });

  it('does not rebalance locked sessions', () => {
    // Raw total 64 -> target 65, but only the unlocked session should be adjusted.
    const res = normalizeWeekDurations({
      sessions: [
        { durationMinutes: 32, locked: true, dayOfWeek: 1 },
        { durationMinutes: 32, locked: false, dayOfWeek: 3 },
      ],
      longSessionDay: null,
      longSessionThresholdMinutes: 90,
    });

    expect(res.targetTotalMinutes).toBe(65);
    expect(res.finalTotalMinutes).toBe(65);
    expect(res.sessions.map((s) => s.durationMinutes)).toEqual([30, 35]);
  });

  it('uses 10-minute increments on long-session day', () => {
    const res = normalizeWeekDurations({
      sessions: [
        { durationMinutes: 92, locked: false, dayOfWeek: 6 }, // long day
        { durationMinutes: 33, locked: false, dayOfWeek: 2 },
      ],
      longSessionDay: 6,
      longSessionThresholdMinutes: 999, // ensure only long-day triggers 10-minute rounding
    });

    expect(res.sessions.map((s) => s.durationMinutes)).toEqual([90, 35]);
    expect(res.finalTotalMinutes).toBe(res.targetTotalMinutes);
  });
});
