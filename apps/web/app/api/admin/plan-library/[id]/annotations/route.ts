import { NextRequest } from 'next/server';
import { type PlanSourceAnnotationType, Prisma } from '@prisma/client';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { createPlanSourceAnnotation, getParserStudioSourceDetail } from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseAnnotationType(value: unknown): PlanSourceAnnotationType {
  if (
    value === 'WEEK_HEADER' ||
    value === 'DAY_LABEL' ||
    value === 'SESSION_CELL' ||
    value === 'BLOCK_TITLE' ||
    value === 'IGNORE_REGION' ||
    value === 'LEGEND' ||
    value === 'NOTE'
  ) {
    return value;
  }
  throw new ApiError(400, 'INVALID_ANNOTATION_TYPE', 'annotationType is invalid.');
}

function parseBBox(value: unknown): Prisma.InputJsonValue {
  const box = value as Record<string, unknown> | null | undefined;
  const x = Number(box?.x ?? NaN);
  const y = Number(box?.y ?? NaN);
  const width = Number(box?.width ?? NaN);
  const height = Number(box?.height ?? NaN);
  if (![x, y, width, height].every((part) => Number.isFinite(part))) {
    throw new ApiError(400, 'INVALID_BBOX', 'bbox must contain numeric x, y, width, and height values.');
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) {
    throw new ApiError(400, 'INVALID_BBOX_RANGE', 'bbox values must be normalized between 0 and 1.');
  }
  return { x, y, width, height } as Prisma.InputJsonValue;
}

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const pageNumber = Number((body as any)?.pageNumber ?? NaN);
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      throw new ApiError(400, 'INVALID_PAGE_NUMBER', 'pageNumber must be a positive integer.');
    }

    await createPlanSourceAnnotation({
      planSourceId: context.params.id,
      reviewer: { userId: user.id, email: user.email },
      pageNumber: Math.floor(pageNumber),
      annotationType: parseAnnotationType((body as any)?.annotationType),
      label: typeof (body as any)?.label === 'string' ? (body as any).label : null,
      note: typeof (body as any)?.note === 'string' ? (body as any).note : null,
      bboxJson: parseBBox((body as any)?.bbox),
    });

    return success(await getParserStudioSourceDetail(context.params.id));
  } catch (error) {
    return handleError(error);
  }
}
