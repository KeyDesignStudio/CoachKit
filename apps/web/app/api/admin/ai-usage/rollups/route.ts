import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import { getUtcDayWindowForLastNDays } from '@/modules/ai-plan-builder/admin/rollups';

export async function GET(request: Request) {
  try {
    await requireAiPlanBuilderAuditAdminUser();

    const url = new URL(request.url);
    const daysRaw = Number(url.searchParams.get('days') ?? '30');
    const days = daysRaw === 7 || daysRaw === 30 || daysRaw === 90 ? daysRaw : 30;

    const { since, until } = getUtcDayWindowForLastNDays(days);

    const rollups = await prisma.aiInvocationDailyRollup.findMany({
      where: {
        date: {
          gte: since,
          lt: until,
        },
      },
      orderBy: [{ date: 'desc' }, { capability: 'asc' }],
    });

    return success({ rollups, days, since, until });
  } catch (error) {
    return handleError(error);
  }
}
