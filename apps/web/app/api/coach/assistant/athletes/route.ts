import { NextRequest } from 'next/server';

import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest) {
  try {
    const { user } = await requireCoach();

    const athletes = await prisma.athleteProfile.findMany({
      where: {
        coachId: user.id,
      },
      select: {
        userId: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
    });

    return success({
      athletes: athletes.map((row) => ({
        id: row.userId,
        name: row.user.name ?? row.userId,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
