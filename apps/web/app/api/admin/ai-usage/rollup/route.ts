import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import { computeDailyRollups, getUtcDayWindowForLastNDays } from '@/modules/ai-plan-builder/admin/rollups';

export async function POST(request: Request) {
  try {
    await requireAiPlanBuilderAuditAdminUser();

    const body = await request.json().catch(() => ({}));
    const daysRaw = Number((body as any)?.days ?? 30);
    const days = daysRaw === 7 || daysRaw === 30 || daysRaw === 90 ? daysRaw : 30;

    const { since, until } = getUtcDayWindowForLastNDays(days);
    await computeDailyRollups({ since, until });

    return success({ ok: true, days, since, until });
  } catch (error) {
    return handleError(error);
  }
}
