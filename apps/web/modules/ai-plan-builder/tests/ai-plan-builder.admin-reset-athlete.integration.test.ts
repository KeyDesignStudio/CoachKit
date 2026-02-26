import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach, createDraftPlanForAthlete, seedTriggersAndProposal } from './seed';
import { createIntakeDraft, submitIntake, updateIntakeDraft } from '../server/intake';
import { createAthleteIntakeSubmission, getLatestAthleteIntakeSubmission } from '../server/athlete-intake';
import { getLatestAthleteBrief } from '../server/athlete-brief';
import { APB_CALENDAR_ORIGIN, APB_MANUAL_EDIT_TAG, APB_SOURCE_PREFIX } from '../server/calendar-materialise';

describe('AI Plan Builder v1 (admin reset athlete endpoint)', () => {
  let coachId = '';
  let athleteId = '';

  let authUser: {
    id: string;
    role: UserRole;
    email: string;
    name: string;
    timezone: string;
    authProviderId: string;
  };

  async function cleanupAthleteFixtures() {
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.intakeEvidence.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });
    await prisma.coachIntent.deleteMany({ where: { athleteId, coachId } });
    await prisma.calendarItem.deleteMany({ where: { athleteId, coachId } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).athleteBrief.deleteMany({ where: { athleteId, coachId } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).athleteIntakeSubmission.deleteMany({ where: { athleteId, coachId } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).aiInvocationAudit.deleteMany({ where: { coachId } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).aiLlmRateLimitEvent.deleteMany({ where: { coachId } });
  }

  async function seedApbFixtures() {
    await cleanupAthleteFixtures();

    const intake = await createIntakeDraft({ coachId, athleteId });
    await updateIntakeDraft({
      coachId,
      athleteId,
      intakeResponseId: intake.id,
      draftJson: { goal: 'race', volume: 'low' },
    });
    await submitIntake({ coachId, athleteId, intakeResponseId: intake.id });

    await prisma.athleteProfileAI.create({
      data: {
        athleteId,
        coachId,
        extractedProfileJson: { ok: true },
        extractedSummaryText: 'summary',
        evidenceHash: 'evidence-hash-test',
        status: 'DRAFT',
      },
    });

    await prisma.coachIntent.create({
      data: {
        athleteId,
        coachId,
        intentText: 'Build a safe base.',
      },
    });

    const draft = await createDraftPlanForAthlete({ coachId, athleteId });

    await seedTriggersAndProposal({
      coachId,
      athleteId,
      aiPlanDraftId: draft.id,
      now: new Date('2026-01-31T00:00:00Z'),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).aiInvocationAudit.create({
      data: {
        actorType: 'COACH',
        actorId: coachId,
        coachId,
        athleteId,
        capability: 'summarizeIntake',
        specVersion: 'v1',
        effectiveMode: 'deterministic',
        provider: 'deterministic',
        model: null,
        inputHash: 'in',
        outputHash: 'out',
        durationMs: 10,
        maxOutputTokens: null,
        timeoutMs: null,
        retryCount: 0,
        fallbackUsed: false,
        errorCode: null,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).aiLlmRateLimitEvent.create({
      data: {
        actorType: 'COACH',
        actorId: coachId,
        capability: 'summarizeIntake',
        coachId,
        athleteId,
      },
    });

    await prisma.calendarItem.createMany({
      data: [
        {
          athleteId,
          coachId,
          date: new Date('2026-01-15T00:00:00Z'),
          discipline: 'RUN',
          title: 'APB Run',
          origin: APB_CALENDAR_ORIGIN,
          sourceActivityId: `${APB_SOURCE_PREFIX}test-1`,
          planningStatus: 'PLANNED',
          coachEdited: false,
        },
        {
          athleteId,
          coachId,
          date: new Date('2026-01-16T00:00:00Z'),
          discipline: 'BIKE',
          title: 'APB Bike (manual)',
          origin: APB_CALENDAR_ORIGIN,
          sourceActivityId: `${APB_SOURCE_PREFIX}test-2`,
          planningStatus: 'PLANNED',
          coachEdited: false,
          tags: [APB_MANUAL_EDIT_TAG],
        },
        {
          athleteId,
          coachId,
          date: new Date('2026-01-17T00:00:00Z'),
          discipline: 'SWIM',
          title: 'APB Swim (coach edited)',
          origin: APB_CALENDAR_ORIGIN,
          sourceActivityId: `${APB_SOURCE_PREFIX}test-3`,
          planningStatus: 'PLANNED',
          coachEdited: true,
        },
        {
          athleteId,
          coachId,
          date: new Date('2026-01-18T00:00:00Z'),
          discipline: 'RUN',
          title: 'Manual Run',
          planningStatus: 'PLANNED',
          coachEdited: false,
        },
      ],
    });
  }

  async function seedAthleteContextFixtures() {
    const payload = {
      version: 'v1',
      sections: [
        {
          key: 'goals',
          title: 'Goals',
          answers: [{ questionKey: 'goal', answer: 'finish' }],
        },
      ],
    };

    await createAthleteIntakeSubmission({ athleteId, coachId, payload });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).athleteBrief.create({
      data: {
        athleteId,
        coachId,
        generatedAt: new Date('2026-01-30T00:00:00Z'),
        inputHash: 'test-hash',
        briefJson: { summary: 'test' },
        aiMode: 'deterministic',
      },
    });
  }

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

    authUser = {
      id: 'auth-user',
      role: UserRole.COACH,
      email: 'nope@local',
      name: 'Auth User',
      timezone: 'UTC',
      authProviderId: 'auth',
    };

    process.env.AI_PLAN_BUILDER_ADMIN_EMAILS = 'admin@local';
    process.env.AI_PLAN_BUILDER_ADMIN_RESET_SECRET = 'test-secret';

    // The route handler calls requireAuth(); coach-side routes call requireCoach().
    // Mock both so we can exercise handlers without Clerk.
    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
        requireAuth: async () => ({ user: authUser }),
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
      };
    });

  });

  afterAll(async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    await cleanupAthleteFixtures();

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('non-admin is blocked (404)', async () => {
    authUser = {
      ...authUser,
      role: UserRole.COACH,
      email: 'nope@local',
    };

    const { POST } = await import('@/app/api/admin/ai-plan-builder/reset-athlete/route');

    const res = await POST(
      new Request('http://localhost/api/admin/ai-plan-builder/reset-athlete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reset-secret': 'test-secret' },
        body: JSON.stringify({ athleteId, dryRun: true }),
      })
    );

    expect(res.status).toBe(404);
  });

  it('admin dryRun returns ids + counts (no deletes)', async () => {
    authUser = {
      ...authUser,
      role: UserRole.COACH,
      email: 'admin@local',
    };

    await seedApbFixtures();

    const { POST } = await import('@/app/api/admin/ai-plan-builder/reset-athlete/route');

    const res = await POST(
      new Request('http://localhost/api/admin/ai-plan-builder/reset-athlete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reset-secret': 'test-secret' },
        body: JSON.stringify({ athleteId, dryRun: true }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.ok).toBe(true);
    expect(json.data.athleteId).toBe(athleteId);
    expect(json.data.dryRun).toBe(true);
    expect(Array.isArray(json.data.draftIds)).toBe(true);
    expect(Array.isArray(json.data.proposalIds)).toBe(true);
    expect(json.data.counts).toBeTruthy();
    expect(typeof json.data.counts.aiPlanDrafts).toBe('number');
  });

  it('admin reset wipes APB state, removes APB calendar items, and coach endpoints return empty state', async () => {
    authUser = {
      ...authUser,
      role: UserRole.COACH,
      email: 'admin@local',
    };

    await seedApbFixtures();

    const { POST } = await import('@/app/api/admin/ai-plan-builder/reset-athlete/route');

    const res = await POST(
      new Request('http://localhost/api/admin/ai-plan-builder/reset-athlete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reset-secret': 'test-secret' },
        body: JSON.stringify({ athleteId, mode: 'APB_AND_CALENDAR' }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.ok).toBe(true);
    expect(json.data.dryRun).toBe(false);
    expect(json.data.mode).toBe('APB_AND_CALENDAR');

    const remainingCalendarItems = await prisma.calendarItem.findMany({
      where: {
        athleteId,
        origin: APB_CALENDAR_ORIGIN,
        sourceActivityId: { startsWith: APB_SOURCE_PREFIX },
      },
      select: { coachEdited: true, tags: true },
    });

    expect(remainingCalendarItems).toHaveLength(2);
    remainingCalendarItems.forEach((item) => {
      expect(item.coachEdited || (item.tags ?? []).includes(APB_MANUAL_EDIT_TAG)).toBe(true);
    });

    const manualCount = await prisma.calendarItem.count({ where: { athleteId, origin: null } });
    expect(manualCount).toBe(1);

    const { GET: intakeGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/intake/latest/route');
    const { GET: profileGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/profile/latest/route');
    const { GET: draftGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/draft-plan/latest/route');

    const intakeRes = await intakeGET(new Request('http://localhost/api/coach/.../intake/latest'), { params: { athleteId } } as any);
    expect(intakeRes.status).toBe(200);
    expect((await intakeRes.json()).data).toEqual({ intakeResponse: null });

    const profileRes = await profileGET(new Request('http://localhost/api/coach/.../profile/latest'), { params: { athleteId } } as any);
    expect(profileRes.status).toBe(200);
    expect((await profileRes.json()).data).toEqual({ profile: null });

    const draftRes = await draftGET(new Request('http://localhost/api/coach/.../draft-plan/latest'), { params: { athleteId } } as any);
    expect(draftRes.status).toBe(200);
    expect((await draftRes.json()).data).toEqual({ draftPlan: null });
  });

  it('admin reset wipes athlete context + APB + calendar (preserving manual and coach-edited items)', async () => {
    authUser = {
      ...authUser,
      role: UserRole.COACH,
      email: 'admin@local',
    };

    await seedApbFixtures();
    await seedAthleteContextFixtures();

    const { POST } = await import('@/app/api/admin/ai-plan-builder/reset-athlete/route');

    const res = await POST(
      new Request('http://localhost/api/admin/ai-plan-builder/reset-athlete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reset-secret': 'test-secret' },
        body: JSON.stringify({ athleteId, mode: 'ATHLETE_CONTEXT_AND_APB_AND_CALENDAR' }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.ok).toBe(true);
    expect(json.data.dryRun).toBe(false);
    expect(json.data.mode).toBe('ATHLETE_CONTEXT_AND_APB_AND_CALENDAR');

    const latestBrief = await getLatestAthleteBrief({ coachId, athleteId });
    const latestBriefSnapshot = latestBrief?.brief?.snapshot as { primaryGoal?: string | null } | null | undefined;
    expect(latestBriefSnapshot?.primaryGoal ?? null).toBeNull();

    const latestSubmission = await getLatestAthleteIntakeSubmission({ coachId, athleteId });
    expect(latestSubmission).toBeNull();

    const remainingApbCalendarItems = await prisma.calendarItem.findMany({
      where: {
        athleteId,
        origin: APB_CALENDAR_ORIGIN,
        sourceActivityId: { startsWith: APB_SOURCE_PREFIX },
      },
      select: { coachEdited: true, tags: true },
    });

    expect(remainingApbCalendarItems).toHaveLength(2);
    remainingApbCalendarItems.forEach((item) => {
      expect(item.coachEdited || (item.tags ?? []).includes(APB_MANUAL_EDIT_TAG)).toBe(true);
    });

    const manualCount = await prisma.calendarItem.count({ where: { athleteId, origin: null } });
    expect(manualCount).toBe(1);

    const { GET: intakeGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/intake/latest/route');
    const { GET: profileGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/profile/latest/route');
    const { GET: draftGET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/draft-plan/latest/route');

    const intakeRes = await intakeGET(new Request('http://localhost/api/coach/.../intake/latest'), { params: { athleteId } } as any);
    expect(intakeRes.status).toBe(200);
    expect((await intakeRes.json()).data).toEqual({ intakeResponse: null });

    const profileRes = await profileGET(new Request('http://localhost/api/coach/.../profile/latest'), { params: { athleteId } } as any);
    expect(profileRes.status).toBe(200);
    expect((await profileRes.json()).data).toEqual({ profile: null });

    const draftRes = await draftGET(new Request('http://localhost/api/coach/.../draft-plan/latest'), { params: { athleteId } } as any);
    expect(draftRes.status).toBe(200);
    expect((await draftRes.json()).data).toEqual({ draftPlan: null });
  });
});
