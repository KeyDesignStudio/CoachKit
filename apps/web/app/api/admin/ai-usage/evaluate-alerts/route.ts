import { handleError, success } from '@/lib/http';

import { requireAiPlanBuilderAuditAdminUser } from '@/modules/ai-plan-builder/server/audit-admin';
import { evaluateAlerts, getUtcDayStart } from '@/modules/ai-plan-builder/admin/alerts';

function startOfUtcDay(date: Date): Date {
  return getUtcDayStart(date);
}

export async function POST(request: Request) {
  try {
    await requireAiPlanBuilderAuditAdminUser();

    const body = await request.json().catch(() => ({}));
    const daysRaw = Number((body as any)?.days ?? 7);
    const days = daysRaw === 7 || daysRaw === 30 || daysRaw === 90 ? daysRaw : 7;

    const todayStart = startOfUtcDay(new Date());

    for (let i = 0; i < days; i++) {
      const d = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
      await evaluateAlerts({ date: d });
    }

    return success({ ok: true, days });
  } catch (error) {
    return handleError(error);
  }
}
