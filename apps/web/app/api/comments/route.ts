import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { forbidden, notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  calendarItemId: z.string().cuid(),
  body: z.string().trim().min(1, 'body cannot be empty.'),
});

const querySchema = z.object({
  calendarItemId: z.string().cuid(),
});

const authorSelect = {
  id: true,
  name: true,
  role: true,
};

async function assertCommentAccess(calendarItemId: string, userId: string, role: UserRole) {
  const calendarItem = await prisma.calendarItem.findUnique({
    where: { id: calendarItemId },
    select: { id: true, athleteId: true, coachId: true },
  });

  if (!calendarItem) {
    throw notFound('Calendar item not found.');
  }

  if (role === UserRole.COACH && calendarItem.coachId !== userId) {
    throw forbidden('Coach does not own this calendar item.');
  }

  if (role === UserRole.ATHLETE && calendarItem.athleteId !== userId) {
    throw forbidden('Athlete does not own this calendar item.');
  }

  return calendarItem;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = createSchema.parse(await request.json());

    await assertCommentAccess(payload.calendarItemId, user.id, user.role);

    const comment = await prisma.comment.create({
      data: {
        calendarItemId: payload.calendarItemId,
        body: payload.body,
        authorId: user.id,
      },
      include: {
        author: { select: authorSelect },
      },
    });

    return success({ comment }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      calendarItemId: searchParams.get('calendarItemId'),
    });

    await assertCommentAccess(params.calendarItemId, user.id, user.role);

    const comments = await prisma.comment.findMany({
      where: { calendarItemId: params.calendarItemId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: authorSelect },
      },
    });

    return success({ comments });
  } catch (error) {
    return handleError(error);
  }
}
