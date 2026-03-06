import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { rerunPlanSourceExtraction } from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const planSourceId = String((body as any)?.planSourceId ?? '');

    if (!planSourceId) {
      throw new ApiError(400, 'PLAN_SOURCE_ID_REQUIRED', 'planSourceId is required.');
    }
    const result = await rerunPlanSourceExtraction(planSourceId);
    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
