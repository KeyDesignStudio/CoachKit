import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';

import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { APB_CALENDAR_ORIGIN, APB_SOURCE_PREFIX } from '@/modules/ai-plan-builder/server/calendar-materialise';
import { sessionDetailV1Schema } from '@/modules/ai-plan-builder/rules/session-detail';

import { GET as coachCalendarGET } from '@/app/api/coach/calendar/route';
import { POST as planWeeksPublishPOST } from '@/app/api/coach/plan-weeks/publish/route';
import { POST as copyWeekPOST } from '@/app/api/coach/calendar/copy-week/route';

import { createAthlete, createCoach, seedTriggersAndProposal } from './seed';

async function withDevAuthDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDisable = process.env.DISABLE_AUTH;
  try {
    process.env.NODE_ENV = 'development';
    process.env.DISABLE_AUTH = 'true';
    return await fn();
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.DISABLE_AUTH = prevDisable;
  }
}

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

    const sessionWithDetail = sessions.find((s) => s.detailJson != null);
    expect(sessionWithDetail, 'Expected at least one draft session to have detailJson.').toBeTruthy();

    const parsed = sessionDetailV1Schema.safeParse((sessionWithDetail as any)?.detailJson);
    expect(parsed.success, 'Expected detailJson to conform to SessionDetailV1 schema.').toBe(true);
    const objectiveSnippet = parsed.success ? parsed.data.objective.slice(0, 12) : '';

    const item = await findApbCalendarItem(athleteId, String((sessionWithDetail as any).id));
    expect(item).not.toBeNull();
    expect(item?.workoutDetail ?? '').toContain(objectiveSnippet);
    expect(item?.workoutDetail ?? '').toContain('Warmup');
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

  it('does not overwrite coachEdited calendar items on subsequent publish', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId, origin: APB_CALENDAR_ORIGIN } });

    const setup = {
      eventDate: '2030-09-22',
      weeksToEvent: 4,
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
      requestId: 'test-coach-edited-1',
    });

    const firstSession = await prisma.aiPlanDraftSession.findFirstOrThrow({
      where: { draftId: String(draft.id) },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });

    const item = await findApbCalendarItem(athleteId, String(firstSession.id));
    expect(item).not.toBeNull();

    const editedTitle = 'Coach Edited Title';
    await prisma.calendarItem.update({
      where: { id: String(item!.id) },
      data: {
        coachEdited: true,
        title: editedTitle,
        plannedDurationMinutes: 999,
        notes: 'Coach edited notes',
      },
    });

    await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-coach-edited-2',
    });

    const after = await findApbCalendarItem(athleteId, String(firstSession.id));
    expect(after).not.toBeNull();
    expect(after?.title).toBe(editedTitle);
    expect(after?.plannedDurationMinutes).toBe(999);
    expect(after?.notes).toContain('Coach edited');
  });
});

