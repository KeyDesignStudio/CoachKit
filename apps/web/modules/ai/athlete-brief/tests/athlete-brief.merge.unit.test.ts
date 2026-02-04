import { describe, expect, it } from 'vitest';

import { mergeBriefInput } from '@/modules/ai/athlete-brief/merge';
describe('mergeBriefInput', () => {
  it('derives brief fields from athlete profile only', () => {
    const brief = mergeBriefInput({
      athleteProfile: {
        disciplines: ['Swim'],
        primaryGoal: 'Complete a half ironman',
        focus: 'Endurance',
        timelineWeeks: 12,
        availableDays: ['Monday', 'Thursday'],
        weeklyMinutesTarget: 300,
        experienceLevel: 'Intermediate',
        sleepQuality: 'Poor',
        feedbackStyle: 'Detailed',
        tonePreference: 'Direct',
        checkInCadence: 'Weekly',
        structurePreference: 4,
        motivationStyle: 'Encouraging',
        coachNotes: 'Focus on form',
        trainingPlanSchedule: { frequency: 'WEEKLY', dayOfWeek: 1, weekOfMonth: null },
        timezone: 'UTC',
        dateOfBirth: '1990-01-01',
        painHistory: ['Knee - severity 4 - Sore after long runs'],
      },
    });

    expect(brief.goalPrimary).toBe('Complete a half ironman');
    expect(brief.disciplines).toEqual(['Swim']);
    expect(brief.availabilityDays).toEqual(['Monday', 'Thursday']);
    expect(brief.weeklyMinutes).toBe(300);
    expect(brief.scheduleNotes).toBe('Weekly on Monday');
    expect(brief.experienceLevel).toBe('Intermediate');
    expect(brief.injuryStatus).toContain('Knee');
    expect(brief.painHistory.length).toBe(1);
    expect(brief.coachingPreferences.structurePreference).toBe('4/5');
    expect(brief.sourcesPresent).toEqual({ intake: false, coachProfile: true });
  });

  it('falls back to schedule availability and inferred experience when profile is sparse', () => {
    const brief = mergeBriefInput({
      athleteProfile: {
        disciplines: ['Run'],
        primaryGoal: null,
        coachNotes: null,
        trainingPlanSchedule: { frequency: 'MONTHLY', dayOfWeek: 2, weekOfMonth: 1 },
        timezone: 'UTC',
        dateOfBirth: null,
        painHistory: [],
      },
    });

    expect(brief.availabilityDays).toEqual(['Tuesday']);
    expect(brief.scheduleNotes).toBe('Monthly (week 1) on Tuesday');
    expect(brief.experienceLevel).toBe('some experience');
    expect(brief.sourcesPresent).toEqual({ intake: false, coachProfile: true });
  });
});
