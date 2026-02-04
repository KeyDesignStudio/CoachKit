import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { draftPlanSetupV1Schema, generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (plan setup dates persisted + derived)', () => {
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
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
  });

  it('derives weeksToEvent from startDate+completionDate and persists startDate', async () => {
    const setupInput = {
      weekStart: 'monday' as const,
      startDate: '2030-04-01',
      completionDate: '2030-05-12',
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const setup = draftPlanSetupV1Schema.parse(setupInput);

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const stored = await prisma.aiPlanDraft.findUniqueOrThrow({ where: { id: String(draft.id) }, select: { setupJson: true } });
    const setupJson = (stored.setupJson ?? {}) as any;

    expect(setupJson.startDate).toBe('2030-04-01');
    expect(setupJson.completionDate).toBe('2030-05-12');
    expect(setupJson.eventDate).toBe('2030-05-12');
    // 2030-04-01 (Mon) -> 2030-05-12 (Sun) spans 6 monday-start weeks.
    expect(setupJson.weeksToEvent).toBe(6);
  });

  it('respects weeksToEventOverride when provided', async () => {
    const setupInput = {
      weekStart: 'monday' as const,
      startDate: '2030-04-01',
      completionDate: '2030-05-12',
      weeksToEventOverride: 4,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const setup = draftPlanSetupV1Schema.parse(setupInput);

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const stored = await prisma.aiPlanDraft.findUniqueOrThrow({ where: { id: String(draft.id) }, select: { setupJson: true } });
    const setupJson = (stored.setupJson ?? {}) as any;

    expect(setupJson.weeksToEvent).toBe(4);
    expect(setupJson.weeksToEventOverride).toBe(4);
  });

  it('keeps legacy drafts without startDate working (eventDate + weeksToEvent)', async () => {
    const setupInput = {
      weekStart: 'monday' as const,
      eventDate: '2030-05-12',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const setup = draftPlanSetupV1Schema.parse(setupInput);

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const stored = await prisma.aiPlanDraft.findUniqueOrThrow({ where: { id: String(draft.id) }, select: { setupJson: true } });
    const setupJson = (stored.setupJson ?? {}) as any;

    expect(setupJson.startDate ?? null).toBeNull();
    expect(setupJson.eventDate).toBe('2030-05-12');
    expect(setupJson.weeksToEvent).toBe(6);
  });
});
