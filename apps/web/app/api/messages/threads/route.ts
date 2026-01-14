import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

function preview(body: string): string {
  const text = (body ?? '').trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137)}…`;
}

const querySchema = z.object({
  // Reserved for future pagination.
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));

    if (user.role === 'COACH') {
      const [threads, unreadCounts] = await Promise.all([
        prisma.messageThread.findMany({
          where: { coachId: user.id },
          select: {
            id: true,
            athlete: { select: { id: true, name: true } },
            messages: {
              orderBy: [{ createdAt: 'desc' as const }],
              take: 1,
              select: { body: true, createdAt: true },
            },
          },
        }),
        prisma.message.groupBy({
          by: ['threadId'],
          where: {
            thread: { coachId: user.id },
            coachReadAt: null,
            senderRole: 'ATHLETE',
          },
          _count: { _all: true },
        }),
      ]);

      const unreadMap = new Map<string, number>();
      unreadCounts.forEach((r) => unreadMap.set(r.threadId, r._count._all));

      const formatted = threads
        .map((t) => {
          const last = t.messages[0] ?? null;
          return {
            threadId: t.id,
            athlete: t.athlete,
            lastMessagePreview: last ? preview(last.body) : '',
            lastMessageAt: last ? last.createdAt.toISOString() : null,
            unreadCountForCoach: unreadMap.get(t.id) ?? 0,
          };
        })
        .sort((a, b) => {
          const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bt - at;
        });

      return success(formatted, { headers: privateCacheHeaders({ maxAgeSeconds: 30 }) });
    }

    // ATHLETE: single thread (if exists) between athlete and their coach.
    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!athleteProfile) {
      return success([], { headers: privateCacheHeaders({ maxAgeSeconds: 30 }) });
    }

    const thread = await prisma.messageThread.findUnique({
      where: { coachId_athleteId: { coachId: athleteProfile.coachId, athleteId: user.id } },
      select: {
        id: true,
        coachId: true,
        athleteId: true,
        messages: {
          orderBy: [{ createdAt: 'desc' as const }],
          take: 1,
          select: { body: true, createdAt: true },
        },
      },
    });

    if (!thread) {
      return success([], { headers: privateCacheHeaders({ maxAgeSeconds: 30 }) });
    }

    const last = thread.messages[0] ?? null;

    return success(
      [
        {
          threadId: thread.id,
          lastMessagePreview: last ? preview(last.body) : '',
          lastMessageAt: last ? last.createdAt.toISOString() : null,
        },
      ],
      { headers: privateCacheHeaders({ maxAgeSeconds: 30 }) }
    );
  } catch (error) {
    return handleError(error);
  }
}
