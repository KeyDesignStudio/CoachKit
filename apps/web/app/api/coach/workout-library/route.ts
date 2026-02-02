import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  discipline: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export async function GET(request: NextRequest) {
  try {
    await requireCoach();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse({
      discipline: searchParams.get('discipline') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    });

    const where = {
      status: 'PUBLISHED' as const,
      ...(params.discipline ? { discipline: params.discipline.trim().toUpperCase() as any } : {}),
    };

    const [total, sessions] = await Promise.all([
      prisma.workoutLibrarySession.count({ where }),
      prisma.workoutLibrarySession.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          title: true,
          discipline: true,
          category: true,
          tags: true,
        },
      }),
    ]);

    return success({
      total,
      page: params.page,
      pageSize: params.pageSize,
      items: sessions,
    });
  } catch (error) {
    return handleError(error, { where: '/api/coach/workout-library' });
  }
}
