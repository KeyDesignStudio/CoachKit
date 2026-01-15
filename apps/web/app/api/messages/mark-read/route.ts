import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { forbidden, notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  threadId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = payloadSchema.parse(await request.json());

    const thread = await prisma.messageThread.findUnique({
      where: { id: payload.threadId },
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

    const now = new Date();

    const result =
      user.role === 'COACH'
        ? await prisma.message.updateMany({
            where: {
              threadId: thread.id,
              senderRole: 'ATHLETE',
              deletedAt: null,
              coachReadAt: null,
            },
            data: { coachReadAt: now },
          })
        : await prisma.message.updateMany({
            where: {
              threadId: thread.id,
              senderRole: 'COACH',
              deletedAt: null,
              athleteReadAt: null,
            },
            data: { athleteReadAt: now },
          });

    return success({ updated: result.count });
  } catch (error) {
    return handleError(error);
  }
}
