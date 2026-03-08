import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { createPlanLibraryImportJob } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin();
    const form = await request.formData();
    const job = await createPlanLibraryImportJob({
      form,
      userId: user.id,
    });
    return success({ importJob: job });
  } catch (error) {
    return handleError(error);
  }
}
