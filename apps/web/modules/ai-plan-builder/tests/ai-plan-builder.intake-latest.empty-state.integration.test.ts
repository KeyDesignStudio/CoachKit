import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (intake/latest empty state)', () => {
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

    // The route handler calls requireCoach(), which in test env would attempt Clerk auth.
    // Mock it to return our seeded coach.
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
    // Ensure we don't leak mocks across suites.
    vi.resetModules();
    vi.doUnmock('@/lib/auth');

    // Clean up AI Plan Builder tables first (FK dependencies), then fixture rows.
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.intakeEvidence.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('returns 200 with intakeResponse: null when the athlete has no submitted intake', async () => {
    // Import after mocking so the handler sees the mocked requireCoach().
    const { GET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/intake/latest/route');

    const request = new Request(
      `http://localhost/api/coach/athletes/${athleteId}/ai-plan-builder/intake/latest`
    );

    const response = await GET(request, { params: { athleteId } } as any);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.error).toBeNull();
    expect(json.data).toEqual({ intakeResponse: null });
  });

  it('returns 200 with the latest submitted intakeResponse when one exists', async () => {
    const older = await prisma.athleteIntakeResponse.create({
      data: {
        athleteId,
        coachId,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-01-01T00:00:00.000Z'),
        source: 'manual',
        aiMode: null,
        draftJson: {},
      } as any,
      select: { id: true },
    });

    const newer = await prisma.athleteIntakeResponse.create({
      data: {
        athleteId,
        coachId,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-01-02T00:00:00.000Z'),
        source: 'manual',
        aiMode: null,
        draftJson: {},
      } as any,
      select: { id: true },
    });

    expect(older.id).not.toEqual(newer.id);

    const { GET } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/intake/latest/route');
    const request = new Request(`http://localhost/api/coach/athletes/${athleteId}/ai-plan-builder/intake/latest`);

    const response = await GET(request, { params: { athleteId } } as any);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.error).toBeNull();
    expect(json.data?.intakeResponse?.id).toBe(newer.id);
  });
});
