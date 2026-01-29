import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { generateAiDraftPlanV1, updateAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { publishAiDraftPlan } from '@/modules/ai-plan-builder/server/publish';
import { ackAthletePublish, getAthletePublishStatus } from '@/modules/ai-plan-builder/server/publish-ack';
import {
  batchApproveSafeProposals,
  generatePlanChangeProposal,
  updatePlanChangeProposalDiff,
} from '@/modules/ai-plan-builder/server/proposals';

describe('AI Plan Builder v1 (Tranche 5: productivity)', () => {
  const coachId = 'it5-coach';
  const athleteId = 'it5-athlete';

  beforeAll(async () => {
    expect(process.env.DATABASE_URL, 'DATABASE_URL must be set by the test harness.').toBeTruthy();
    expect(
      process.env.AI_PLAN_BUILDER_V1 === '1' || process.env.AI_PLAN_BUILDER_V1 === 'true',
      'AI_PLAN_BUILDER_V1 must be enabled by the test harness.'
    ).toBe(true);

    await prisma.user.upsert({
      where: { id: coachId },
      update: {
        email: 'it5-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        name: 'Tranche5 Coach',
      },
      create: {
        id: coachId,
        email: 'it5-coach@local',
        role: 'COACH',
        timezone: 'UTC',
        name: 'Tranche5 Coach',
        authProviderId: coachId,
      },
      select: { id: true },
    });

    await prisma.user.upsert({
      where: { id: athleteId },
      update: {
        email: 'it5-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Tranche5 Athlete',
      },
      create: {
        id: athleteId,
        email: 'it5-athlete@local',
        role: 'ATHLETE',
        timezone: 'UTC',
        name: 'Tranche5 Athlete',
        authProviderId: athleteId,
      },
      select: { id: true },
    });

    await prisma.athleteProfile.upsert({
      where: { userId: athleteId },
      update: { coachId, disciplines: ['OTHER'] },
      create: { userId: athleteId, coachId, disciplines: ['OTHER'] },
      select: { userId: true },
    });
  });

  afterAll(async () => {
    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.adaptationTrigger.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteSessionFeedback.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftSession.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraftWeek.deleteMany({ where: { draft: { athleteId, coachId } } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('T5.A publish acknowledgement tracks last seen hash and rejects mismatches', async () => {
    const setup = {
      eventDate: '2026-08-15',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const p1 = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: new Date('2026-01-29T12:00:00.000Z') });
    expect(p1.published).toBe(true);
    expect(p1.hash).toBeTruthy();

    const s0 = await getAthletePublishStatus({ athleteId, aiPlanDraftId: draft.id });
    expect(s0.lastPublishedHash).toBe(p1.hash);
    expect(s0.athleteLastSeenHash).toBeNull();

    const ack = await ackAthletePublish({ athleteId, aiPlanDraftId: draft.id, lastSeenPublishedHash: p1.hash });
    expect(ack.lastSeenPublishedHash).toBe(p1.hash);

    const s1 = await getAthletePublishStatus({ athleteId, aiPlanDraftId: draft.id });
    expect(s1.athleteLastSeenHash).toBe(p1.hash);

    // Change the draft and publish a new hash.
    const firstSession = (draft.sessions as any[])?.[0];
    expect(firstSession?.id).toBeTruthy();

    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: draft.id,
      sessionEdits: [{ sessionId: String(firstSession.id), durationMinutes: Number(firstSession.durationMinutes) + 1 }],
    });

    const p2 = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: draft.id, now: new Date('2026-01-29T12:05:00.000Z') });
    expect(p2.hash).not.toBe(p1.hash);

    // Old hash ack should be rejected.
    await expect(
      ackAthletePublish({ athleteId, aiPlanDraftId: draft.id, lastSeenPublishedHash: p1.hash })
    ).rejects.toBeInstanceOf(ApiError);

    const s2 = await getAthletePublishStatus({ athleteId, aiPlanDraftId: draft.id });
    expect(s2.lastPublishedHash).toBe(p2.hash);
    expect(s2.athleteLastSeenHash).toBe(p1.hash);
  });

  it('T5.B batch approve applies safe proposal edits and blocks locked sessions', async () => {
    const setup = {
      eventDate: '2026-09-15',
      weeksToEvent: 6,
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 320,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const firstSession = (draft.sessions as any[])?.[0];
    expect(firstSession?.id).toBeTruthy();

    const { proposal } = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id });
    expect(proposal.status).toBe('PROPOSED');

    // Edit proposal diff to update a specific session.
    const updated = await updatePlanChangeProposalDiff({
      coachId,
      athleteId,
      proposalId: String(proposal.id),
      diffJson: [{ op: 'UPDATE_SESSION', draftSessionId: String(firstSession.id), patch: { durationMinutes: Number(firstSession.durationMinutes) + 7 } }],
    });
    expect(Array.isArray((updated as any).diffJson)).toBe(true);

    // Batch approve should apply it.
    const batch = await batchApproveSafeProposals({ coachId, athleteId, aiPlanDraftId: draft.id, proposalIds: [String(proposal.id)] });
    expect(batch.approvedCount).toBe(1);
    expect(batch.failedCount).toBe(0);

    const refreshed = await prisma.aiPlanDraftSession.findUniqueOrThrow({ where: { id: String(firstSession.id) } });
    expect(refreshed.durationMinutes).toBe(Number(firstSession.durationMinutes) + 7);

    // Now lock the session and verify batch approve blocks it.
    const { proposal: proposal2 } = await generatePlanChangeProposal({ coachId, athleteId, aiPlanDraftId: draft.id });

    await updatePlanChangeProposalDiff({
      coachId,
      athleteId,
      proposalId: String(proposal2.id),
      diffJson: [{ op: 'UPDATE_SESSION', draftSessionId: String(firstSession.id), patch: { durationMinutes: Number(firstSession.durationMinutes) + 8 } }],
    });

    await prisma.aiPlanDraftSession.update({ where: { id: String(firstSession.id) }, data: { locked: true } });

    const batch2 = await batchApproveSafeProposals({ coachId, athleteId, aiPlanDraftId: draft.id, proposalIds: [String(proposal2.id)] });
    expect(batch2.approvedCount).toBe(0);
    expect(batch2.failedCount).toBe(1);
    expect(batch2.results[0]?.code).toBe('SESSION_LOCKED');
  });
});
