import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { forbidden } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const payload = payloadSchema.parse(await request.json());

    const messageIds = Array.from(new Set(payload.messageIds.map((id) => id.trim()).filter(Boolean)));
    if (messageIds.length === 0) return success({ deleted: 0 });

    const msgs = await prisma.message.findMany({
      where: { id: { in: messageIds } },
      select: { id: true, thread: { select: { coachId: true, athleteId: true } } },
    });

    const foundIds = new Set(msgs.map((m) => m.id));
    const missing = messageIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      // Keep errors generic; do not leak existence.
      throw forbidden('One or more messages are not available for this user.');
    }

    const allParticipant = msgs.every((m) => m.thread.coachId === user.id || m.thread.athleteId === user.id);
    if (!allParticipant) {
      throw forbidden('One or more messages are not available for this user.');
    }

    const result = await prisma.message.updateMany({
      where: { id: { in: messageIds }, deletedAt: null },
      data: { deletedAt: new Date(), deletedByUserId: user.id },
    });

    return success({ deleted: result.count });
  } catch (error) {
    return handleError(error);
  }
}
