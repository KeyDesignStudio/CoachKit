import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { generateAiDraftPlanV1, getLatestAiDraftPlan, updateAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { computeStableSha256 } from '@/modules/ai-plan-builder/rules/stable-hash';

import { createAthlete, createCoach } from './seed';

async function getActivePlanTableCounts() {
  const [planWeek, calendarItem] = await Promise.all([
    prisma.planWeek.count(),
    prisma.calendarItem.count(),
  ]);

  return { planWeek, calendarItem };
}

describe('AI Plan Builder v1 (Tranche 2: draft generation/edit/lock)', () => {
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

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('A1 deterministic generation: identical setup -> identical planJson hash + stable ordering', async () => {
    const setup = {
      eventDate: '2026-06-01',
      weeksToEvent: 12,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const draft1 = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const draft2 = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const hash1 = computeStableSha256(draft1.planJson);
    const hash2 = computeStableSha256(draft2.planJson);
    expect(hash2).toBe(hash1);

    const sessions1 = (draft1.sessions ?? []).map((s: any) => ({
      weekIndex: s.weekIndex,
      ordinal: s.ordinal,
      dayOfWeek: s.dayOfWeek,
      discipline: s.discipline,
      type: s.type,
      durationMinutes: s.durationMinutes,
      notes: s.notes,
    }));

    const sessions2 = (draft2.sessions ?? []).map((s: any) => ({
      weekIndex: s.weekIndex,
      ordinal: s.ordinal,
      dayOfWeek: s.dayOfWeek,
      discipline: s.discipline,
      type: s.type,
      durationMinutes: s.durationMinutes,
      notes: s.notes,
    }));

    expect(sessions2).toEqual(sessions1);

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });

  it('A2 edit persistence: PATCH updates one session and leaves others unchanged', async () => {
    const setup = {
      eventDate: '2026-06-15',
      weeksToEvent: 8,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const created = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    expect(created.sessions.length).toBeGreaterThan(0);

    const target = created.sessions[0];
    const untouched = created.sessions[1];

    const updated = await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: created.id,
      sessionEdits: [
        {
          sessionId: target.id,
          durationMinutes: (target.durationMinutes ?? 0) + 5,
          notes: 'Edited in test',
        },
      ],
    });

    const latest = (await getLatestAiDraftPlan({ coachId, athleteId })) as any;
    expect(latest?.id).toBe(updated.id);

    const editedRow = latest!.sessions.find((s: any) => s.id === target.id)!;
    expect(editedRow.durationMinutes).toBe((target.durationMinutes ?? 0) + 5);
    expect(editedRow.notes).toBe('Edited in test');

    if (untouched) {
      const untouchedAfter = latest!.sessions.find((s: any) => s.id === untouched.id)!;
      expect({
        type: untouchedAfter.type,
        durationMinutes: untouchedAfter.durationMinutes,
        notes: untouchedAfter.notes,
        locked: untouchedAfter.locked,
      }).toEqual({
        type: untouched.type,
        durationMinutes: untouched.durationMinutes,
        notes: untouched.notes,
        locked: untouched.locked,
      });
    }

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });

  it('A3 lock enforcement: editing a locked session returns 409 SESSION_LOCKED and draft is unchanged', async () => {
    const setup = {
      eventDate: '2026-07-01',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const created = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const target = created.sessions[0];

    const locked = await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: created.id,
      sessionEdits: [{ sessionId: target.id, locked: true }],
    });

    const lockedRow = (locked as any).sessions.find((s: any) => s.id === target.id)!;
    expect(lockedRow.locked).toBe(true);

    const snapshotBefore = await (prisma as any).aiPlanDraftSession.findUniqueOrThrow({
      where: { id: target.id },
      select: { durationMinutes: true, notes: true, locked: true, updatedAt: true },
    });

    await expect(
      updateAiDraftPlan({
        coachId,
        athleteId,
        draftPlanId: created.id,
        sessionEdits: [{ sessionId: target.id, durationMinutes: (target.durationMinutes ?? 0) + 10 }],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'SESSION_LOCKED',
    } satisfies Partial<ApiError>);

    const snapshotAfter = await (prisma as any).aiPlanDraftSession.findUniqueOrThrow({
      where: { id: target.id },
      select: { durationMinutes: true, notes: true, locked: true, updatedAt: true },
    });

    expect(snapshotAfter).toEqual(snapshotBefore);

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });

  it('A3b week lock enforcement: locked week blocks any session edit or lock/unlock (409 WEEK_LOCKED)', async () => {
    const setup = {
      eventDate: '2026-08-01',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const countsBefore = await getActivePlanTableCounts();

    const created = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const target = created.sessions[0];

    // Lock the containing week.
    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: created.id,
      weekLocks: [{ weekIndex: Number(target.weekIndex), locked: true }],
    });

    const snapshotBefore = await (prisma as any).aiPlanDraftSession.findUniqueOrThrow({
      where: { id: target.id },
      select: { durationMinutes: true, notes: true, locked: true, updatedAt: true },
    });

    // Attempt to edit within locked week.
    await expect(
      updateAiDraftPlan({
        coachId,
        athleteId,
        draftPlanId: created.id,
        sessionEdits: [{ sessionId: target.id, durationMinutes: (target.durationMinutes ?? 0) + 7 }],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'WEEK_LOCKED',
    } satisfies Partial<ApiError>);

    // Attempt to lock/unlock a session within locked week.
    await expect(
      updateAiDraftPlan({
        coachId,
        athleteId,
        draftPlanId: created.id,
        sessionEdits: [{ sessionId: target.id, locked: true }],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'WEEK_LOCKED',
    } satisfies Partial<ApiError>);

    const snapshotAfter = await (prisma as any).aiPlanDraftSession.findUniqueOrThrow({
      where: { id: target.id },
      select: { durationMinutes: true, notes: true, locked: true, updatedAt: true },
    });
    expect(snapshotAfter).toEqual(snapshotBefore);

    const countsAfter = await getActivePlanTableCounts();
    expect(countsAfter).toEqual(countsBefore);
  });
});
