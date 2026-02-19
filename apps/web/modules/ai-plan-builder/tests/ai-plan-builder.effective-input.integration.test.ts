import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (effective input preflight merge)', () => {
  let coachId = '';
  let athleteId = '';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    const coach = await createCoach();
    const athlete = await createAthlete({ coachId: coach.id });
    coachId = coach.id;
    athleteId = athlete.athlete.id;
  });

  afterAll(async () => {
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
  });

  it('merges profile + intake + approved AI profile with deterministic precedence and conflict summary', async () => {
    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        primaryGoal: 'Profile baseline goal',
        focus: 'Profile focus',
        timelineWeeks: 10,
        weeklyMinutesTarget: 240,
        availableDays: ['Monday', 'Thursday'],
      },
    });

    await prisma.athleteIntakeResponse.create({
      data: {
        athleteId,
        coachId,
        status: 'SUBMITTED',
        source: 'manual',
        draftJson: {
          goal_details: 'Intake goal',
          goal_focus: 'Intake focus',
          weekly_minutes: 300,
          availability_days: ['Mon', 'Tue', 'Thu'],
        },
        submittedAt: new Date(),
      },
    });

    await prisma.athleteProfileAI.create({
      data: {
        athleteId,
        coachId,
        evidenceHash: `test-${Date.now()}`,
        extractedProfileJson: {
          goal_details: 'AI extracted goal',
          weekly_minutes: 360,
        },
        extractedSummaryText: 'summary',
        coachOverridesJson: {
          goal_details: 'Coach override goal',
        },
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    const draft = await generateAiDraftPlanV1({
      coachId,
      athleteId,
      setup: {
        eventDate: '2030-05-12',
        weeksToEvent: 6,
        weekStart: 'monday',
        weeklyAvailabilityDays: [1, 2, 4],
        weeklyAvailabilityMinutes: 300,
        disciplineEmphasis: 'run',
        riskTolerance: 'med',
        maxIntensityDaysPerWeek: 2,
        maxDoublesPerWeek: 0,
        longSessionDay: 6,
      },
    });

    const setupJson = (draft.setupJson ?? {}) as any;
    const effective = (setupJson.effectiveInputV1 ?? {}) as any;

    expect(effective.preflight?.hasConflicts).toBe(true);
    expect(effective.preflight?.conflictCount).toBeGreaterThan(0);
    expect(effective.mergedSignals?.primaryGoal).toBe('Coach override goal');
    expect(String(setupJson.coachGuidanceText ?? '')).toContain('Coach override goal');
  });
});
