import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';

import { generateAiDraftPlanV1 } from '@/modules/ai-plan-builder/server/draft-plan';
import { renderProposalDiff } from '@/modules/ai-plan-builder/server/proposal-diff-renderer';
import { getProposalPreview } from '@/modules/ai-plan-builder/server/proposal-preview';
import { approveAndPublishPlanChangeProposal } from '@/modules/ai-plan-builder/server/approve-and-publish';
import { publishAiDraftPlan } from '@/modules/ai-plan-builder/server/publish';
import { batchApproveSafeProposalsWithMode } from '@/modules/ai-plan-builder/server/proposals';

import { createAthlete, createCoach, seedTriggersAndProposal } from './seed';

describe('AI Plan Builder v1 (Tranche 7A: diff preview + approve/publish)', () => {
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
    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId } });
    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('T7A.1 diff renderer is deterministic (snapshot)', async () => {
    const setup = {
      eventDate: '2026-08-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: draft.id });

    const preview = renderProposalDiff(
      {
        id: String(seeded.proposal.id),
        diffJson: seeded.proposal.diffJson,
        draftSessions: (draft.sessions ?? []).map((s: any) => ({
          id: String(s.id),
          weekIndex: Number(s.weekIndex ?? 0),
          ordinal: Number(s.ordinal ?? 0),
          dayOfWeek: Number(s.dayOfWeek ?? 0),
          discipline: String(s.discipline ?? ''),
          type: String(s.type ?? ''),
          durationMinutes: Number(s.durationMinutes ?? 0),
          locked: Boolean(s.locked),
        })),
      },
      draft.planJson
    );

    expect(preview).toMatchSnapshot();

    // Same inputs => identical output
    const preview2 = renderProposalDiff(
      {
        id: String(seeded.proposal.id),
        diffJson: seeded.proposal.diffJson,
        draftSessions: (draft.sessions ?? []).map((s: any) => ({
          id: String(s.id),
          weekIndex: Number(s.weekIndex ?? 0),
          ordinal: Number(s.ordinal ?? 0),
          dayOfWeek: Number(s.dayOfWeek ?? 0),
          discipline: String(s.discipline ?? ''),
          type: String(s.type ?? ''),
          durationMinutes: Number(s.durationMinutes ?? 0),
          locked: Boolean(s.locked),
        })),
      },
      draft.planJson
    );

    expect(preview2).toEqual(preview);
  });

  it('T7A.2 preview lock safety flags locked entities', async () => {
    const setup = {
      eventDate: '2026-09-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 3, 5, 6],
      weeklyAvailabilityMinutes: 300,
      disciplineEmphasis: 'bike' as const,
      riskTolerance: 'med' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const firstSession = Array.isArray(draft.sessions) ? draft.sessions[0] : null;
    expect(firstSession?.id).toBeTruthy();

    const proposal = await prisma.planChangeProposal.create({
      data: {
        athleteId,
        coachId,
        status: 'PROPOSED',
        draftPlanId: String(draft.id),
        respectsLocks: true,
        proposalJson: {},
        diffJson: [
          {
            op: 'UPDATE_SESSION',
            draftSessionId: String(firstSession.id),
            patch: { durationMinutes: Number(firstSession.durationMinutes ?? 0) + 1 },
          },
        ],
      },
    });

    await prisma.aiPlanDraftSession.update({ where: { id: String(firstSession.id) }, data: { locked: true } });

    const res = await getProposalPreview({
      coachId,
      athleteId,
      proposalId: String(proposal.id),
      aiPlanDraftId: String(draft.id),
    });

    expect(res.applySafety.wouldFailDueToLocks).toBe(true);
    expect(res.applySafety.reasons.some((r) => r.code === 'SESSION_LOCKED' || r.code === 'WEEK_LOCKED')).toBe(true);
  });

  it('T7A.3 approve-and-publish applies diff, writes audit once, and publishes idempotently', async () => {
    const setup = {
      eventDate: '2026-10-01',
      weeksToEvent: 4,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 4, 6],
      weeklyAvailabilityMinutes: 240,
      disciplineEmphasis: 'run' as const,
      riskTolerance: 'low' as const,
      maxIntensityDaysPerWeek: 1,
      maxDoublesPerWeek: 0,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;
    const seeded = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: draft.id });

    const res = await approveAndPublishPlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(seeded.proposal.id),
      aiPlanDraftId: String(draft.id),
    });

    expect(res.approval.proposal.status).toBe('APPLIED');
    expect(res.publish.ok).toBe(true);

    const after = await prisma.aiPlanDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.visibilityStatus).toBe('PUBLISHED');
    expect(after.lastPublishedHash).toBeTruthy();

    const audits = await prisma.planChangeAudit.findMany({ where: { proposalId: String(seeded.proposal.id) } });
    expect(audits.length).toBe(1);

    const secondPublish = await publishAiDraftPlan({ coachId, athleteId, aiPlanDraftId: String(draft.id) });
    expect(secondPublish.published).toBe(false);
  });

  it('T7A.4 batch approve_and_publish approves safe proposals then publishes once', async () => {
    const setup = {
      eventDate: '2026-11-01',
      weeksToEvent: 6,
      weekStart: 'monday',
      weeklyAvailabilityDays: [1, 2, 3, 5, 6],
      weeklyAvailabilityMinutes: 360,
      disciplineEmphasis: 'balanced' as const,
      riskTolerance: 'high' as const,
      maxIntensityDaysPerWeek: 2,
      maxDoublesPerWeek: 1,
      longSessionDay: 6,
    };

    const draft = (await generateAiDraftPlanV1({ coachId, athleteId, setup })) as any;

    const p1 = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: draft.id });
    const p2 = await seedTriggersAndProposal({ coachId, athleteId, aiPlanDraftId: draft.id });

    const result = await batchApproveSafeProposalsWithMode({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      proposalIds: [String(p1.proposal.id), String(p2.proposal.id)],
      mode: 'approve_and_publish',
    });

    expect(result.batch.approvedCount).toBe(2);
    expect(result.publish?.ok).toBe(true);

    const snapshots = await prisma.aiPlanDraftPublishSnapshot.findMany({ where: { draftId: String(draft.id) } });
    expect(snapshots.length).toBe(1);
  });
});
