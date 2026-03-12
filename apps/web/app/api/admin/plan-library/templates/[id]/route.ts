import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { deletePlanLibraryTemplate, getPlanLibraryTemplate } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const template = await getPlanLibraryTemplate(context.params.id);
    return success({ template });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const result = await deletePlanLibraryTemplate(context.params.id);
    return success({ deleted: result });
  } catch (error) {
    return handleError(error);
  }
}
