import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { DEFAULT_BRANDING } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);

    let coachId: string | null = null;

    if (user.role === 'COACH') {
      coachId = user.id;
    } else {
      const athleteProfile = await prisma.athleteProfile.findUnique({
        where: { userId: user.id },
        select: { coachId: true },
      });
      coachId = athleteProfile?.coachId ?? null;
    }

    if (!coachId) {
      return success({ branding: DEFAULT_BRANDING });
    }

    const branding = await prisma.coachBranding.findUnique({
      where: { coachId },
      select: {
        coachId: true,
        displayName: true,
        logoUrl: true,
      },
    });

    if (!branding) {
      return success({ branding: { ...DEFAULT_BRANDING, coachId } });
    }

    return success({ branding });
  } catch (error) {
    return handleError(error);
  }
}
