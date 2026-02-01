import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { APB_CALENDAR_ORIGIN, APB_SOURCE_PREFIX } from '@/modules/ai-plan-builder/server/calendar-materialise';

import { createAthlete, createCoach, seedTriggersAndProposal } from './seed';

async function listApbCalendarItems(athleteId: string) {
  return prisma.calendarItem.findMany({
    where: { athleteId, origin: APB_CALENDAR_ORIGIN, sourceActivityId: { startsWith: APB_SOURCE_PREFIX } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

async function findApbCalendarItem(athleteId: string, draftSessionId: string) {
  return prisma.calendarItem.findFirst({
    where: {
      athleteId,
      origin: APB_CALENDAR_ORIGIN,
      sourceActivityId: `${APB_SOURCE_PREFIX}${draftSessionId}`,
    },
  });
}

describe('AI Plan Builder v1 (calendar materialisation on approve-and-publish)', () => {
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
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('creates calendar items for each draft session on publish', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2030-05-12',
      weeksToEvent: 6,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
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
      requestId: 'test-calendar-create',
    });

    expect(res.publish.ok).toBe(true);
    expect(res.materialisation.ok).toBe(true);

    const sessions = await prisma.aiPlanDraftSession.findMany({ where: { draftId: String(draft.id) } });
    const items = await listApbCalendarItems(athleteId);

    expect(items.length).toBe(sessions.length);
    expect(new Set(items.map((i) => i.sourceActivityId)).size).toBe(sessions.length);
    expect(items.every((i) => i.deletedAt == null)).toBe(true);
  });

  it('is idempotent: re-running approve-and-publish does not create duplicates', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2030-06-09',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 2, 4],
      weeklyAvailabilityMinutes: 210,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: String(draft.id) });

    const first = await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-idem-1',
    });
    expect(first.publish.ok).toBe(true);
    expect(first.materialisation.ok).toBe(true);

    const second = await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-idem-2',
    });
    expect(second.publish.ok).toBe(true);
    expect(second.materialisation.ok).toBe(true);

    const sessions = await prisma.aiPlanDraftSession.findMany({ where: { draftId: String(draft.id) } });
    const items = await listApbCalendarItems(athleteId);
    expect(items.length).toBe(sessions.length);
    expect(new Set(items.map((i) => i.sourceActivityId)).size).toBe(sessions.length);
  });

  it('updates existing calendar items when draft sessions change', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2030-07-14',
      weeksToEvent: 6,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: String(draft.id) });

    await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-update-1',
    });

    const firstSession = await prisma.aiPlanDraftSession.findFirstOrThrow({
      where: { draftId: String(draft.id) },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });

    const item1 = await findApbCalendarItem(athleteId, String(firstSession.id));
    expect(item1).not.toBeNull();

    await prisma.aiPlanDraftSession.update({
      where: { id: String(firstSession.id) },
      data: { durationMinutes: firstSession.durationMinutes + 7, notes: 'Updated in test' },
    });

    await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-update-2',
    });

    const item2 = await findApbCalendarItem(athleteId, String(firstSession.id));
    expect(item2).not.toBeNull();
    expect(item2?.plannedDurationMinutes).toBe(firstSession.durationMinutes + 7);
    expect(item2?.notes ?? '').toContain('Updated in test');
    expect(item2?.deletedAt).toBeNull();
  });

  it('soft-deletes calendar items when sessions are removed from the published draft', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2030-08-18',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: String(draft.id) });

    await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-remove-1',
    });

    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: String(draft.id) },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const removed = sessions[1];

    const itemBefore = await findApbCalendarItem(athleteId, String(removed.id));
    expect(itemBefore).not.toBeNull();
    expect(itemBefore?.deletedAt).toBeNull();

    await prisma.aiPlanDraftSession.delete({ where: { id: String(removed.id) } });

    await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-remove-2',
    });

    const itemAfter = await findApbCalendarItem(athleteId, String(removed.id));
    expect(itemAfter).not.toBeNull();
    expect(itemAfter?.deletedAt).not.toBeNull();
  });
});
