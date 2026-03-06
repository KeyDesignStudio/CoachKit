import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { updatePlanSourceSessionTemplate } from '@/modules/plan-library/server/parser-studio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseNullableInteger(value: unknown, field: string) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, 'INVALID_INTEGER', `${field} must be a number.`);
  }
  return Math.round(parsed);
}

function parseNullableFloat(value: unknown, field: string) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, 'INVALID_FLOAT', `${field} must be a number.`);
  }
  return parsed;
}

function parseDiscipline(value: unknown) {
  if (value === 'SWIM' || value === 'BIKE' || value === 'RUN' || value === 'STRENGTH' || value === 'REST') {
    return value;
  }
  throw new ApiError(400, 'INVALID_DISCIPLINE', 'discipline must be SWIM, BIKE, RUN, STRENGTH, or REST.');
}

export async function PATCH(request: NextRequest, context: { params: { id: string; sessionId: string } }) {
  try {
    const { user } = await requireAdmin();
    const body = await request.json().catch(() => ({}));

    const data = await updatePlanSourceSessionTemplate({
      planSourceId: context.params.id,
      sessionId: context.params.sessionId,
      reviewer: { userId: user.id, email: user.email },
      data: {
        dayOfWeek: parseNullableInteger((body as any)?.dayOfWeek, 'dayOfWeek'),
        discipline: parseDiscipline((body as any)?.discipline),
        sessionType: String((body as any)?.sessionType ?? '').trim() || 'endurance',
        title: typeof (body as any)?.title === 'string' ? (body as any).title : null,
        durationMinutes: parseNullableInteger((body as any)?.durationMinutes, 'durationMinutes'),
        distanceKm: parseNullableFloat((body as any)?.distanceKm, 'distanceKm'),
        notes: typeof (body as any)?.notes === 'string' ? (body as any).notes : null,
      },
    });

    return success(data);
  } catch (error) {
    return handleError(error);
  }
}
