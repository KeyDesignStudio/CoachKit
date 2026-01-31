import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';

export async function GET(request: Request) {
  try {
    await requireAiPlanBuilderAuditAdminUser();

    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '20') || 20));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0);

    const rows = await prisma.aiUsageAlert.findMany({
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });

    const hasPrev = offset > 0;
    const hasNext = rows.length === limit;

    return success({ alerts: rows, page: { limit, offset, hasPrev, hasNext } });
  } catch (error) {
    return handleError(error);
  }
}
