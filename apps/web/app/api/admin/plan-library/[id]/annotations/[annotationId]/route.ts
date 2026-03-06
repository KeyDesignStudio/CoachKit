import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

import { deletePlanSourceAnnotation, getParserStudioSourceDetail } from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_request: NextRequest, context: { params: { id: string; annotationId: string } }) {
  try {
    await requireAdmin();
    await deletePlanSourceAnnotation({
      planSourceId: context.params.id,
      annotationId: context.params.annotationId,
    });
    return success(await getParserStudioSourceDetail(context.params.id));
  } catch (error) {
    return handleError(error);
  }
}
