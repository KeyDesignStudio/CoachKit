import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import {
  aiPlanBuilderResetAthleteSchema,
  requireAiPlanBuilderAdminResetSecret,
  resetAiPlanBuilderStateForAthlete,
} from '@/modules/ai-plan-builder/server/reset-athlete';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await requireAiPlanBuilderAuditAdminUser();
    requireAiPlanBuilderAdminResetSecret(request.headers);

    const body = aiPlanBuilderResetAthleteSchema.parse(await request.json().catch(() => ({})));

    const result = await resetAiPlanBuilderStateForAthlete({
      athleteId: body.athleteId,
      dryRun: body.dryRun,
      mode: body.mode,
    });

    // Log only athleteId + counts. No PII.
    console.info('[apb_admin_reset_athlete]', {
      athleteId: result.athleteId,
      dryRun: result.dryRun,
      counts: result.counts,
    });

    return success({ ok: true, ...result });
  } catch (error) {
    return handleError(error);
  }
}
