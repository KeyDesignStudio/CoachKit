import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { validatePlanLibraryTemplate } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const validationRun = await validatePlanLibraryTemplate(context.params.id);
    return success({ validationRun });
  } catch (error) {
    return handleError(error);
  }
}
