import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import { acknowledgeAlert } from '@/modules/ai-plan-builder/admin/alerts';

export async function POST(_: Request, context: { params: { id: string } }) {
  try {
    const requester = await requireAiPlanBuilderAuditAdminUser();

    const id = String(context?.params?.id || '');
    if (!id) return success({ ok: false });

    await acknowledgeAlert({ id, requester });

    return success({ ok: true, id });
  } catch (error) {
    return handleError(error);
  }
}
