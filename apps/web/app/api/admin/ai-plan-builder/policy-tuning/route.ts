import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import {
  listPolicyTuningForAdmin,
  policyTuningUpsertSchema,
  refreshPolicyRuntimeOverridesFromDb,
  upsertPolicyTuning,
} from '@/modules/ai-plan-builder/server/policy-tuning';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireAiPlanBuilderAuditAdminUser();
    await refreshPolicyRuntimeOverridesFromDb();
    const profiles = await listPolicyTuningForAdmin();
    return success({ profiles });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const requester = await requireAiPlanBuilderAuditAdminUser();
    const payload = policyTuningUpsertSchema.parse(await request.json().catch(() => ({})));
    await upsertPolicyTuning({
      profileId: payload.profileId,
      override: payload.override,
      actorUserId: requester.id,
    });
    const profiles = await listPolicyTuningForAdmin();
    return success({ profiles });
  } catch (error) {
    return handleError(error);
  }
}

