import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  displayName: z.string().trim().min(1, 'displayName is required.').max(120).optional(),
  logoUrl: z
    .union([
      z.string().trim().min(1).max(1024),
      z.literal(''),
      z.null(),
    ])
    .optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireCoach(request);
    const payload = updateSchema.parse(await request.json());

    const displayName = payload.displayName?.trim();
    const rawLogoValue = payload.logoUrl;
    const normalizedLogo = rawLogoValue === '' || rawLogoValue === null ? null : rawLogoValue;

    const updated = await prisma.coachBranding.upsert({
      where: { coachId: user.id },
      update: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(rawLogoValue !== undefined ? { logoUrl: normalizedLogo } : {}),
      },
      create: {
        coachId: user.id,
        displayName: displayName ?? DEFAULT_BRAND_NAME,
        logoUrl: normalizedLogo ?? null,
      },
      select: {
        coachId: true,
        displayName: true,
        logoUrl: true,
      },
    });

    return success({ branding: updated });
  } catch (error) {
    return handleError(error);
  }
}
