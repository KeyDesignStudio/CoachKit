import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { APB_CALENDAR_ORIGIN, APB_SOURCE_PREFIX } from '@/modules/ai-plan-builder/server/calendar-materialise';

import { createAthlete, createCoach, nextTestId, seedTriggersAndProposal } from './seed';

function sumByDiscipline(planJson: any) {
  const totals: Record<string, number> = {};
  const weeks = Array.isArray(planJson?.weeks) ? planJson.weeks : [];
  for (const week of weeks) {
    for (const session of week.sessions ?? []) {
      const key = String(session.discipline ?? '').toLowerCase();
      totals[key] = (totals[key] ?? 0) + Number(session.durationMinutes ?? 0);
    }
  }
  return totals;
}

describe('PlanSource v1 influence (draft shaping)', () => {
  let coachId = '';
  let athleteId = '';
  let planSourceVersionId = '';
  let planSourceId = '';
  const planSourceIds: string[] = [];

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

    await prisma.athleteProfile.update({
      where: { userId: athleteId },
      data: {
        disciplines: ['SWIM', 'BIKE', 'RUN'],
        primaryGoal: 'Olympic',
        experienceLevel: 'Beginner',
      },
    });

    const planSource = await prisma.planSource.create({
      data: {
        type: 'PDF',
        title: 'Bike Heavy Olympic Beginner',
        sport: 'TRIATHLON',
        distance: 'OLYMPIC',
        level: 'BEGINNER',
        durationWeeks: 8,
        season: 'BASE',
        checksumSha256: nextTestId('checksum'),
        rawText: 'Week 1 Bike endurance 90 min',
        rawJson: Prisma.JsonNull,
        isActive: true,
      },
    });
    planSourceId = planSource.id;
    planSourceIds.push(planSource.id);

    const version = await prisma.planSourceVersion.create({
      data: {
        planSourceId: planSource.id,
        version: 1,
        extractionMetaJson: { confidence: 0.8, warnings: [] } as any,
      },
    });
    planSourceVersionId = version.id;

    const week = await prisma.planSourceWeekTemplate.create({
      data: {
        planSourceVersionId: version.id,
        weekIndex: 0,
        totalMinutes: 240,
        totalSessions: 6,
      },
    });

    await prisma.planSourceSessionTemplate.createMany({
      data: [
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 1,
          discipline: 'BIKE',
          sessionType: 'technique',
          durationMinutes: 45,
        },
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 2,
          discipline: 'BIKE',
          sessionType: 'technique',
          durationMinutes: 45,
        },
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 3,
          discipline: 'RUN',
          sessionType: 'tempo',
          durationMinutes: 35,
        },
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 4,
          discipline: 'SWIM',
          sessionType: 'technique',
          durationMinutes: 30,
        },
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 5,
          discipline: 'BIKE',
          sessionType: 'endurance',
          durationMinutes: 50,
        },
        {
          planSourceWeekTemplateId: week.id,
          ordinal: 6,
          discipline: 'RUN',
          sessionType: 'technique',
          durationMinutes: 35,
        },
      ],
    });

    await prisma.planSourceRule.createMany({
      data: [
        {
          planSourceVersionId: version.id,
          ruleType: 'DISCIPLINE_SPLIT',
          phase: null,
          appliesJson: { level: 'BEGINNER' } as any,
          ruleJson: { swimPct: 0.2, bikePct: 0.6, runPct: 0.2 } as any,
          explanation: 'Bike-heavy block',
          priority: 1,
        },
        {
          planSourceVersionId: version.id,
          ruleType: 'WEEKLY_VOLUME',
          phase: null,
          appliesJson: {} as any,
          ruleJson: { weekMinutes: [240, 270, 300, 240], deloadEveryNWeeks: 4 } as any,
          explanation: 'Progressive volume with deload',
          priority: 1,
        },
        {
          planSourceVersionId: version.id,
          ruleType: 'INTENSITY_DENSITY',
          phase: null,
          appliesJson: {} as any,
          ruleJson: { maxIntensityDaysPerWeek: 1 } as any,
          explanation: 'Beginner intensity cap',
          priority: 1,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });
    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftSession.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraftWeek.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    if (planSourceIds.length) {
      await prisma.planSourceRule.deleteMany({ where: { planSourceVersion: { planSourceId: { in: planSourceIds } } } });
      await prisma.planSourceSessionTemplate.deleteMany({
        where: { planSourceWeekTemplate: { planSourceVersion: { planSourceId: { in: planSourceIds } } } },
      });
      await prisma.planSourceWeekTemplate.deleteMany({ where: { planSourceVersion: { planSourceId: { in: planSourceIds } } } });
      await prisma.planSourceVersion.deleteMany({ where: { planSourceId: { in: planSourceIds } } });
      await prisma.planSource.deleteMany({ where: { id: { in: planSourceIds } } });
    }

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });
  });

  it('applies plan source rules to draft generation', async () => {
    const setup = {
      eventDate: '2026-08-15',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    expect(draft?.planSourceSelectionJson?.selectedPlanSourceVersionIds ?? []).toContain(planSourceVersionId);

    const totals = sumByDiscipline(draft.planJson);
    const bikeMinutes = totals.bike ?? 0;
    const runMinutes = totals.run ?? 0;
    const techniqueCount = draft.planJson?.weeks
      ?.flatMap((w: any) => w.sessions ?? [])
      ?.filter((s: any) => String(s.type ?? '').toLowerCase() === 'technique').length ?? 0;
    const intensityDaysByWeek = (draft.planJson?.weeks ?? []).map((w: any) => {
      const intensityDays = new Set<number>();
      for (const session of w.sessions ?? []) {
        const t = String(session.type ?? '').toLowerCase();
        if (t === 'tempo' || t === 'threshold') intensityDays.add(Number(session.dayOfWeek) || 0);
      }
      return intensityDays.size;
    });
    const weekTotals = (draft.planJson?.weeks ?? []).map((w: any) =>
      (w.sessions ?? []).reduce((sum: number, s: any) => sum + Number(s.durationMinutes ?? 0), 0)
    );

    expect(bikeMinutes).toBeGreaterThan(runMinutes * 1.3);
    expect(draft.planJson?.setup?.maxIntensityDaysPerWeek).toBe(1);
    expect(techniqueCount).toBeGreaterThanOrEqual(4);
    expect(intensityDaysByWeek.every((n: number) => n <= 1)).toBe(true);
    expect(weekTotals[3]).toBeLessThan(weekTotals[2]);
  });

  it('exposes plan source confidence in reasoning when extraction is partial', async () => {
    const coach = await createCoach();
    const athlete = await createAthlete({ coachId: coach.id });
    const tempCoachId = coach.id;
    const tempAthleteId = athlete.athlete.id;

    await prisma.athleteProfile.update({
      where: { userId: athlete.athlete.id },
      data: {
        disciplines: ['RUN'],
        primaryGoal: 'Sprint',
        experienceLevel: 'Beginner',
      },
    });

    const sparsePlanSource = await prisma.planSource.create({
      data: {
        type: 'TEXT',
        title: 'Sprint Run Minimal',
        sport: 'RUN',
        distance: 'SPRINT',
        level: 'BEGINNER',
        durationWeeks: 4,
        season: 'BASE',
        checksumSha256: nextTestId('checksum_sparse'),
        rawText: 'Week 1 Easy run 30 min',
        rawJson: Prisma.JsonNull,
        isActive: true,
      },
    });
    planSourceIds.push(sparsePlanSource.id);

    const sparseVersion = await prisma.planSourceVersion.create({
      data: {
        planSourceId: sparsePlanSource.id,
        version: 1,
        extractionMetaJson: { confidence: 0.4, warnings: ['Sparse extraction'] } as any,
      },
    });

    await prisma.planSourceRule.create({
      data: {
        planSourceVersionId: sparseVersion.id,
        ruleType: 'WEEKLY_VOLUME',
        phase: null,
        appliesJson: {} as any,
        ruleJson: { weekMinutes: [180, 200, 220, 180] } as any,
        explanation: 'Basic progression only',
        priority: 1,
      },
    });

    const setup = {
      eventDate: '2026-10-10',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 210,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({
      coachId: tempCoachId,
      athleteId: tempAthleteId,
      setup,
    })) as any;

    expect(draft?.planSourceSelectionJson?.influenceSummary?.confidence).toBeTruthy();
    const explanations = draft?.reasoningJson?.explanations ?? [];
    expect(explanations.join(' ')).toMatch(/plan source influence confidence/i);

    await prisma.calendarItem.deleteMany({ where: { athleteId: tempAthleteId, origin: APB_CALENDAR_ORIGIN } });
    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId: tempAthleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId: tempAthleteId, coachId: tempCoachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId: tempAthleteId, coachId: tempCoachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId: tempAthleteId, coachId: tempCoachId } });
    await prisma.aiPlanDraftSession.deleteMany({ where: { draft: { athleteId: tempAthleteId, coachId: tempCoachId } } });
    await prisma.aiPlanDraftWeek.deleteMany({ where: { draft: { athleteId: tempAthleteId, coachId: tempCoachId } } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId: tempAthleteId, coachId: tempCoachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId: tempAthleteId, coachId: tempCoachId } });
    await prisma.athleteProfile.deleteMany({ where: { userId: tempAthleteId, coachId: tempCoachId } });
    await prisma.user.deleteMany({ where: { id: tempAthleteId } });
    await prisma.user.deleteMany({ where: { id: tempCoachId } });
  });

  it('persists plan source attribution when publishing to calendar', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2026-09-12',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: String(draft.id) });

    const res = await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-plan-source-attribution',
    });

    expect(res.publish.ok).toBe(true);
    expect(res.materialisation.ok).toBe(true);

    const session = await prisma.aiPlanDraftSession.findFirst({ where: { draftId: String(draft.id) } });
    expect(session).toBeTruthy();

    const item = await prisma.calendarItem.findFirst({
      where: {
        athleteId,
        origin: APB_CALENDAR_ORIGIN,
        sourceActivityId: `${APB_SOURCE_PREFIX}${String(session?.id ?? '')}`,
      },
    });

    expect(item).toBeTruthy();
    expect(item?.attachmentsJson ?? null).not.toBeNull();
    const attachments = (item?.attachmentsJson ?? {}) as any;
    expect(attachments.aiPlanDraftId).toBe(String(draft.id));
    expect(attachments.aiPlanDraftSessionId).toBe(String(session?.id ?? ''));
    expect(attachments.planSourceVersionIds ?? []).toContain(planSourceVersionId);
    expect(attachments.planSourceId).toBe(planSourceId);
    expect(attachments.planSourceVersionId).toBe(planSourceVersionId);
    expect(attachments.planSourceVersion).toBe(1);
    expect(attachments.planSourceTitle).toBe('Bike Heavy Olympic Beginner');
    expect(attachments.planSourceArchetype).toMatch(/Bike Heavy Olympic Beginner/i);
    expect(attachments.planSourceHash).toBeTruthy();
  });
});
