import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  titleId: z.string().cuid(),
});

export async function DELETE(
  request: NextRequest,
  context: { params: { titleId: string } }
) {
  try {
    const { user } = await requireCoach(request);
    const params = paramsSchema.parse(context.params);

    const record = await prisma.workoutTitle.findFirst({
      where: { id: params.titleId, coachId: user.id },
    });

    if (!record) {
      throw notFound('Workout title not found.');
    }

    const usageCount = await prisma.calendarItem.count({
      where: {
        coachId: user.id,
        discipline: record.discipline,
        title: record.title,
      },
    });

    if (usageCount > 0) {
      throw new ApiError(409, 'TITLE_IN_USE', 'Cannot delete a title that is used by planned sessions.');
    }

    await prisma.workoutTitle.delete({ where: { id: record.id } });

    return success({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
