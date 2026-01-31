import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { generateAiDraftPlanV1, updateAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { evaluateAdaptationTriggers } from '@/modules/ai-plan-builder/server/adaptations';
import { approvePlanChangeProposal, generatePlanChangeProposal } from '@/modules/ai-plan-builder/server/proposals';
import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';

import { createAthlete, createCoach, nextTestId } from './seed';

async function getActivePlanTableCounts() {
  const [planWeek, calendarItem] = await Promise.all([
    prisma.planWeek.count(),
    prisma.calendarItem.count(),
  ]);

  return { planWeek, calendarItem };
}

describe('AI Plan Builder v1 (Tranche 3: adaptations + proposals)', () => {
  let coachId = '';
  let athleteId = '';
  const anyPrisma = prisma as any;

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
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await anyPrisma.adaptationTrigger.deleteMany({ where: { athleteId, coachId } });
    await anyPrisma.athleteSessionFeedback.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('T3.1 trigger evaluation correctness: SORENESS / TOO_HARD / MISSED_KEY', async () => {
    const setup = {
      eventDate: '2026-06-01',
      weeksToEvent: 8,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'high' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const now = new Date('2026-01-29T12:00:00.000Z');

    const intensitySessions = (draft.sessions ?? []).filter((s: any) => ['tempo', 'threshold'].includes(String(s.type)));
    expect(intensitySessions.length).toBeGreaterThanOrEqual(2);

    const missedKeyTargets = intensitySessions.slice(0, 2);

    // Create feedback in deterministic windows.
    await anyPrisma.athleteSessionFeedback.createMany({
      data: [
        {
          id: nextTestId('fb_sore'),
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(missedKeyTargets[0].id),
          completedStatus: 'DONE',
          feel: 'OK',
          sorenessFlag: true,
          sorenessNotes: 'hamstrings',
          createdAt: new Date('2026-01-28T12:00:00.000Z'),
        },
        {
          id: nextTestId('fb_toohard'),
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(missedKeyTargets[0].id),
          completedStatus: 'DONE',
          feel: 'TOO_HARD',
          sorenessFlag: false,
          createdAt: new Date('2026-01-27T12:00:00.000Z'),
        },
        {
          id: nextTestId('fb_toohard'),
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(missedKeyTargets[1].id),
          completedStatus: 'DONE',
          feel: 'TOO_HARD',
          sorenessFlag: false,
          createdAt: new Date('2026-01-26T12:00:00.000Z'),
        },
        {
          id: nextTestId('fb_missedkey'),
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(missedKeyTargets[0].id),
          completedStatus: 'SKIPPED',
          feel: 'OK',
          sorenessFlag: false,
          createdAt: new Date('2026-01-25T12:00:00.000Z'),
        },
        {
          id: nextTestId('fb_missedkey'),
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(missedKeyTargets[1].id),
          completedStatus: 'SKIPPED',
          feel: 'OK',
          sorenessFlag: false,
          createdAt: new Date('2026-01-24T12:00:00.000Z'),
        },
      ],
    });

    const evaluated = await evaluateAdaptationTriggers({
      coachId,
      athleteId,
      aiPlanDraftId: draft.id,
      windowDays: 10,
      now,
    });

    const types = new Set((evaluated.triggers ?? []).map((t: any) => t.triggerType));
    expect(types.has('SORENESS')).toBe(true);
    expect(types.has('TOO_HARD')).toBe(true);
    expect(types.has('MISSED_KEY')).toBe(true);

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });

  it('T3.2 proposal determinism: same draft+triggers => identical diffJson hash', async () => {
    const setup = {
      eventDate: '2026-06-15',
      weeksToEvent: 8,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'high' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const now = new Date('2026-01-29T12:00:00.000Z');

    await anyPrisma.athleteSessionFeedback.create({
      data: {
        athleteId,
        coachId,
        draftId: draft.id,
        sessionId: String(draft.sessions[0].id),
        completedStatus: 'DONE',
        feel: 'OK',
        sorenessFlag: true,
        createdAt: new Date('2026-01-28T12:00:00.000Z'),
      },
    });

    const evaluated = await evaluateAdaptationTriggers({ coachId, athleteId, aiPlanDraftId: draft.id, now });
    const triggerIds = (evaluated.triggers ?? []).map((t: any) => String(t.id));
    expect(triggerIds.length).toBeGreaterThan(0);

    const p1 = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id, triggerIds });
    const p2 = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id, triggerIds });

    const h1 = computeStableSha256((p1.proposal as any).diffJson);
    const h2 = computeStableSha256((p2.proposal as any).diffJson);

    expect(h2).toBe(h1);
  });

  it('T3.3 approval applies diff to AiPlanDraft only and writes audit', async () => {
    const setup = {
      eventDate: '2026-07-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    // Soreness trigger -> will try to convert next intensity to recovery + adjust next week volume.
    await anyPrisma.athleteSessionFeedback.create({
      data: {
        athleteId,
        coachId,
        draftId: draft.id,
        sessionId: String(draft.sessions[0].id),
        completedStatus: 'DONE',
        feel: 'OK',
        sorenessFlag: true,
        createdAt: new Date('2026-01-28T12:00:00.000Z'),
      },
    });

    const evaluated = await evaluateAdaptationTriggers({
      coachId,
      athleteId,
      aiPlanDraftId: draft.id,
      now: new Date('2026-01-29T12:00:00.000Z'),
    });

    const triggerIds = (evaluated.triggers ?? []).map((t: any) => String(t.id));
    const { proposal } = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id, triggerIds });

    const beforeSessions = await anyPrisma.aiPlanDraftSession.findMany({
      where: { draftId: draft.id },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      select: { id: true, type: true, durationMinutes: true, notes: true },
    });

    const result = await approvePlanChangeProposal({ coachId, athleteId, proposalId: proposal.id });

    expect(result.updatedProposal.status).toBe('APPLIED');
    expect((result.audit as any).actorType).toBe('COACH');
    expect(result.audit.proposalId).toBe(proposal.id);
    expect((result.audit as any).draftPlanId).toBe(draft.id);

    const afterSessions = await anyPrisma.aiPlanDraftSession.findMany({
      where: { draftId: draft.id },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      select: { id: true, type: true, durationMinutes: true, notes: true },
    });

    expect(afterSessions).not.toEqual(beforeSessions);

    const auditRow = await prisma.planChangeAudit.findFirst({
      where: { athleteId, coachId, proposalId: proposal.id },
      orderBy: [{ createdAt: 'desc' }],
    });
    expect(auditRow).toBeTruthy();

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });

  it('T3.4 approval respects locks: if target becomes locked => 409', async () => {
    const setup = {
      eventDate: '2026-08-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'high' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    await anyPrisma.athleteSessionFeedback.createMany({
      data: [
        {
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(draft.sessions[0].id),
          completedStatus: 'DONE',
          feel: 'TOO_HARD',
          sorenessFlag: false,
          createdAt: new Date('2026-01-28T12:00:00.000Z'),
        },
        {
          athleteId,
          coachId,
          draftId: draft.id,
          sessionId: String(draft.sessions[1].id),
          completedStatus: 'DONE',
          feel: 'TOO_HARD',
          sorenessFlag: false,
          createdAt: new Date('2026-01-27T12:00:00.000Z'),
        },
      ],
    });

    const evaluated = await evaluateAdaptationTriggers({
      coachId,
      athleteId,
      aiPlanDraftId: draft.id,
      now: new Date('2026-01-29T12:00:00.000Z'),
    });

    const triggerIds = (evaluated.triggers ?? []).map((t: any) => String(t.id));
    const { proposal } = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id, triggerIds });

    const diff = Array.isArray((proposal as any).diffJson) ? ((proposal as any).diffJson as any[]) : [];
    const targetSessionId = diff.find((op) => op.op === 'SWAP_SESSION_TYPE')?.draftSessionId as string | undefined;
    expect(targetSessionId).toBeTruthy();

    // Lock the targeted session AFTER proposal creation.
    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: draft.id,
      sessionEdits: [{ sessionId: String(targetSessionId), locked: true }],
    });

    let err: ApiError | undefined;
    try {
      await approvePlanChangeProposal({ coachId, athleteId, proposalId: proposal.id });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      err = e as ApiError;
    }

    expect(err?.status).toBe(409);
    expect(['SESSION_LOCKED', 'WEEK_LOCKED']).toContain(err!.code);

    const proposalAfter = await prisma.planChangeProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(proposalAfter.status).toBe('PROPOSED');
  });
});
