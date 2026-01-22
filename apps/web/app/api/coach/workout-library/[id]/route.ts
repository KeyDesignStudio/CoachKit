import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { notFound } from '@/lib/errors';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const { user } = await requireCoach();
    const id = context.params.id;

    const session = await prisma.workoutLibrarySession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        discipline: true,
        status: true,
        tags: true,
        category: true,
        description: true,
        durationSec: true,
        intensityTarget: true,
        intensityCategory: true,
        distanceMeters: true,
        elevationGainMeters: true,
        notes: true,
        equipment: true,
        workoutStructure: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            usage: true,
          },
        },
      },
    });

    if (!session || session.status !== 'PUBLISHED') {
      throw notFound('Library session not found.');
    }

    const favorite = await prisma.workoutLibraryFavorite.findUnique({
      where: {
        coachId_librarySessionId: {
          coachId: user.id,
          librarySessionId: id,
        },
      },
      select: { id: true },
    });

    return success(
      {
        session: (() => {
          const { _count, ...rest } = session;
          return {
            ...rest,
            usageCount: _count.usage,
          };
        })(),
        favorite: Boolean(favorite),
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
