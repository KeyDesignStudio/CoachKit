import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const disciplineSchema = z.string().trim().min(1).max(32);

const querySchema = z.object({
  discipline: disciplineSchema.optional(),
});

const createSchema = z.object({
  discipline: disciplineSchema,
  title: z.string().trim().min(1).max(160),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach(request);
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      discipline: searchParams.get('discipline') ?? undefined,
    });

    const where = {
      coachId: user.id,
      isArchived: false,
      ...(params.discipline ? { discipline: params.discipline.trim().toUpperCase() } : {}),
    };

    const titles = await prisma.workoutTitle.findMany({
      where,
      orderBy: [{ discipline: 'asc' }, { title: 'asc' }],
    });

    return success({ titles });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach(request);
    const payload = createSchema.parse(await request.json());

    const discipline = payload.discipline.trim().toUpperCase();
    const title = payload.title.trim();

    const created = await prisma.workoutTitle.create({
      data: {
        coachId: user.id,
        discipline,
        title,
      },
    });

    return success({ title: created }, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return handleError(new ApiError(409, 'TITLE_EXISTS', 'A title with that discipline already exists.'));
    }

    return handleError(error);
  }
}
