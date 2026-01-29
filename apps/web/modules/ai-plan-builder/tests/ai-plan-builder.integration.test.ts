import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '@/lib/prisma';

import { createIntakeDraft, submitIntake, updateIntakeDraft } from '@/modules/ai-plan-builder/server/intake';
import { extractAiProfileFromIntake } from '@/modules/ai-plan-builder/server/profile';
import { createAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { createPlanChangeProposal } from '@/modules/ai-plan-builder/server/proposal';
import { createPlanChangeAudit } from '@/modules/ai-plan-builder/server/audit';

describe('AI Plan Builder v1 (Prisma integration)', () => {
  const coachId = 'it-coach';
  const athleteId = 'it-athlete';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await prisma.user.upsert({
      where: { id: coachId },
      update: {
        email: 'it-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        name: 'Integration Coach',
      },
      create: {
        id: coachId,
        email: 'it-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        name: 'Integration Coach',
        authProviderId: coachId,
      },
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { id: athleteId },
      update: {
        email: 'it-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Integration Athlete',
      },
      create: {
        id: athleteId,
        email: 'it-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Integration Athlete',
        authProviderId: athleteId,
      },
      select: { id: true },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: athleteId },
      update: {
        coachId,
        disciplines: ['OTHER'],
      },
      create: {
        userId: athleteId,
        coachId,
        disciplines: ['OTHER'],
      },
      select: { userId: true },
    });
  });

  afterAll(async () => {
    // Clean up AI Plan Builder tables first (FK dependencies), then fixture rows.
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.intakeEvidence.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });

    // These may be used by other test suites; only delete if they match our ids.
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('intake → evidence → deterministic extract (idempotent) → draft → proposal → audit', async () => {
    const created = await createIntakeDraft({ coachId, athleteId });

    const updated = await updateIntakeDraft({
      coachId,
      athleteId,
      intakeResponseId: created.id,
      draftJson: {
        goals: 'Build aerobic base',
        availability: { daysPerWeek: 4 },
        notes: 'Prefer mornings',
      },
    });

    expect(updated.status).toBe('DRAFT');

    const submitted = await submitIntake({ coachId, athleteId, intakeResponseId: created.id });
    expect(submitted.evidenceCreatedCount).toBeGreaterThan(0);

    const extract1 = await extractAiProfileFromIntake({ coachId, athleteId, intakeResponseId: created.id });
    expect(extract1.wasCreated).toBe(true);
    expect(extract1.profile.athleteId).toBe(athleteId);

    const extract2 = await extractAiProfileFromIntake({ coachId, athleteId, intakeResponseId: created.id });
    expect(extract2.wasCreated).toBe(false);
    expect(extract2.profile.id).toBe(extract1.profile.id);

    const draft = await createAiDraftPlan({
      coachId,
      athleteId,
      planJson: {
        week1: [{ day: 'Mon', workout: 'Easy Run 30min' }],
      },
    });

    const proposal = await createPlanChangeProposal({
      coachId,
      athleteId,
      draftPlanId: draft.id,
      proposalJson: { changes: [{ op: 'add', path: '/week1/0', value: { day: 'Mon', workout: 'Easy Run 30min' } }] },
    });

    const audit = await createPlanChangeAudit({
      coachId,
      athleteId,
      eventType: 'PROPOSAL_CREATED',
      proposalId: proposal.id,
      diffJson: { note: 'integration-test' },
    });

    expect(audit.id).toBeTruthy();
  });
});
