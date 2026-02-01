import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (intake/generate)', () => {
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

    await prisma.aiInvocationAudit.deleteMany({ where: { coachId, athleteId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.intakeEvidence.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('creates a submitted intake + evidence, produces non-empty profile + non-empty evidenceHash, and records an invocation audit', async () => {
    const { POST } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/intake/generate/route');
    const { POST: extractPOST } = await import('@/app/api/coach/athletes/[athleteId]/ai-plan-builder/profile/extract/route');

    const request = new Request(
      `http://localhost/api/coach/athletes/${athleteId}/ai-plan-builder/intake/generate`,
      { method: 'POST' }
    );

    const response = await POST(request, { params: { athleteId } } as any);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.error).toBeNull();

    const intakeResponse = json.data.intakeResponse;
    expect(intakeResponse).toBeTruthy();
    expect(String(intakeResponse.status)).toBe('SUBMITTED');
    expect(String(intakeResponse.source)).toBe('ai_generated');
    expect(String(intakeResponse.aiMode)).toBeTruthy();

    const evidenceCount = await prisma.intakeEvidence.count({ where: { intakeResponseId: String(intakeResponse.id) } });
    expect(evidenceCount).toBeGreaterThan(0);

    // Extract profile and prove non-empty output.
    const extractReq = new Request(
      `http://localhost/api/coach/athletes/${athleteId}/ai-plan-builder/profile/extract`,
      { method: 'POST', body: JSON.stringify({ intakeResponseId: String(intakeResponse.id) }) }
    );

    const extractRes = await extractPOST(extractReq, { params: { athleteId } } as any);
    expect(extractRes.status).toBe(200);

    const extracted = await prisma.athleteProfileAI.findFirst({
      where: { athleteId, coachId },
      orderBy: [{ createdAt: 'desc' }],
    });
    expect(extracted).toBeTruthy();

    const evidenceHash = String((extracted as any)?.evidenceHash ?? '');
    expect(evidenceHash).toBeTruthy();
    expect(evidenceHash).not.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    const profileJson = (extracted as any)?.extractedProfileJson ?? {};
    expect(profileJson).toBeTruthy();
    expect(Object.keys(profileJson).length).toBeGreaterThan(0);

    const summaryText = String((extracted as any)?.extractedSummaryText ?? '');
    expect(summaryText.trim().length).toBeGreaterThan(0);

    const audits = await prisma.aiInvocationAudit.findMany({
      where: { coachId, athleteId, capability: 'generateIntakeFromProfile' },
      orderBy: [{ createdAt: 'desc' }],
      take: 5,
    });
    expect(audits.length).toBeGreaterThan(0);
  });
});
