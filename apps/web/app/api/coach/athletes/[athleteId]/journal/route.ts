import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { failure, handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'entryDate must be YYYY-MM-DD').optional(),
  body: z.string().min(1, 'body is required'),
});

export async function GET(request: NextRequest, { params }: { params: { athleteId: string } }) {
  try {
    const { user } = await requireCoach();
    const { athleteId } = params;

    // Verify coach owns this athlete
    const athlete = await prisma.athleteProfile.findUnique({
      where: {
        userId: athleteId,
        coachId: user.id,
      },
    });

    if (!athlete) {
      throw new ApiError(404, 'ATHLETE_NOT_FOUND', 'Athlete not found or not accessible');
    }

    // Fetch journal entries
    const entries = await prisma.coachJournalEntry.findMany({
      where: {
        coachId: user.id,
        athleteId,
      },
      orderBy: [
        { entryDate: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        entryDate: true,
        body: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return success({ entries });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { athleteId: string } }) {
  try {
    const { user } = await requireCoach();
    const { athleteId } = params;

    // Verify coach owns this athlete
    const athlete = await prisma.athleteProfile.findUnique({
      where: {
        userId: athleteId,
        coachId: user.id,
      },
    });

    if (!athlete) {
      throw new ApiError(404, 'ATHLETE_NOT_FOUND', 'Athlete not found or not accessible');
    }

    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', JSON.stringify(parsed.error.format()));
    }

    const { entryDate, body: entryBody } = parsed.data;

    // Default to today if entryDate not provided
    const dateToUse = entryDate ? new Date(entryDate + 'T00:00:00.000Z') : new Date();
    dateToUse.setUTCHours(0, 0, 0, 0);

    const entry = await prisma.coachJournalEntry.create({
      data: {
        coachId: user.id,
        athleteId,
        entryDate: dateToUse,
        body: entryBody,
      },
      select: {
        id: true,
        entryDate: true,
        body: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return success({ entry });
  } catch (error) {
    return handleError(error);
  }
}
