import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { addDaysToDayKey, isDayKey } from '@/lib/day-key';

import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { APB_CALENDAR_ORIGIN, APB_SOURCE_PREFIX } from '@/modules/ai-plan-builder/server/calendar-materialise';

import { dayOffsetFromWeekStart } from '@/modules/ai-plan-builder/lib/week-start';

import { createAthlete, createCoach, seedTriggersAndProposal } from './seed';

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  if (!isDayKey(dayKey)) throw new Error('eventDate must be YYYY-MM-DD');
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const jsDay = date.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
}

function computeSessionDayKey(params: {
  eventDate: string;
  weeksToEvent: number;
  weekStart: 'monday' | 'sunday';
  weekIndex: number;
  dayOfWeek: number;
}): string {
  const eventWeekStart = startOfWeekDayKeyWithWeekStart(params.eventDate, params.weekStart);
  const remainingWeeks = params.weeksToEvent - 1 - params.weekIndex;
  const weekStartDayKey = addDaysToDayKey(eventWeekStart, -7 * remainingWeeks);
  const offset = dayOffsetFromWeekStart(params.dayOfWeek, params.weekStart);
  return addDaysToDayKey(weekStartDayKey, offset);
}

describe('AI Plan Builder v1 (materialises all weeks even if setup weeksToEvent is stale)', () => {
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

  it('uses the session horizon (max weekIndex) to map dates for all weeks', async () => {
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

    // Simulate a production/stale setup regression: sessions span 6 weeks but setupJson weeksToEvent is wrong.
    await prisma.aiPlanDraft.update({
      where: { id: String(draft.id) },
      data: { setupJson: { ...(draft.setupJson ?? {}), weeksToEvent: 2 } },
    });

    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: String(draft.id) });

    const res = await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
      requestId: 'test-calendar-multi-week-horizon',
    });

    expect(res.publish.ok).toBe(true);
    expect(res.materialisation.ok).toBe(true);

    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: String(draft.id) },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });
    expect(sessions.length).toBeGreaterThan(0);

    const maxWeekIndex = Math.max(...sessions.map((s) => s.weekIndex));
    const effectiveWeeksToEvent = maxWeekIndex + 1;

    const items = await prisma.calendarItem.findMany({
      where: { athleteId, origin: APB_CALENDAR_ORIGIN, sourceActivityId: { startsWith: APB_SOURCE_PREFIX }, deletedAt: null },
      select: { sourceActivityId: true, date: true },
    });
    const bySourceId = new Map(items.map((i) => [String(i.sourceActivityId), i] as const));

    for (const s of sessions) {
      const sourceId = `${APB_SOURCE_PREFIX}${s.id}`;
      const item = bySourceId.get(sourceId);
      expect(item, `Expected calendar item for ${sourceId}`).toBeTruthy();

      const expectedDayKey = computeSessionDayKey({
        eventDate: setup.eventDate,
        weeksToEvent: effectiveWeeksToEvent,
        weekStart: setup.weekStart,
        weekIndex: s.weekIndex,
        dayOfWeek: s.dayOfWeek,
      });

      const actualDayKey = item!.date.toISOString().slice(0, 10);
      expect(actualDayKey).toBe(expectedDayKey);
    }
  });
});
