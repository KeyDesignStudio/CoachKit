import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { sessionDetailV1Schema } from '@/modules/ai-plan-builder/rules/session-detail';
import { generateAiDraftPlanV1, generateSessionDetailsForDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (Session detail enrichment)', () => {
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
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });

    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('persists detailInputHash + detailJson for every session', async () => {
    const setup = {
      eventDate: '2026-06-01',
      weeksToEvent: 8,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const created = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    expect(created.sessions.length).toBeGreaterThan(0);

    const rows = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: created.id },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      select: { id: true, detailInputHash: true, detailJson: true, detailGeneratedAt: true },
    });

    expect(rows.length).toBe(created.sessions.length);

    for (const s of rows) {
      expect(s.detailInputHash).toBeTruthy();
      expect(s.detailGeneratedAt).toBeTruthy();

      const parsed = sessionDetailV1Schema.safeParse(s.detailJson);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.objective.length).toBeGreaterThan(0);
        expect(parsed.data.structure.length).toBeGreaterThan(0);
      }
    }
  });

  it('is idempotent: re-running enrichment with unchanged inputs does not rewrite detailGeneratedAt', async () => {
    const setup = {
      eventDate: '2026-07-01',
      weeksToEvent: 6,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const created = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const before = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: created.id },
      select: { id: true, detailInputHash: true, detailGeneratedAt: true },
    });

    await generateSessionDetailsForDraftPlan({ coachId, athleteId, draftPlanId: created.id });

    const after = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: created.id },
      select: { id: true, detailInputHash: true, detailGeneratedAt: true },
    });

    const byIdBefore = new Map(before.map((r) => [r.id, r]));
    for (const row of after) {
      const prev = byIdBefore.get(row.id);
      expect(prev).toBeTruthy();
      expect(row.detailInputHash).toBe(prev!.detailInputHash);
      expect(row.detailGeneratedAt?.toISOString()).toBe(prev!.detailGeneratedAt?.toISOString());
    }
  });
});
