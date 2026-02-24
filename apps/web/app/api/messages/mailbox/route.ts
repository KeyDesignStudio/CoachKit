import { NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(20).max(400).optional(),
});

type MailboxItem = {
  id: string;
  threadId: string;
  createdAt: string;
  direction: 'INBOX' | 'SENT';
  subject: string;
  body: string;
  counterpartName: string;
  counterpartId: string;
};

function parseSubject(body: string) {
  const raw = String(body ?? '');
  const match = raw.match(/^Subject:\s*(.+)\n\n([\s\S]*)$/i);
  if (!match) return { subject: '', body: raw };
  return { subject: String(match[1] ?? '').trim(), body: String(match[2] ?? '').trim() };
}

function itemFromMessage(params: {
  id: string;
  threadId: string;
  createdAt: Date;
  senderUserId: string;
  body: string;
  currentUserId: string;
  counterpartName: string;
  counterpartId: string;
}): MailboxItem {
  const parsed = parseSubject(params.body);
  return {
    id: params.id,
    threadId: params.threadId,
    createdAt: params.createdAt.toISOString(),
    direction: params.senderUserId === params.currentUserId ? 'SENT' : 'INBOX',
    subject: parsed.subject,
    body: parsed.body,
    counterpartName: params.counterpartName,
    counterpartId: params.counterpartId,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const take = parsed.limit ?? 200;

    if (user.role === 'COACH') {
      const rows = await prisma.message.findMany({
        where: {
          deletedAt: null,
          thread: { coachId: user.id },
        },
        orderBy: [{ createdAt: 'desc' }],
        take,
        select: {
          id: true,
          threadId: true,
          senderUserId: true,
          body: true,
          createdAt: true,
          thread: {
            select: {
              athleteId: true,
              athlete: { select: { name: true } },
            },
          },
        },
      });

      const items = rows.map((row) =>
        itemFromMessage({
          id: row.id,
          threadId: row.threadId,
          createdAt: row.createdAt,
          senderUserId: row.senderUserId,
          body: row.body,
          currentUserId: user.id,
          counterpartId: row.thread.athleteId,
          counterpartName: String(row.thread.athlete.name ?? 'Athlete'),
        })
      );

      return success({ items });
    }

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!athleteProfile) {
      return success({ items: [] });
    }

    const rows = await prisma.message.findMany({
      where: {
        deletedAt: null,
        thread: { coachId: athleteProfile.coachId },
        OR: [{ thread: { athleteId: user.id } }, { senderUserId: user.id }],
      },
      orderBy: [{ createdAt: 'desc' }],
      take,
      select: {
        id: true,
        threadId: true,
        senderUserId: true,
        body: true,
        createdAt: true,
        sender: { select: { name: true } },
        thread: {
          select: {
            coachId: true,
            athleteId: true,
            coach: { select: { name: true } },
            athlete: { select: { name: true } },
          },
        },
      },
    });

    const items = rows.map((row) => {
      const isSent = row.senderUserId === user.id;
      const counterpartIsCoach = row.thread.athleteId === user.id || (!isSent && row.senderUserId === row.thread.coachId);
      const counterpartId = counterpartIsCoach ? row.thread.coachId : row.thread.athleteId;
      const counterpartName = counterpartIsCoach
        ? String(row.thread.coach.name ?? 'Coach')
        : String(row.thread.athlete.name ?? row.sender.name ?? 'Squad member');

      return itemFromMessage({
        id: row.id,
        threadId: row.threadId,
        createdAt: row.createdAt,
        senderUserId: row.senderUserId,
        body: row.body,
        currentUserId: user.id,
        counterpartId,
        counterpartName,
      });
    });

    return success({ items });
  } catch (error) {
    return handleError(error);
  }
}

