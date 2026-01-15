import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function DELETE(_request: NextRequest, context: { params: { threadId: string } }) {
  try {
    const { user } = await requireAuth();
    const threadId = context.params.threadId;

    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { id: true, coachId: true, athleteId: true },
    });

    if (!thread) throw notFound('Thread not found.');

    const isParticipant = thread.coachId === user.id || thread.athleteId === user.id;
    if (!isParticipant) throw forbidden('Not authorized to delete messages in this thread.');

    const result = await prisma.message.updateMany({
      where: { threadId: thread.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedByUserId: user.id },
    });

    return success({ deleted: result.count });
  } catch (error) {
    return handleError(error);
  }
}
