import { describe, expect, it } from 'vitest';

import { computeWeeklyMinutesTarget, normalizeAustralianMobile } from '@/modules/athlete-intake/validation';
import { mapIntakeToAthleteProfileUpdate } from '@/modules/ai-plan-builder/server/athlete-intake';

const basePayload = {
  version: 'v1',
  sections: [
    {
      key: 'profile-basics',
      title: 'Profile Basics',
      answers: [],
    },
  ],
};

describe('athlete intake validation (AU mobile + weekly minutes)', () => {
  it('normalizes Australian mobile numbers to E.164', () => {
    expect(normalizeAustralianMobile('0412345678')).toBe('+61412345678');
    expect(normalizeAustralianMobile('61412345678')).toBe('+61412345678');
    expect(normalizeAustralianMobile('+61412345678')).toBe('+61412345678');
    expect(normalizeAustralianMobile('111222333')).toBeNull();
  });

  it('computes weekly minutes from hours/day and days/week', () => {
    expect(computeWeeklyMinutesTarget({ hoursPerDay: 1.5, daysPerWeek: 4 })).toBe(360);
    expect(computeWeeklyMinutesTarget({ hoursPerDay: 2.5, daysPerWeek: 2 })).toBe(300);
  });

  it('maps computed weekly minutes to AthleteProfile', () => {
    const payload = {
      ...basePayload,
      sections: [
        {
          key: 'training-profile',
          title: 'Training Profile',
          answers: [
            { questionKey: 'weekly_hours_per_day', answer: '1.5' },
            { questionKey: 'weekly_days_per_week', answer: '4' },
          ],
        },
      ],
    };

    const update = mapIntakeToAthleteProfileUpdate(payload as any);
    expect(update.weeklyMinutesTarget).toBe(360);
  });
});
