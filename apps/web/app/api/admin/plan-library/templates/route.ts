import { NextRequest } from 'next/server';
import { PlanLibraryTemplateReviewStatus } from '@prisma/client';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { listPlanLibraryTemplates } from '@/modules/plan-library/server/structured-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseReviewStatus(value: string | null) {
  if (!value) return null;
  if (
    value === PlanLibraryTemplateReviewStatus.DRAFT ||
    value === PlanLibraryTemplateReviewStatus.REVIEWED ||
    value === PlanLibraryTemplateReviewStatus.PUBLISHED ||
    value === PlanLibraryTemplateReviewStatus.REJECTED
  ) {
    return value;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const reviewStatus = parseReviewStatus(searchParams.get('reviewStatus'));
    const isPublishedParam = searchParams.get('isPublished');
    const isPublished = isPublishedParam == null ? null : isPublishedParam === 'true';
    const templates = await listPlanLibraryTemplates({ reviewStatus, isPublished });
    return success({ templates });
  } catch (error) {
    return handleError(error);
  }
}
