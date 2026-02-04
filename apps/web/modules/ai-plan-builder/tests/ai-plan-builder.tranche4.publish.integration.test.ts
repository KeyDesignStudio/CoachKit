import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { generateAiDraftPlanV1, updateAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { publishAiDraftPlan } from '@/modules/ai-plan-builder/server/publish';
import {
  getLatestPublishedAiPlanForAthlete,
  getPublishedAiPlanForAthlete,
} from '@/modules/ai-plan-builder/server/athlete-plan';
import { createAthleteSessionFeedbackAsAthlete } from '@/modules/ai-plan-builder/server/feedback';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (Tranche 4: athlete publish)', () => {
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
    await prisma.athleteSessionFeedback.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('T4.1 publish sets visibility and creates a snapshot', async () => {
    const setup = {
      eventDate: '2026-08-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const now = new Date('2026-01-29T12:00:00.000Z');

    const result = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now });

    expect(result.published).toBe(true);
    expect(result.draft.visibilityStatus).toBe('PUBLISHED');
    expect(result.draft.publishedAt?.toISOString()).toBe(now.toISOString());

    const snapshots = await prisma.aiPlanDraftPublishSnapshot.findMany({ where: { draftId: draft.id } });
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.hash).toBe(result.hash);

    const latest = await getLatestPublishedAiPlanForAthlete({ athleteId });
    expect(latest?.id).toBe(draft.id);
  });

  it('T4.2 idempotent publish keeps publishedAt stable when unchanged', async () => {
    const setup = {
      eventDate: '2026-09-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const t1 = new Date('2026-01-29T12:00:00.000Z');
    const first = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: t1 });

    const t2 = new Date('2026-01-29T12:10:00.000Z');
    const second = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: t2 });

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);

    const status = await prisma.aiPlanDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(status.publishedAt?.toISOString()).toBe(t1.toISOString());
  });

  it('T4.3 athlete cannot read a draft that is not published', async () => {
    const setup = {
      eventDate: '2026-10-01',
      weeksToEvent: 4,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    await expect(getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: draft.id })).rejects.toBeInstanceOf(ApiError);
  });

  it('T4.4 publish after a draft edit produces a new hash and allows athlete feedback', async () => {
    const setup = {
      eventDate: '2026-11-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'high' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const s0 = draft.sessions?.[0];
    expect(s0?.id).toBeTruthy();

    const p1 = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: new Date('2026-01-29T12:00:00.000Z') });
    expect(p1.published).toBe(true);

    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: draft.id,
      sessionEdits: [{ sessionId: String(s0.id), durationMinutes: Number(s0.durationMinutes) + 5 }],
    });

    const p2 = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: new Date('2026-01-29T12:05:00.000Z') });
    expect(p2.published).toBe(true);
    expect(p2.hash).not.toBe(p1.hash);

    const publishedDraft = await getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: draft.id });
    const anySession = (publishedDraft.sessions as any[]).find((s) => String(s.id) === String(s0.id));
    expect(anySession?.durationMinutes).toBe(Number(s0.durationMinutes) + 5);

    const feedback = await createAthleteSessionFeedbackAsAthlete({
      athleteId,
      aiPlanDraftId: draft.id,
      draftSessionId: String(s0.id),
      completedStatus: 'DONE',
      feel: 'OK',
      sorenessFlag: false,
      sorenessNotes: null,
      rpe: null,
      sleepQuality: null,
    });

    expect(feedback.athleteId).toBe(athleteId);
    expect(feedback.coachId).toBe(coachId);
    expect(feedback.draftId).toBe(draft.id);
    expect(String(feedback.sessionId)).toBe(String(s0.id));
  });
});
