import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAthlete } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { getStravaVitalsComparisonForAthlete } from '@/lib/strava-vitals';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(14).max(365).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  includeLoadModel: z
    .enum(['1', 'true', 'TRUE'])
    .optional()
    .nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const parsed = querySchema.parse({
      windowDays: new URL(request.url).searchParams.get('windowDays') ?? undefined,
      from: new URL(request.url).searchParams.get('from') ?? undefined,
      to: new URL(request.url).searchParams.get('to') ?? undefined,
      includeLoadModel: new URL(request.url).searchParams.get('includeLoadModel') ?? undefined,
    });
    const includeLoadModel = Boolean(parsed.includeLoadModel);
    const from = parsed.from ? parseDateOnly(parsed.from, 'from') : null;
    const to = parsed.to ? parseDateOnly(parsed.to, 'to') : null;
    if ((from && !to) || (!from && to)) {
      throw new Error('Use both from and to for custom date windows.');
    }
    if (from && to) {
      assertValidDateRange(from, to);
    }

    const comparison = await getStravaVitalsComparisonForAthlete(user.id, {
      windowDays: parsed.windowDays,
      from: from ?? undefined,
      to: to ?? undefined,
      includeLoadModel,
    });
    return success({ comparison });
  } catch (error) {
    return handleError(error);
  }
}
