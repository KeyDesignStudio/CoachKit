import { z } from 'zod';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

export const AI_PLAN_BUILDER_ADMIN_RESET_SECRET_ENV = 'AI_PLAN_BUILDER_ADMIN_RESET_SECRET' as const;

type ResetCounts = {
  planChangeAudits: number;
  planChangeProposals: number;
  aiLlmRateLimitEvents: number;
  aiInvocationAudits: number;
  aiPlanDrafts: number;
  coachIntents: number;
  athleteProfileAis: number;
  intakeEvidence: number;
  intakeResponses: number;
};

export type AiPlanBuilderResetAthleteResult = {
  athleteId: string;
  dryRun: boolean;
  draftIds: string[];
  proposalIds: string[];
  counts: ResetCounts;
};

export const aiPlanBuilderResetAthleteSchema = z.object({
  athleteId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

const capabilitiesToReset = ['summarizeIntake', 'suggestDraftPlan', 'suggestProposalDiffs'] as const;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // Avoid timing leaks for secrets.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireAiPlanBuilderAdminResetSecret(headers: Headers, env: NodeJS.ProcessEnv = process.env): void {
  const expected = String(env[AI_PLAN_BUILDER_ADMIN_RESET_SECRET_ENV] ?? '').trim();
  if (!expected) return;

  const provided = String(headers.get('x-reset-secret') ?? '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    // 404-by-default: avoid leaking route existence.
    throw notFound('Not found.');
  }
}

export async function resetAiPlanBuilderStateForAthlete(params: {
  athleteId: string;
  dryRun?: boolean;
}): Promise<AiPlanBuilderResetAthleteResult> {
  const athleteId = String(params.athleteId).trim();
  const dryRun = Boolean(params.dryRun);

  const draftIds = await prisma.aiPlanDraft
    .findMany({ where: { athleteId }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  const proposalIds = await prisma.planChangeProposal
    .findMany({
      where: { athleteId, draftPlanId: { in: draftIds } },
      select: { id: true },
    })
    .then((rows) => rows.map((r) => r.id));

  const counts = await (async (): Promise<ResetCounts> => {
    const planChangeAudits = await prisma.planChangeAudit.count({
      where: {
        OR: [{ draftPlanId: { in: draftIds } }, { proposalId: { in: proposalIds } }],
      },
    });

    const planChangeProposals = await prisma.planChangeProposal.count({ where: { id: { in: proposalIds } } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiLlmRateLimitEvents = await (prisma as any).aiLlmRateLimitEvent.count({
      where: {
        athleteId,
        capability: { in: [...capabilitiesToReset] },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiInvocationAudits = await (prisma as any).aiInvocationAudit.count({
      where: {
        athleteId,
        capability: { in: [...capabilitiesToReset] },
      },
    });

    const aiPlanDrafts = await prisma.aiPlanDraft.count({ where: { athleteId } });
    const coachIntents = await prisma.coachIntent.count({ where: { athleteId } });
    const athleteProfileAis = await prisma.athleteProfileAI.count({ where: { athleteId } });
    const intakeEvidence = await prisma.intakeEvidence.count({ where: { athleteId } });
    const intakeResponses = await prisma.athleteIntakeResponse.count({ where: { athleteId } });

    return {
      planChangeAudits,
      planChangeProposals,
      aiLlmRateLimitEvents,
      aiInvocationAudits,
      aiPlanDrafts,
      coachIntents,
      athleteProfileAis,
      intakeEvidence,
      intakeResponses,
    };
  })();

  if (dryRun) {
    return { athleteId, dryRun: true, draftIds, proposalIds, counts };
  }

  // Delete in a safe order: audits/proposals first, then drafts (cascade), then intake/profile.
  const deleted = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txAny = tx as any;

    const planChangeAudits = await tx.planChangeAudit.deleteMany({
      where: {
        OR: [{ draftPlanId: { in: draftIds } }, { proposalId: { in: proposalIds } }],
      },
    });

    const planChangeProposals = await tx.planChangeProposal.deleteMany({ where: { id: { in: proposalIds } } });

    const aiLlmRateLimitEvents = await txAny.aiLlmRateLimitEvent.deleteMany({
      where: {
        athleteId,
        capability: { in: [...capabilitiesToReset] },
      },
    });

    const aiInvocationAudits = await txAny.aiInvocationAudit.deleteMany({
      where: {
        athleteId,
        capability: { in: [...capabilitiesToReset] },
      },
    });

    const aiPlanDrafts = await tx.aiPlanDraft.deleteMany({ where: { athleteId } });

    const coachIntents = await tx.coachIntent.deleteMany({ where: { athleteId } });
    const athleteProfileAis = await tx.athleteProfileAI.deleteMany({ where: { athleteId } });

    const intakeEvidence = await tx.intakeEvidence.deleteMany({ where: { athleteId } });
    const intakeResponses = await tx.athleteIntakeResponse.deleteMany({ where: { athleteId } });

    return {
      planChangeAudits: planChangeAudits.count,
      planChangeProposals: planChangeProposals.count,
      aiLlmRateLimitEvents: aiLlmRateLimitEvents.count,
      aiInvocationAudits: aiInvocationAudits.count,
      aiPlanDrafts: aiPlanDrafts.count,
      coachIntents: coachIntents.count,
      athleteProfileAis: athleteProfileAis.count,
      intakeEvidence: intakeEvidence.count,
      intakeResponses: intakeResponses.count,
    } satisfies ResetCounts;
  });

  return {
    athleteId,
    dryRun: false,
    draftIds,
    proposalIds,
    counts: deleted,
  };
}
