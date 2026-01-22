import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { failure, handleError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    return failure(
      'PLAN_LIBRARY_PUBLISH_DISABLED',
      'Publishing Plan Library sessions into the coach Workout Library has been removed. Plan Library now only populates PlanTemplate + PlanTemplateScheduleRow for future athlete self-assign.',
      410
    );
  } catch (error) {
    return handleError(error);
  }
}
