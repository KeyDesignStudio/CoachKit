import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import {
  aiEngineControlsUpsertSchema,
  getAiEngineControlsView,
  upsertAiEngineControls,
} from '@/modules/ai-plan-builder/server/engine-controls';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAiPlanBuilderAuditAdminUser();
    const data = await getAiEngineControlsView();
    return success(data);
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const requester = await requireAiPlanBuilderAuditAdminUser();
    const payload = aiEngineControlsUpsertSchema.parse(await request.json().catch(() => ({})));
    await upsertAiEngineControls({ overrides: payload.overrides, actorUserId: requester.id });
    const data = await getAiEngineControlsView();
    return success(data);
  } catch (error) {
    return handleError(error);
  }
}
