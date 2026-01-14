import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { notFound } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  threadId: z.string().min(1),
  upToMessageId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = payloadSchema.parse(await request.json());

    const thread = await prisma.messageThread.findUnique({
      where: { id: payload.threadId },
      select: { id: true, coachId: true },
    });

    if (!thread || thread.coachId !== user.id) {
      throw notFound('Thread not found.');
    }

    let cutoff: Date | null = null;
    if (payload.upToMessageId) {
      const msg = await prisma.message.findFirst({
        where: { id: payload.upToMessageId, threadId: thread.id },
        select: { createdAt: true },
      });
      cutoff = msg?.createdAt ?? null;
    }

    const now = new Date();

    const result = await prisma.message.updateMany({
      where: {
        threadId: thread.id,
        senderRole: 'ATHLETE',
        coachReviewedAt: null,
        ...(cutoff ? { createdAt: { lte: cutoff } } : {}),
      },
      data: { coachReviewedAt: now },
    });

    return success({ updated: result.count });
  } catch (error) {
    return handleError(error);
  }
}
