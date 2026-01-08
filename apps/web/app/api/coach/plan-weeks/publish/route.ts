import { NextRequest } from 'next/server';
import { PlanWeekStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

const publishSchema = z.object({
  athleteId: z.string().min(1),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach(request);
    const payload = publishSchema.parse(await request.json());

    // Verify athlete ownership
    const athlete = await prisma.athleteProfile.findFirst({
      where: { userId: payload.athleteId, coachId: user.id },
    });

    if (!athlete) {
      return handleError(new Error('Athlete not found or not accessible'));
    }

    const weekStartDate = new Date(payload.weekStart + 'T00:00:00Z');

    // Upsert PlanWeek to PUBLISHED
    const planWeek = await prisma.planWeek.upsert({
      where: {
        coachId_athleteId_weekStart: {
          coachId: user.id,
          athleteId: payload.athleteId,
          weekStart: weekStartDate,
        },
      },
      create: {
        coachId: user.id,
        athleteId: payload.athleteId,
        weekStart: weekStartDate,
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(),
      },
      update: {
        status: PlanWeekStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    return success({ planWeek });
  } catch (error) {
    return handleError(error);
  }
}
