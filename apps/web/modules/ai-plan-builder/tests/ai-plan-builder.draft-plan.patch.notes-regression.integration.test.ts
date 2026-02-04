import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach, createDraftPlanForAthlete } from './seed';

describe('AI Plan Builder v1 (PATCH draft-plan notes regression)', () => {
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

    // The route handler calls requireCoach(); mock it so we can exercise the handler without Clerk.
    vi.doMock('@/lib/auth', async () => {
      const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
      return {
        ...actual,
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

    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('persists edited session notes via PATCH and re-fetch', async () => {
    const draft = await createDraftPlanForAthlete({ coachId, athleteId });

    const session = await prisma.aiPlanDraftSession.findFirstOrThrow({
      where: { draftId: draft.id },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      select: { id: true, durationMinutes: true },
    });

    // Match the production repro payload shape/content (do not change without updating the incident doc).
    const newNotes = 'Brick (add short run off bike)\n\nGordon tweaked';
    const newDurationMinutes = (session.durationMinutes ?? 30) + 5;

    const { PATCH } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/draft-plan/route');

    const res = await PATCH(
      new Request('http://localhost/api/coach/athletes/' + athleteId + '/ai-plan-builder/draft-plan', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          draftPlanId: draft.id,
          sessionEdits: [
            {
              sessionId: session.id,
              type: 'endurance',
              durationMinutes: newDurationMinutes,
              notes: newNotes,
            },
          ],
        }),
      }),
      { params: { athleteId } } as any
    );

    expect(res.status).toBe(200);

    const patchJson = await res.json();
    expect(patchJson.error).toBeNull();

    const patchedSession = patchJson.data.draftPlan.sessions.find((s: any) => s.id === session.id);
    expect(patchedSession).toBeTruthy();
    expect(patchedSession.durationMinutes).toBe(newDurationMinutes);
    expect(patchedSession.notes).toBe(newNotes);

    const { GET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/draft-plan/latest/route');

    const latestRes = await GET(new Request('http://localhost/api/coach/.../draft-plan/latest'), { params: { athleteId } } as any);
    expect(latestRes.status).toBe(200);

    const latestJson = await latestRes.json();
    expect(latestJson.error).toBeNull();

    const latestSession = latestJson.data.draftPlan.sessions.find((s: any) => s.id === session.id);
    expect(latestSession).toBeTruthy();
    expect(latestSession.durationMinutes).toBe(newDurationMinutes);
    expect(latestSession.notes).toBe(newNotes);

    const dbSession = await prisma.aiPlanDraftSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { notes: true, durationMinutes: true },
    });
    expect(dbSession.durationMinutes).toBe(newDurationMinutes);
    expect(dbSession.notes).toBe(newNotes);
  });
});
