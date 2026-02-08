import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { assertCoachOwnsAthlete, requireAuth } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { syncStravaForConnections, type StravaConnectionEntry } from '@/lib/strava-sync';

export const dynamic = 'force-dynamic';

function emptySummary() {
  return {
    polledAthletes: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    matched: 0,
    createdCalendarItems: 0,
    calendarItemsCreated: 0,
    calendarItemsUpdated: 0,
    plannedSessionsMatched: 0,
    skippedExisting: 0,
    errors: [],
  };
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();

    const url = new URL(request.url);
    const requestedAthleteId = url.searchParams.get('athleteId');

    const forceDaysParam = url.searchParams.get('forceDays');
    const requestedForceDays = forceDaysParam ? Number(forceDaysParam) : null;
    const forceDays =
      requestedForceDays && Number.isFinite(requestedForceDays)
        ? Math.min(30, Math.max(1, Math.floor(requestedForceDays)))
        : null;

    let connections: StravaConnectionEntry[] = [];

    if (user.role === UserRole.ATHLETE) {
      const [connection, athleteProfile] = await Promise.all([
        prisma.stravaConnection.findUnique({ where: { athleteId: user.id } }),
        prisma.athleteProfile.findUnique({ where: { userId: user.id }, select: { coachId: true } }),
      ]);

      if (!connection) {
        return success(emptySummary());
      }

      if (!athleteProfile) {
        throw new ApiError(500, 'ATHLETE_PROFILE_MISSING', 'Athlete profile missing for Strava poll.');
      }

      connections = [
        {
          athleteId: user.id,
          athleteTimezone: user.timezone,
          coachId: athleteProfile.coachId,
          connection,
        },
      ];
    } else if (user.role === UserRole.COACH) {
      if (requestedAthleteId) {
        const athlete = await assertCoachOwnsAthlete(requestedAthleteId, user.id);
        const connection = await prisma.stravaConnection.findUnique({
          where: { athleteId: athlete.userId },
        });

        if (!connection) {
          return success(emptySummary());
        }

        connections = [
          {
            athleteId: athlete.userId,
            athleteTimezone: athlete.user.timezone,
            coachId: user.id,
            connection,
          },
        ];
      } else {
        const athletes = await prisma.athleteProfile.findMany({
          where: {
            coachId: user.id,
            stravaConnection: { isNot: null },
          },
          select: {
            userId: true,
            coachId: true,
            user: { select: { timezone: true } },
            stravaConnection: true,
          },
        });

        connections = athletes
          .filter((a) => Boolean(a.stravaConnection))
          .map((a) => ({
            athleteId: a.userId,
            athleteTimezone: a.user.timezone,
            coachId: a.coachId,
            connection: a.stravaConnection as any,
          }));
      }
    } else {
      throw new ApiError(403, 'FORBIDDEN', 'Access denied.');
    }

    const summary = await syncStravaForConnections(connections, { forceDays, deep: true });
    return success(summary);
  } catch (error) {
    return handleError(error);
  }

}
