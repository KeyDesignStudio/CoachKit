import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { commitPlanLibraryImportDraft } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireAdmin();
    const template = await commitPlanLibraryImportDraft({
      importJobId: context.params.id,
      userId: user.id,
    });
    return success({ template });
  } catch (error) {
    return handleError(error);
  }
}
