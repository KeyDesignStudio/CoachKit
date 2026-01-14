import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { threadId: string } }) {
  try {
    const { user } = await requireAuth();
    const threadId = context.params.threadId;

    const thread = await prisma.messageThread.findUnique({
      where: { id: threadId },
      select: { id: true, coachId: true, athleteId: true },
    });

    if (!thread) {
      throw notFound('Thread not found.');
    }

    if (user.role === 'COACH' && thread.coachId !== user.id) {
      throw forbidden('Not authorized to access this thread.');
    }

    if (user.role === 'ATHLETE' && thread.athleteId !== user.id) {
      throw forbidden('Not authorized to access this thread.');
    }

    const messagesDesc = await prisma.message.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        body: true,
        createdAt: true,
        senderRole: true,
        senderUserId: true,
      },
    });

    const messages = messagesDesc
      .slice()
      .reverse()
      .map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        senderRole: m.senderRole,
        senderUserId: m.senderUserId,
      }));

    return success({ threadId: thread.id, messages }, { headers: privateCacheHeaders({ maxAgeSeconds: 30 }) });
  } catch (error) {
    return handleError(error);
  }
}
