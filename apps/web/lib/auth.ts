import { NextRequest } from 'next/server';
import { UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError, forbidden, notFound, unauthorized } from '@/lib/errors';

const USER_ID_HEADER = 'x-user-id';

type AuthenticatedContext = {
  user: {
    id: string;
    role: UserRole;
    email: string;
    name: string | null;
    timezone: string;
  };
};

export async function requireAuth(request: NextRequest): Promise<AuthenticatedContext> {
  const userId = request.headers.get(USER_ID_HEADER);

  if (!userId) {
    throw unauthorized('Missing authentication header.');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw unauthorized('User session is invalid.');
  }

  return { user };
}

export async function requireCoach(request: NextRequest) {
  const context = await requireAuth(request);

  if (context.user.role !== UserRole.COACH) {
    throw forbidden('Coach access required.');
  }

  return context;
}

export async function requireAthlete(request: NextRequest) {
  const context = await requireAuth(request);

  if (context.user.role !== UserRole.ATHLETE) {
    throw forbidden('Athlete access required.');
  }

  return context;
}

export async function assertCoachOwnsAthlete(athleteId: string, coachId: string) {
  if (!athleteId) {
    throw new ApiError(400, 'INVALID_ATHLETE_ID', 'athleteId is required.');
  }

  const athlete = await prisma.athleteProfile.findFirst({
    where: { userId: athleteId, coachId },
    include: {
      user: true,
    },
  });

  if (!athlete) {
    throw notFound('Athlete not found for this coach.');
  }

  return athlete;
}
