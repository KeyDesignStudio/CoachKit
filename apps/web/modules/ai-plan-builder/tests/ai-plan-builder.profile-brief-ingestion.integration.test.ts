import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach } from './seed';
import { createAthleteIntakeSubmission } from '@/modules/ai-plan-builder/server/athlete-intake';
import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';

describe('AI Plan Builder v1 (profile + brief canonical ingestion)', () => {
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

    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireCoach: async () => ({
          user: {
            id: coachId,
            role: UserRole.COACH,
            email: 'coach@example.test',
            name: 'Test Coach',
            timezone: 'UTC',
            authProviderId: 'test',
          },
        }),
        assertCoachOwnsAthlete: async (athleteIdParam: string, coachIdParam: string) => {
          return prisma.athleteProfile.findFirstOrThrow({
            where: { userId: athleteIdParam, coachId: coachIdParam },
            include: { user: true },
          });
        },
      };
    });
  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await prisma.aiInvocationAudit.deleteMany({ where: { coachId, athleteId } });
    await prisma.athleteIntakeSubmission.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftSession.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraftWeek.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('uses AthleteProfile goal for brief + APB draft', async () => {
    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        goalsText: 'LEGACY GOAL SHOULD NOT WIN',
        primaryGoal: 'PROFILE GOAL SHOULD WIN',
        focus: 'Consistency',
        timelineWeeks: 10,
      },
    });

    await createAthleteIntakeSubmission({
      athleteId,
      coachId,
      payload: {
        version: 'v1',
        sections: [
          {
            key: 'goals',
            title: 'Goals',
            answers: [
              { questionKey: 'goal_type', answer: 'INTAKE GOAL SHOULD NOT WIN' },
              { questionKey: 'goal_details', answer: 'Intake goal details' },
            ],
          },
        ],
      },
    });

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        primaryGoal: 'GOAL TEST 123',
      },
    });

    const { GET } = await import('@/app/api/coach/athletes/[athleteId]/athlete-brief/latest/route');
    const response = await GET(new Request('http://localhost'), { params: { athleteId } } as any);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json?.data?.brief?.snapshot?.primaryGoal).toBe('GOAL TEST 123');

    const draft = await generateAiDraftPlanV1({
      coachId,
      athleteId,
      setup: {
        eventDate: '2026-08-15',
        weeksToEvent: 6,
        weekStart: 'monday',
        weeklyAvailabilityDays: [1, 3, 5, 6],
        weeklyAvailabilityMinutes: 300,
        disciplineEmphasis: 'balanced',
        riskTolerance: 'med',
        maxIntensityDaysPerWeek: 2,
        maxDoublesPerWeek: 0,
        longSessionDay: 6,
      },
    });

    const setup = draft.setupJson as any;
    expect(String(setup.coachGuidanceText || '')).toContain('GOAL TEST 123');
  });
});
