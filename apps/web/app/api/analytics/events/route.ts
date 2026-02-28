import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import type { FutureSelfEventName } from '@/lib/future-self-analytics';

export const dynamic = 'force-dynamic';

const schema = z.object({
  eventName: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const allowed = new Set<FutureSelfEventName>([
  'future_self_run_projection',
  'future_self_adjust_scenario',
  'future_self_toggle_visibility',
  'future_self_share_card',
  'future_self_view',
  'future_self_change_horizon',
  'future_self_open_assumptions',
]);

export async function POST(request: Request) {
  try {
    const { user } = await requireAuth();
    const body = schema.parse(await request.json());

    if (!allowed.has(body.eventName as FutureSelfEventName)) {
      return success({ accepted: false });
    }

    console.info('[analytics]', {
      category: 'future-self',
      eventName: body.eventName,
      actorId: user.id,
      actorRole: user.role,
      payload: body.payload ?? {},
      at: new Date().toISOString(),
    });

    return success({ accepted: true });
  } catch (error) {
    return handleError(error, { where: 'POST /api/analytics/events' });
  }
}
