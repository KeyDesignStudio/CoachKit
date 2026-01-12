import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { TrainingPlanFrequency } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCoachOwnsAthlete, requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';

const updateAthleteSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    disciplines: z.array(z.string().trim().min(1)).min(1).optional(),
    goalsText: z.string().trim().max(2000).nullable().optional(),
    coachNotes: z.string().trim().max(2000).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD').nullable().optional(),
    zonesJson: z.unknown().optional(),
    trainingPlanFrequency: z.nativeEnum(TrainingPlanFrequency).optional(),
    trainingPlanDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    trainingPlanWeekOfMonth: z.number().int().min(1).max(4).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.trainingPlanFrequency === undefined) return;

    const freq = data.trainingPlanFrequency;
    const day = data.trainingPlanDayOfWeek ?? null;
    const week = data.trainingPlanWeekOfMonth ?? null;

    if (freq === TrainingPlanFrequency.AD_HOC) {
      if (day !== null || week !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AD_HOC training plan must not specify day/week.' });
      }
      return;
    }

    if (freq === TrainingPlanFrequency.WEEKLY || freq === TrainingPlanFrequency.FORTNIGHTLY) {
      if (day === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Weekly/Fortnightly training plan requires day of week.' });
      }
      if (week !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Weekly/Fortnightly training plan must not specify week of month.',
        });
      }
      return;
    }

    if (freq === TrainingPlanFrequency.MONTHLY) {
      if (day === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Monthly training plan requires day of week.' });
      }
      if (week === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Monthly training plan requires week of month.' });
      }
    }
  });

export async function GET(
  request: NextRequest,
  context: { params: { athleteId: string } }
) {
  try {
    const { user } = await requireCoach();
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
    const { user } = await requireCoach();
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

    if (payload.trainingPlanFrequency !== undefined) {
      profileData.trainingPlanFrequency = payload.trainingPlanFrequency;
      // NOTE: The legacy schedule field is intentionally not updated by this endpoint.

      // Normalize dependent fields based on frequency
      if (payload.trainingPlanFrequency === TrainingPlanFrequency.AD_HOC) {
        profileData.trainingPlanDayOfWeek = null;
        profileData.trainingPlanWeekOfMonth = null;
      } else if (
        payload.trainingPlanFrequency === TrainingPlanFrequency.WEEKLY ||
        payload.trainingPlanFrequency === TrainingPlanFrequency.FORTNIGHTLY
      ) {
        profileData.trainingPlanDayOfWeek = payload.trainingPlanDayOfWeek ?? null;
        profileData.trainingPlanWeekOfMonth = null;
      } else if (payload.trainingPlanFrequency === TrainingPlanFrequency.MONTHLY) {
        profileData.trainingPlanDayOfWeek = payload.trainingPlanDayOfWeek ?? null;
        profileData.trainingPlanWeekOfMonth = payload.trainingPlanWeekOfMonth ?? null;
      }
    } else {
      // Allow partial updates if the UI sends these without changing frequency.
      if (payload.trainingPlanDayOfWeek !== undefined) {
        profileData.trainingPlanDayOfWeek = payload.trainingPlanDayOfWeek;
      }
      if (payload.trainingPlanWeekOfMonth !== undefined) {
        profileData.trainingPlanWeekOfMonth = payload.trainingPlanWeekOfMonth;
      }
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
