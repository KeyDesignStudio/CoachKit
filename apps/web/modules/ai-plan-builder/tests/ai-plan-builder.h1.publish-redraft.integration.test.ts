import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { generateAiDraftPlanV1, updateAiDraftPlan } from '@/modules/ai-plan-builder/server/draft-plan';
import { publishAiDraftPlan } from '@/modules/ai-plan-builder/server/publish';
import { getPublishedAiPlanForAthlete } from '@/modules/ai-plan-builder/server/athlete-plan';
import {
  approvePlanChangeProposal,
  createCoachControlProposalFromDiff,
  createUndoProposalFromAppliedProposal,
} from '@/modules/ai-plan-builder/server/proposals';
import type { PlanDiffOp } from '@/modules/ai-plan-builder/server/adaptation-diff';

import { createAthlete, createCoach } from './seed';

describe('AI Plan Builder v1 (H1: publish/redraft release readiness)', () => {
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
    if (!coachId || !athleteId) {
      return;
    }

    await prisma.planChangeAudit.deleteMany({ where: { athleteId, coachId } });
    await prisma.planChangeProposal.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanPublishAck.deleteMany({ where: { athleteId } });
    await prisma.aiPlanDraftPublishSnapshot.deleteMany({ where: { athleteId, coachId } });
    await prisma.aiPlanDraft.deleteMany({ where: { athleteId, coachId } });
    await prisma.athleteBrief.deleteMany({ where: { athleteId, coachId } });

    await prisma.athleteProfile.deleteMany({ where: { userId: athleteId, coachId } });
    await prisma.user.deleteMany({ where: { id: athleteId } });
    await prisma.user.deleteMany({ where: { id: coachId } });

    await prisma.$disconnect();
  });

  it('H1.1 blocks stale proposal apply when targeted sessions changed after proposal creation', async () => {
    const draft = (await generateAiDraftPlanV1({
      coachId,
      athleteId,
      setup: {
        eventDate: '2026-11-20',
        weeksToEvent: 6,
        weekStart: 'monday',
        weeklyAvailabilityDays: [1, 2, 4, 6],
        weeklyAvailabilityMinutes: 320,
        disciplineEmphasis: 'run',
        riskTolerance: 'med',
        maxIntensityDaysPerWeek: 2,
        maxDoublesPerWeek: 0,
        longSessionDay: 6,
      },
    })) as any;

    const target = (draft.sessions as any[])[0];
    expect(target?.id).toBeTruthy();

    const diff: PlanDiffOp[] = [
      {
        op: 'UPDATE_SESSION',
        draftSessionId: String(target.id),
        patch: { durationMinutes: Number(target.durationMinutes ?? 0) + 10 },
      },
    ];
    const { proposal } = await createCoachControlProposalFromDiff({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      diffJson: diff,
      rationaleText: 'Increase one run session by 10 min.',
    });
    expect(proposal.status).toBe('PROPOSED');

    // Simulate a coach/manual change after proposal creation.
    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: String(draft.id),
      sessionEdits: [{ sessionId: String(target.id), notes: 'Manual override after proposal creation.' }],
    });

    await expect(
      approvePlanChangeProposal({
        coachId,
        athleteId,
        proposalId: String(proposal.id),
      })
    ).rejects.toMatchObject({ code: 'PROPOSAL_CONFLICT' });
  });

  it('H1.2 supports undo proposal flow (apply -> republish -> undo -> republish)', async () => {
    const draft = (await generateAiDraftPlanV1({
      coachId,
      athleteId,
      setup: {
        eventDate: '2026-12-01',
        weeksToEvent: 6,
        weekStart: 'monday',
        weeklyAvailabilityDays: [1, 2, 3, 5, 6],
        weeklyAvailabilityMinutes: 360,
        disciplineEmphasis: 'balanced',
        riskTolerance: 'med',
        maxIntensityDaysPerWeek: 2,
        maxDoublesPerWeek: 1,
        longSessionDay: 6,
      },
    })) as any;
    const target = (draft.sessions as any[])[0];
    expect(target?.id).toBeTruthy();

    const initial = await publishAiDraftPlan({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      now: new Date('2026-02-25T08:00:00.000Z'),
    });
    expect(initial.published).toBe(true);

    const proposal = await createCoachControlProposalFromDiff({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      diffJson: [
        {
          op: 'UPDATE_SESSION',
          draftSessionId: String(target.id),
          patch: {
            durationMinutes: Number(target.durationMinutes ?? 0) + 15,
            notes: 'Progression block adjustment',
          },
        },
      ],
      rationaleText: 'Progressive load adjustment.',
    });
    expect(proposal.proposal.status).toBe('PROPOSED');

    const applied = await approvePlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(proposal.proposal.id),
    });
    expect(applied.updatedProposal.status).toBe('APPLIED');

    const republish = await publishAiDraftPlan({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      now: new Date('2026-02-25T08:10:00.000Z'),
    });
    expect(republish.published).toBe(true);
    expect(republish.hash).not.toBe(initial.hash);

    const undoCreated = await createUndoProposalFromAppliedProposal({
      coachId,
      athleteId,
      proposalId: String(proposal.proposal.id),
    });
    expect(undoCreated.proposal.status).toBe('PROPOSED');

    const undoApplied = await approvePlanChangeProposal({
      coachId,
      athleteId,
      proposalId: String(undoCreated.proposal.id),
    });
    expect(undoApplied.updatedProposal.status).toBe('APPLIED');

    const finalPublish = await publishAiDraftPlan({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      now: new Date('2026-02-25T08:20:00.000Z'),
    });
    expect(finalPublish.published).toBe(true);
    expect(finalPublish.hash).toBe(initial.hash);
  });

  it('H1.3 athlete continues to see only published draft state through republish cycle', async () => {
    const draft = (await generateAiDraftPlanV1({
      coachId,
      athleteId,
      setup: {
        eventDate: '2027-01-01',
        weeksToEvent: 4,
        weekStart: 'monday',
        weeklyAvailabilityDays: [1, 3, 5, 0],
        weeklyAvailabilityMinutes: 260,
        disciplineEmphasis: 'bike',
        riskTolerance: 'low',
        maxIntensityDaysPerWeek: 1,
        maxDoublesPerWeek: 0,
        longSessionDay: 0,
      },
    })) as any;
    const target = (draft.sessions as any[])[0];
    expect(target?.id).toBeTruthy();

    await expect(getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: String(draft.id) })).rejects.toBeInstanceOf(ApiError);

    const firstPublish = await publishAiDraftPlan({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      now: new Date('2026-03-01T09:00:00.000Z'),
    });
    expect(firstPublish.published).toBe(true);

    const publishedV1 = await getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: String(draft.id) });
    const originalSession = (publishedV1.sessions as any[]).find((s) => String(s.id) === String(target.id));
    expect(Number(originalSession?.durationMinutes ?? 0)).toBe(Number(target.durationMinutes ?? 0));

    await updateAiDraftPlan({
      coachId,
      athleteId,
      draftPlanId: String(draft.id),
      sessionEdits: [{ sessionId: String(target.id), durationMinutes: Number(target.durationMinutes ?? 0) + 20 }],
    });

    // Still returns the currently published snapshot; athlete cannot see unpublished edits.
    const publishedStillV1 = await getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: String(draft.id) });
    const stillSession = (publishedStillV1.sessions as any[]).find((s) => String(s.id) === String(target.id));
    expect(Number(stillSession?.durationMinutes ?? 0)).toBe(Number(target.durationMinutes ?? 0));

    const secondPublish = await publishAiDraftPlan({
      coachId,
      athleteId,
      aiPlanDraftId: String(draft.id),
      now: new Date('2026-03-01T09:10:00.000Z'),
    });
    expect(secondPublish.published).toBe(true);

    const publishedV2 = await getPublishedAiPlanForAthlete({ athleteId, aiPlanDraftId: String(draft.id) });
    const updatedSession = (publishedV2.sessions as any[]).find((s) => String(s.id) === String(target.id));
    expect(Number(updatedSession?.durationMinutes ?? 0)).toBe(Number(target.durationMinutes ?? 0) + 20);
  });
});
