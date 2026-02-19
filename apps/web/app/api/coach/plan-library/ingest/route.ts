import { NextRequest } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { ingestPlanSourceFromForm } from '@/modules/plan-library/server/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const form = await request.formData();

    const created = await ingestPlanSourceFromForm({
      form,
      sourceTag: `coach:${user.id}`,
      defaultIsActive: true,
    });

    return success(created);
  } catch (error) {
    return handleError(error);
  }
}
