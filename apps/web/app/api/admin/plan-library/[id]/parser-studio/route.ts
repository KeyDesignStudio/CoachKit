import { NextRequest } from 'next/server';
import { type PlanSourceExtractionReviewStatus } from '@prisma/client';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import {
  assignPlanSourceLayoutFamily,
  createPlanSourceExtractionReview,
  getParserStudioSourceDetail,
  rerunPlanSourceExtraction,
} from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseReviewStatus(value: unknown): PlanSourceExtractionReviewStatus {
  if (value === 'APPROVED' || value === 'NEEDS_REVIEW' || value === 'REJECTED') return value;
  throw new ApiError(400, 'INVALID_REVIEW_STATUS', 'reviewStatus must be APPROVED, NEEDS_REVIEW, or REJECTED.');
}

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const data = await getParserStudioSourceDetail(context.params.id);
    return success(data);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json().catch(() => ({}));

    if (Object.prototype.hasOwnProperty.call(body, 'layoutFamilyId')) {
      await assignPlanSourceLayoutFamily({
        planSourceId: context.params.id,
        layoutFamilyId: body.layoutFamilyId ? String(body.layoutFamilyId) : null,
      });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'reviewStatus')) {
      await createPlanSourceExtractionReview({
        planSourceId: context.params.id,
        reviewer: { userId: user.id, email: user.email },
        status: parseReviewStatus(body.reviewStatus),
        notes: typeof body.reviewNotes === 'string' ? body.reviewNotes : null,
      });
    }

    const data = await getParserStudioSourceDetail(context.params.id);
    return success(data);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const action = String((body as any)?.action ?? '');
    if (action !== 'reextract') {
      throw new ApiError(400, 'INVALID_ACTION', 'action must be reextract.');
    }
    const result = await rerunPlanSourceExtraction(context.params.id);
    return success(result);
  } catch (error) {
    return handleError(error);
  }
}
