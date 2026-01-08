import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

export async function POST(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireCoach(request);

    const existing = await prisma.calendarItem.findFirst({
      where: { id: context.params.itemId, coachId: user.id },
      include: includeRefs,
    });

    if (!existing) {
      throw notFound('Calendar item not found.');
    }

    if (existing.reviewedAt) {
      return success({ item: existing });
    }

    const updated = await prisma.calendarItem.update({
      where: { id: existing.id },
      data: { reviewedAt: new Date() },
      include: includeRefs,
    });

    return success({ item: updated });
  } catch (error) {
    return handleError(error);
  }
}
