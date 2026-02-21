import { z } from 'zod';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

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

    const evaluated = await evaluateAdaptationTriggers({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: payload.aiPlanDraftId,
      windowDays: payload.windowDays,
    });

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

    return success({
      createdProposal,
      latestTriggerIds,
      queuedRecommendations: refreshed.filter((p: any) => String(p.status) === 'PROPOSED').slice(0, 10),
    });
  } catch (error) {
    return handleError(error);
  }
}

