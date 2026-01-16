import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireCoach();
    const librarySessionId = context.params.id;

    const exists = await prisma.workoutLibrarySession.findUnique({
      where: { id: librarySessionId },
      select: { id: true },
    });

    if (!exists) {
      throw notFound('Library session not found.');
    }

    await prisma.workoutLibraryFavorite.upsert({
      where: {
        coachId_librarySessionId: {
          coachId: user.id,
          librarySessionId,
        },
      },
      update: {},
      create: {
        coachId: user.id,
        librarySessionId,
      },
    });

    return success({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireCoach();
    const librarySessionId = context.params.id;

    await prisma.workoutLibraryFavorite.deleteMany({
      where: {
        coachId: user.id,
        librarySessionId,
      },
    });

    return success({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
