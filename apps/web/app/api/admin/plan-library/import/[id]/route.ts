import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { getPlanLibraryImportJob } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const importJob = await getPlanLibraryImportJob(context.params.id);
    return success({ importJob });
  } catch (error) {
    return handleError(error);
  }
}
