import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { guardAiPlanBuilderRequest } from '@/modules/ai-plan-builder/server/guard';
import { publishAiDraftPlan, publishDraftPlanSchema } from '@/modules/ai-plan-builder/server/publish';
import { materialisePublishedAiPlanToCalendar } from '@/modules/ai-plan-builder/server/calendar-materialise';

export async function POST(request: Request, context: { params: { athleteId: string } }) {
  try {
    guardAiPlanBuilderRequest();
    const { user } = await requireCoach();

    const body = publishDraftPlanSchema.parse(await request.json().catch(() => ({})));

    const result = await publishAiDraftPlan({
      coachId: user.id,
      athleteId: context.params.athleteId,
      aiPlanDraftId: body.aiPlanDraftId,
    });

    // Publish must be immediate calendar truth.
    // Best-effort: return success even if materialisation fails; the draft remains published.
    let materialisation:
      | { ok: true; upsertedCount: number; softDeletedCount: number; publishedPlanId: string }
      | { ok: false; code: 'CALENDAR_MATERIALISE_FAILED'; message: string };

    try {
      const m = await materialisePublishedAiPlanToCalendar({
        coachId: user.id,
        athleteId: context.params.athleteId,
        aiPlanDraftId: body.aiPlanDraftId,
      });
      materialisation = { ok: true, upsertedCount: m.upsertedCount, softDeletedCount: m.softDeletedCount, publishedPlanId: m.publishedPlanId };
    } catch (e) {
      console.error('APB_CALENDAR_MATERIALISE_FAILED', {
        athleteId: context.params.athleteId,
        coachId: user.id,
        aiPlanDraftId: body.aiPlanDraftId,
        error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: e },
      });
      materialisation = {
        ok: false,
        code: 'CALENDAR_MATERIALISE_FAILED',
        message: e instanceof Error ? e.message : 'Calendar materialisation failed.',
      };
    }

    return success({
      draftPlan: result.draft,
      publish: { published: result.published, summaryText: result.summaryText, hash: result.hash },
      materialisation,
    });
  } catch (error) {
    return handleError(error);
  }
}
