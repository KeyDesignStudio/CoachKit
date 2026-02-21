import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { evaluateAdaptationTriggers } from '@/modules/ai-plan-builder/server/adaptations';
import { generatePlanChangeProposal, listPlanChangeProposals } from '@/modules/ai-plan-builder/server/proposals';

const refreshRecommendationsSchema = z.object({
  aiPlanDraftId: z.string().min(1),
  windowDays: z.number().int().min(1).max(60).optional(),
});

function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(new Set(ids.map((v) => String(v ?? '').trim()).filter(Boolean))).sort();
}

function idsMatch(a: unknown, b: unknown) {
  const left = normalizeIds(a);
  const right = normalizeIds(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();
    const payload = refreshRecommendationsSchema.parse(await request.json().catch(() => ({})));

    const [latestFeedback, latestCompleted] = await Promise.all([
      prisma.athleteSessionFeedback.findFirst({
        where: { athleteId: context.params.athleteId, coachId: user.id, draftId: payload.aiPlanDraftId },
        orderBy: [{ createdAt: 'desc' }],
        select: { createdAt: true },
      }),
      prisma.completedActivity.findFirst({
        where: { athleteId: context.params.athleteId },
        orderBy: [{ startTime: 'desc' }],
        select: { startTime: true },
      }),
    ]);

    const latestSignalAt = (() => {
      const feedbackAt = latestFeedback?.createdAt ? new Date(latestFeedback.createdAt) : null;
      const completedAt = latestCompleted?.startTime ? new Date(latestCompleted.startTime) : null;
      if (feedbackAt && completedAt) return feedbackAt > completedAt ? feedbackAt : completedAt;
      return feedbackAt ?? completedAt;
    })();

    const evaluated = await evaluateAdaptationTriggers({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.aiPlanDraftId,
      windowDays: payload.windowDays,
    });
    const lastEvaluatedAt = evaluated?.now ? new Date(evaluated.now) : null;

    const latestWindowEndIso = evaluated.triggers?.[0]?.windowEnd ? new Date(evaluated.triggers[0].windowEnd).toISOString() : null;
    const latestTriggerIds = latestWindowEndIso
      ? normalizeIds(
          (evaluated.triggers ?? [])
            .filter((t: any) => new Date(t.windowEnd).toISOString() === latestWindowEndIso)
            .map((t: any) => String(t.id))
        )
      : [];

    const existing = await listPlanChangeProposals({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.aiPlanDraftId,
      limit: 40,
      offset: 0,
    });
    const queued = existing.filter((p: any) => String(p.status) === 'PROPOSED');
    const hasEquivalentQueued = latestTriggerIds.length
      ? queued.some((p: any) => idsMatch(p.triggerIds, latestTriggerIds))
      : false;

    let createdProposal: any | null = null;
    if (latestTriggerIds.length && !hasEquivalentQueued) {
      const generated = await generatePlanChangeProposal({
        coachId: user.id,
        athleteId: context.params.athleteId,
        aiPlanDraftId: payload.aiPlanDraftId,
        triggerIds: latestTriggerIds,
      });
      createdProposal = generated.proposal;
    }

    const refreshed = await listPlanChangeProposals({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.aiPlanDraftId,
      limit: 40,
      offset: 0,
    });

    const hasNewDataSinceLastEval = Boolean(
      latestSignalAt &&
        lastEvaluatedAt &&
        latestSignalAt.getTime() > lastEvaluatedAt.getTime()
    );

    const since = payload.windowDays && payload.windowDays > 0 ? new Date(Date.now() - payload.windowDays * 24 * 60 * 60 * 1000) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const [recentFeedback, recentCompleted] = await Promise.all([
      prisma.athleteSessionFeedback.findMany({
        where: {
          athleteId: context.params.athleteId,
          coachId: user.id,
          draftId: payload.aiPlanDraftId,
          createdAt: { gte: since },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 20,
        select: {
          createdAt: true,
          completedStatus: true,
          feel: true,
          rpe: true,
          sorenessFlag: true,
        },
      }),
      prisma.completedActivity.findMany({
        where: {
          athleteId: context.params.athleteId,
          startTime: { gte: since },
        },
        orderBy: [{ startTime: 'desc' }],
        take: 20,
        select: {
          startTime: true,
          rpe: true,
          painFlag: true,
          calendarItem: {
            select: {
              discipline: true,
            },
          },
        },
      }),
    ]);

    const timeline = [
      ...recentFeedback.map((row) => ({
        kind: 'feedback' as const,
        at: row.createdAt.toISOString(),
        summary: `Feedback: ${String(row.completedStatus ?? 'UNKNOWN')} | feel ${String(row.feel ?? '-')} | RPE ${row.rpe ?? '-'}${row.sorenessFlag ? ' | soreness' : ''}`,
      })),
      ...recentCompleted.map((row) => ({
        kind: 'completed' as const,
        at: row.startTime.toISOString(),
        summary: `Completed: ${String(row.calendarItem?.discipline ?? 'SESSION')} | RPE ${row.rpe ?? '-'}${row.painFlag ? ' | pain flag' : ''}`,
      })),
    ]
      .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
      .slice(0, 16);

    return success({
      createdProposal,
      latestTriggerIds,
      queuedRecommendations: refreshed.filter((p: any) => String(p.status) === 'PROPOSED').slice(0, 10),
      lastEvaluatedAt: lastEvaluatedAt ? lastEvaluatedAt.toISOString() : null,
      latestSignalAt: latestSignalAt ? latestSignalAt.toISOString() : null,
      hasNewDataSinceLastEval,
      signalTimeline: timeline,
    });
  } catch (error) {
    return handleError(error);
  }
}
