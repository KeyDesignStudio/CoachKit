import { handleError, success } from '@/lib/http';

import {
  requireAiPlanBuilderAuditAdminUser,
  normalizeAiAuditListQuery,
  listAiInvocationAuditsForAdmin,
} from '@/modules/ai-plan-builder/server/audit-admin';

export async function GET(request: Request) {
  try {
    const requester = await requireAiPlanBuilderAuditAdminUser();

    const url = new URL(request.url);
    const searchParams: Record<string, string | string[] | undefined> = {};
    url.searchParams.forEach((value, key) => {
      searchParams[key] = value;
    });

    const query = normalizeAiAuditListQuery({ searchParams });
    const result = await listAiInvocationAuditsForAdmin({ query, requester });

    return success({ audits: result.items, page: result.page });
  } catch (error) {
    return handleError(error);
  }
}
