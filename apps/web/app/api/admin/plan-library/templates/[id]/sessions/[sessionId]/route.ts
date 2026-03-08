import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { updatePlanLibraryTemplateSession } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, context: { params: { id: string; sessionId: string } }) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const session = await updatePlanLibraryTemplateSession({
      templateId: context.params.id,
      sessionId: context.params.sessionId,
      payload: body ?? {},
    });
    return success({ session });
  } catch (error) {
    return handleError(error);
  }
}
