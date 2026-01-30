import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser, getAiInvocationAuditForAdmin } from '@/modules/ai-plan-builder/server/audit-admin';

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const requester = await requireAiPlanBuilderAuditAdminUser();
    const audit = await getAiInvocationAuditForAdmin({ id: context.params.id, requester });
    return success({ audit });
  } catch (error) {
    return handleError(error);
  }
}
