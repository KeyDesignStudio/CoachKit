import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

const updateAthleteSchema = z.object({
  name: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  disciplines: z.array(z.string().trim().min(1)).min(1).optional(),
  goalsText: z.string().trim().max(2000).nullable().optional(),
  planCadenceDays: z.number().int().min(1).max(42).optional(),
  coachNotes: z.string().trim().max(2000).nullable().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD').nullable().optional(),
  zonesJson: z.unknown().optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: { athleteId: string } }
) {
  try {
    const { user } = await requireCoach(request);
    const athlete = await assertCoachOwnsAthlete(context.params.athleteId, user.id);

    return success({ athlete });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { athleteId: string } }
) {
  try {
    const { user } = await requireCoach(request);
    const athlete = await assertCoachOwnsAthlete(context.params.athleteId, user.id);
    const payload = updateAthleteSchema.parse(await request.json());

    const hasUpdates = Object.values(payload).some((value) => value !== undefined);

    if (!hasUpdates) {
      throw new ApiError(400, 'NO_FIELDS_PROVIDED', 'At least one field must be provided.');
    }

    const userData: Prisma.UserUpdateInput = {};
    const profileData: Prisma.AthleteProfileUpdateInput = {};

    if (payload.name) {
      userData.name = payload.name;
    }

    if (payload.timezone) {
      userData.timezone = payload.timezone;
    }

    if (payload.disciplines) {
      profileData.disciplines = payload.disciplines;
    }

    if (payload.goalsText !== undefined) {
      profileData.goalsText = payload.goalsText;
    }

    if (payload.planCadenceDays !== undefined) {
      profileData.planCadenceDays = payload.planCadenceDays;
    }

    if (payload.coachNotes !== undefined) {
      profileData.coachNotes = payload.coachNotes;
    }

    if (payload.dateOfBirth !== undefined) {
      profileData.dateOfBirth = payload.dateOfBirth ? new Date(payload.dateOfBirth + 'T00:00:00.000Z') : null;
    }

    if (payload.zonesJson !== undefined) {
      profileData.zonesJson = payload.zonesJson as Prisma.InputJsonValue;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: athlete.userId }, data: userData });
      }

      return tx.athleteProfile.update({
        where: { userId: athlete.userId },
        data: profileData,
        include: { user: true },
      });
    });

    return success({ athlete: updated });
  } catch (error) {
    return handleError(error);
  }
}
