import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { TIMEZONE_VALUES } from '@/lib/timezones';

export const dynamic = 'force-dynamic';

const schema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1, 'timezone is required.')
    .refine((tz) => TIMEZONE_VALUES.has(tz), {
      message: 'timezone must be one of the supported values.',
    }),
});

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = schema.parse(await request.json());

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { timezone: payload.timezone },
      select: { id: true, timezone: true },
    });

    return success({ user: updated });
  } catch (error) {
    return handleError(error);
  }
}
