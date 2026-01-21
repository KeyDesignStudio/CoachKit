import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

export const dynamic = 'force-dynamic';

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

    // Fetch all completed activities with pain flag
    const painItems = await prisma.completedActivity.findMany({
      where: {
        athleteId,
        painFlag: true,
        calendarItem: {
          deletedAt: null,
        },
      },
      orderBy: {
        startTime: 'desc',
      },
      include: {
        calendarItem: {
          select: {
            id: true,
            date: true,
            discipline: true,
            title: true,
            comments: {
              where: {
                author: {
                  role: 'ATHLETE',
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
              select: {
                body: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    // Format response
    const history = painItems
      .filter((item) => item.calendarItem !== null)
      .map((item) => ({
        calendarItemId: item.calendarItemId,
        date: item.calendarItem!.date,
        startTime: item.startTime,
        discipline: item.calendarItem!.discipline,
        title: item.calendarItem!.title,
        painFlag: item.painFlag,
        athletePainComment: item.calendarItem!.comments[0]?.body ?? null,
        commentDate: item.calendarItem!.comments[0]?.createdAt ?? null,
      }));

    return success({ history });
  } catch (error) {
    return handleError(error);
  }
}