describe('Workflow separation (manual planner vs AI planner)', () => {
  const devCoachId = 'dev-coach';
  const devAthleteId = 'dev-athlete-ai';

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: devCoachId },
      update: { role: 'COACH', timezone: 'UTC', authProviderId: devCoachId },
      create: {
        id: devCoachId,
        email: 'dev-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        authProviderId: devCoachId,
      },
    });

    await prisma.user.upsert({
      where: { id: devAthleteId },
      update: { role: 'ATHLETE', timezone: 'UTC', authProviderId: devAthleteId },
      create: {
        id: devAthleteId,
        email: 'dev-athlete-ai@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        authProviderId: devAthleteId,
      },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: devAthleteId },
      update: { coachId: devCoachId, disciplines: ['OTHER'] },
      create: { userId: devAthleteId, coachId: devCoachId, disciplines: ['OTHER'] },
    });
  });

  afterAll(async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId: devAthleteId } });
    await prisma.planWeek.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });

    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId: devAthleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: devAthleteId, coachId: devCoachId } });
    await prisma.user.deleteMany({ where: { id: devAthleteId } });
    // devCoachId is shared by other harnesses; keep it.
  });

  it('AI approve-and-publish creates CalendarItems that are returned by /api/coach/calendar', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId: devAthleteId } });

    const setup = {
      eventDate: '2030-10-20',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId: devCoachId, athleteId: devAthleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({
      coachId: devCoachId,
      athleteId: devAthleteId,
      aiPlanDraftId: String(draft.id),
    });

    const res = await approveAndPublishPlanChangeProposal({
      coachId: devCoachId,
      athleteId: devAthleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-endpoint',
    });

    expect(res.publish.ok).toBe(true);
    expect(res.materialisation.ok).toBe(true);

    const sessions = await prisma.aiPlanDraftSession.findMany({ where: { draftId: String(draft.id) } });
    const first = await prisma.calendarItem.findFirstOrThrow({
      where: { athleteId: devAthleteId, origin: APB_CALENDAR_ORIGIN },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    const last = await prisma.calendarItem.findFirstOrThrow({
      where: { athleteId: devAthleteId, origin: APB_CALENDAR_ORIGIN },
      orderBy: { date: 'desc' },
      select: { date: true },
    });

    const from = first.date.toISOString().slice(0, 10);
    const to = last.date.toISOString().slice(0, 10);

    const json = await withDevAuthDisabled(async () => {
      const req = new NextRequest(`http://localhost/api/coach/calendar?athleteId=${devAthleteId}&from=${from}&to=${to}`);
      const response = await coachCalendarGET(req);
      expect(response.status).toBe(200);
      return (await response.json()) as any;
    });

    const aiItems = (json.data?.items ?? []).filter((i: any) => i.origin === APB_CALENDAR_ORIGIN);
    expect(aiItems.length).toBe(sessions.length);
    expect(aiItems.every((i: any) => typeof i.sourceActivityId === 'string' && i.sourceActivityId.startsWith(APB_SOURCE_PREFIX))).toBe(
      true
    );
  });

  it('manual weekly publish does not modify AI calendar items', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId: devAthleteId } });
    await prisma.planWeek.deleteMany({ where: { athleteId: devAthleteId, coachId: devCoachId } });

    const setup = {
      eventDate: '2030-11-17',
      weeksToEvent: 4,
      weekStart: 'monday' as const,
      weeklyAvailabilityDays: [1, 3, 5],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId: devCoachId, athleteId: devAthleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId: devCoachId, athleteId: devAthleteId, aiPlanDraftId: String(draft.id) });

    await approveAndPublishPlanChangeProposal({
      coachId: devCoachId,
      athleteId: devAthleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-manual-publish-no-touch-ai-1',
    });

    const aiBefore = await prisma.calendarItem.findMany({
      where: { athleteId: devAthleteId, origin: APB_CALENDAR_ORIGIN, deletedAt: null },
      select: { id: true },
    });
    expect(aiBefore.length).toBeGreaterThan(0);

    const weekStart = '2030-09-30';
    await withDevAuthDisabled(async () => {
      const req = new NextRequest('http://localhost/api/coach/plan-weeks/publish', {
        method: 'POST',
        body: JSON.stringify({ athleteId: devAthleteId, weekStart }),
      } as any);
      const response = await planWeeksPublishPOST(req);
      expect(response.status).toBe(200);
    });

    const aiAfter = await prisma.calendarItem.findMany({
      where: { athleteId: devAthleteId, origin: APB_CALENDAR_ORIGIN, deletedAt: null },
      select: { id: true },
    });

    expect(aiAfter.map((x) => x.id).sort()).toEqual(aiBefore.map((x) => x.id).sort());
  });

  it('manual copy-week never deletes AI items and never creates overlapping duplicates on top of them', async () => {
    await prisma.calendarItem.deleteMany({ where: { athleteId: devAthleteId } });

    const fromWeekStart = '2030-10-07';
    const toWeekStart = '2030-10-14';

    // Source manual item (origin null)
    await prisma.calendarItem.create({
      data: {
        athleteId: devAthleteId,
        coachId: devCoachId,
        date: new Date(`${fromWeekStart}T00:00:00.000Z`),
        plannedStartTimeLocal: '06:00',
        origin: null,
        planningStatus: 'PLANNED',
        sourceActivityId: null,
        discipline: 'RUN',
        title: 'Manual Run',
        plannedDurationMinutes: 45,
        status: 'PLANNED',
      } as any,
    });

    // Conflicting AI item on target week (must never be deleted or overwritten)
    const ai = await prisma.calendarItem.create({
      data: {
        athleteId: devAthleteId,
        coachId: devCoachId,
        date: new Date(`${toWeekStart}T00:00:00.000Z`),
        plannedStartTimeLocal: '06:00',
        origin: APB_CALENDAR_ORIGIN,
        planningStatus: 'PLANNED',
        sourceActivityId: `${APB_SOURCE_PREFIX}conflict-test`,
        discipline: 'RUN',
        title: 'Manual Run',
        plannedDurationMinutes: 60,
        status: 'PLANNED',
      } as any,
    });

    const result = await withDevAuthDisabled(async () => {
      const req = new NextRequest('http://localhost/api/coach/calendar/copy-week', {
        method: 'POST',
        body: JSON.stringify({ athleteId: devAthleteId, fromWeekStart, toWeekStart, mode: 'overwrite' }),
      } as any);
      const response = await copyWeekPOST(req);
      expect(response.status).toBe(200);
      return (await response.json()) as any;
    });

    expect(result.data?.createdCount).toBe(0);
    expect(result.data?.skippedCount).toBeGreaterThanOrEqual(1);

    const stillThere = await prisma.calendarItem.findFirst({ where: { id: ai.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.origin).toBe(APB_CALENDAR_ORIGIN);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
