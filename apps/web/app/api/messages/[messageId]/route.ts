import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function DELETE(_request: NextRequest, context: { params: { messageId: string } }) {
  try {
    const { user } = await requireAuth();
    const messageId = context.params.messageId;

    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        threadId: true,
        deletedAt: true,
        thread: { select: { coachId: true, athleteId: true } },
      },
    });

    if (!msg) throw notFound('Message not found.');

    const isParticipant = msg.thread.coachId === user.id || msg.thread.athleteId === user.id;
    if (!isParticipant) throw forbidden('Not authorized to delete this message.');

    if (msg.deletedAt) {
      return success({ ok: true });
    }

    await prisma.message.update({
      where: { id: msg.id },
      data: { deletedAt: new Date(), deletedByUserId: user.id },
      select: { id: true },
    });

    return success({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
