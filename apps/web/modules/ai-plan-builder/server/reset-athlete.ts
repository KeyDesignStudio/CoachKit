import { z } from 'zod';

import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

import { APB_CALENDAR_ORIGIN, APB_MANUAL_EDIT_TAG, APB_SOURCE_PREFIX } from './calendar-materialise';

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
  calendarItems: number;
  calendarItemsSkipped: number;
};

export type AiPlanBuilderResetMode = 'APB_ONLY' | 'APB_AND_CALENDAR';

export type AiPlanBuilderResetAthleteResult = {
  athleteId: string;
  dryRun: boolean;
  mode: AiPlanBuilderResetMode;
  draftIds: string[];
  proposalIds: string[];
  counts: ResetCounts;
};

export const aiPlanBuilderResetAthleteSchema = z.object({
  athleteId: z.string().min(1),
  dryRun: z.boolean().optional(),
  mode: z.enum(['APB_ONLY', 'APB_AND_CALENDAR']).optional(),
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
  mode?: AiPlanBuilderResetMode;
}): Promise<AiPlanBuilderResetAthleteResult> {
  const athleteId = String(params.athleteId).trim();
  const dryRun = Boolean(params.dryRun);
  const mode: AiPlanBuilderResetMode = params.mode ?? 'APB_ONLY';

  const calendarDeleteFilter = {
    athleteId,
    origin: APB_CALENDAR_ORIGIN,
    sourceActivityId: { startsWith: APB_SOURCE_PREFIX },
    coachEdited: false,
    NOT: { tags: { has: APB_MANUAL_EDIT_TAG } },
  };

  const calendarSkipFilter = {
    athleteId,
    origin: APB_CALENDAR_ORIGIN,
    sourceActivityId: { startsWith: APB_SOURCE_PREFIX },
    OR: [{ coachEdited: true }, { tags: { has: APB_MANUAL_EDIT_TAG } }],
  };

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
    const calendarItems = mode === 'APB_AND_CALENDAR' ? await prisma.calendarItem.count({ where: calendarDeleteFilter }) : 0;
    const calendarItemsSkipped =
      mode === 'APB_AND_CALENDAR' ? await prisma.calendarItem.count({ where: calendarSkipFilter }) : 0;

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
      calendarItems,
      calendarItemsSkipped,
    };
  })();

  if (dryRun) {
    return { athleteId, dryRun: true, mode, draftIds, proposalIds, counts };
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

    const calendarItems =
      mode === 'APB_AND_CALENDAR' ? await tx.calendarItem.deleteMany({ where: calendarDeleteFilter }) : { count: 0 };

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
      calendarItems: calendarItems.count,
      calendarItemsSkipped: counts.calendarItemsSkipped,
    } satisfies ResetCounts;
  });

  return {
    athleteId,
    dryRun: false,
    mode,
    draftIds,
    proposalIds,
    counts: deleted,
  };
}
