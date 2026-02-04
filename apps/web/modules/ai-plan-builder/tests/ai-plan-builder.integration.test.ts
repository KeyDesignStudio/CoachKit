import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { prisma } from '@/lib/prisma';

import { createIntakeDraft, submitIntake, updateIntakeDraft } from '@/modules/ai-plan-builder/server/intake';
import { extractAiProfileFromIntake } from '@/modules/ai-plan-builder/server/profile';
import { createAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { createPlanChangeProposal } from '@/modules/ai-plan-builder/server/proposal';
import { createPlanChangeAudit } from '@/modules/ai-plan-builder/server/audit';

import { createAthlete, createCoach } from './seed';

async function getActivePlanTableCounts() {
  const [
    planTemplate,
    planTemplateScheduleRow,
    athletePlanInstance,
    athletePlanInstanceItem,
    planWeek,
    calendarItem,
  ] = await Promise.all([
    prisma.planTemplate.count(),
    prisma.planTemplateScheduleRow.count(),
    prisma.athletePlanInstance.count(),
    prisma.athletePlanInstanceItem.count(),
    prisma.planWeek.count(),
    prisma.calendarItem.count(),
  ]);

  return {
    planTemplate,
    planTemplateScheduleRow,
    athletePlanInstance,
    athletePlanInstanceItem,
    planWeek,
    calendarItem,
  };
}

async function getEvidenceSnapshot(intakeResponseId: string) {
  const rows = await prisma.intakeEvidence.findMany({
    where: { intakeResponseId },
    orderBy: [{ questionKey: 'asc' }, { createdAt: 'asc' }],
    select: { questionKey: true, answerJson: true, createdAt: true },
  });

  // Serialize to a deterministic shape for equality checks.
  return rows.map((row) => ({
    questionKey: row.questionKey,
    answerJson: row.answerJson,
    createdAt: row.createdAt.toISOString(),
  }));
}

describe('AI Plan Builder v1 (Prisma integration)', () => {
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
    // Clean up AI Plan Builder tables first (FK dependencies), then fixture rows.
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteProfileAI.deleteMany({ where: { athleteId, coachId } });
    await prisma.intakeEvidence.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteIntakeResponse.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    // These may be used by other test suites; only delete if they match our ids.
    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('enforces invariants (append-only evidence, idempotent extract, draft isolation, proposal/audit non-mutation)', async () => {
    const countsBefore = await getActivePlanTableCounts();

    // 1) IntakeEvidence is append-only: multiple submissions add rows; earlier evidence is not overwritten.
    const intake1 = await createIntakeDraft({ coachId, athleteId });
    await updateIntakeDraft({
      coachId,
      athleteId,
      intakeResponseId: intake1.id,
      draftJson: {
        goals: 'Build aerobic base',
        availability: { daysPerWeek: 4 },
        notes: 'Prefer mornings',
      },
    });
    const submit1 = await submitIntake({ coachId, athleteId, intakeResponseId: intake1.id });
    expect(submit1.evidenceCreatedCount).toBeGreaterThan(0);

    const evidence1 = await getEvidenceSnapshot(intake1.id);
    expect(evidence1.length).toBeGreaterThan(0);

    const intake2 = await createIntakeDraft({ coachId, athleteId });
    await updateIntakeDraft({
      coachId,
      athleteId,
      intakeResponseId: intake2.id,
      draftJson: {
        goals: 'Return to training',
        availability: { daysPerWeek: 3 },
        notes: 'Prefer evenings',
      },
    });
    const submit2 = await submitIntake({ coachId, athleteId, intakeResponseId: intake2.id });
    expect(submit2.evidenceCreatedCount).toBeGreaterThan(0);

    const evidence1AfterSecondSubmit = await getEvidenceSnapshot(intake1.id);
    expect(evidence1AfterSecondSubmit).toEqual(evidence1);

    // 2) Extract is idempotent: same evidenceHash -> same profileJson + summary.
    const extract1a = await extractAiProfileFromIntake({ coachId, athleteId, intakeResponseId: intake1.id });
    const extract1b = await extractAiProfileFromIntake({ coachId, athleteId, intakeResponseId: intake1.id });

    expect(extract1a.profile.athleteId).toBe(athleteId);
    expect(extract1b.profile.id).toBe(extract1a.profile.id);
    expect(extract1b.profile.evidenceHash).toBe(extract1a.profile.evidenceHash);
    expect(extract1b.profile.extractedProfileJson).toEqual(extract1a.profile.extractedProfileJson);
    expect(extract1b.profile.extractedSummaryText).toBe(extract1a.profile.extractedSummaryText);

    // 3) Draft plan isolation: draft exists for athlete; no active plan tables are modified.
    const draft = await createAiDraftPlan({
      coachId,
      athleteId,
      planJson: {
        week1: [{ day: 'Mon', workout: 'Easy Run 30min' }],
      },
    });

    expect(draft.athleteId).toBe(athleteId);

    const countsAfterDraft = await getActivePlanTableCounts();
    expect(countsAfterDraft).toEqual(countsBefore);

    const draftBeforeProposal = await prisma.aiPlanDraft.findUniqueOrThrow({
      where: { id: draft.id },
      select: { id: true, updatedAt: true },
    });

    // 4) Proposal and audit only write to their own tables and do not mutate plan sessions.
    const proposal = await createPlanChangeProposal({
      coachId,
      athleteId,
      draftPlanId: draft.id,
      proposalJson: { changes: [{ op: 'add', path: '/week1/0', value: { day: 'Mon', workout: 'Easy Run 30min' } }] },
    });
    expect(proposal.id).toBeTruthy();

    const audit = await createPlanChangeAudit({
      coachId,
      athleteId,
      eventType: 'PROPOSAL_CREATED',
      proposalId: proposal.id,
      diffJson: { note: 'integration-test' },
    });
    expect(audit.id).toBeTruthy();

    const countsAfterProposalAudit = await getActivePlanTableCounts();
    expect(countsAfterProposalAudit).toEqual(countsBefore);

    const draftAfterProposal = await prisma.aiPlanDraft.findUniqueOrThrow({
      where: { id: draft.id },
      select: { id: true, updatedAt: true },
    });
    expect(draftAfterProposal.updatedAt.getTime()).toBe(draftBeforeProposal.updatedAt.getTime());
  });
});
