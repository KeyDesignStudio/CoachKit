import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { TrainingPlanFrequency, UserRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

const createAthleteSchema = z
  .object({
    email: z.string().email(),
    name: z.string().trim().min(1),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1),
    disciplines: z.array(z.string().trim().min(1)).min(1),
    primaryGoal: z.string().trim().max(2000).optional(),
    focus: z.string().trim().max(2000).optional(),
    timelineWeeks: z.number().int().min(1).max(104).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD').nullable().optional(),
    trainingPlanSchedule: z
      .object({
        frequency: z.nativeEnum(TrainingPlanFrequency),
        dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
        weekOfMonth: z.number().int().min(1).max(4).nullable().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.trainingPlanSchedule === undefined || data.trainingPlanSchedule === null) return;

    const freq = data.trainingPlanSchedule.frequency;
    const day = data.trainingPlanSchedule.dayOfWeek ?? null;
    const week = data.trainingPlanSchedule.weekOfMonth ?? null;

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

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();

    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId: user.id },
      include: { user: true },
      orderBy: { user: { createdAt: 'asc' } },
    });

    return success(
      { athletes },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 60, staleWhileRevalidateSeconds: 120 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const payload = createAthleteSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: payload.email } });

      if (existing) {
        throw new ApiError(409, 'EMAIL_IN_USE', 'Email is already registered.');
      }

      const athleteUser = await tx.user.create({
        data: {
          email: payload.email,
          name: payload.name,
          role: UserRole.ATHLETE,
          timezone: payload.timezone,
        },
      });

      const [defaultFirst, ...defaultRest] = payload.name.split(' ').filter(Boolean);
      const firstName = payload.firstName ?? defaultFirst ?? null;
      const lastName = payload.lastName ?? defaultRest.join(' ') ?? null;

      return tx.athleteProfile.create({
        data: {
          userId: athleteUser.id,
          coachId: user.id,
          disciplines: payload.disciplines,
          firstName,
          lastName,
          timezone: payload.timezone,
          email: payload.email,
          dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth + 'T00:00:00.000Z') : null,
          primaryGoal: payload.primaryGoal ?? null,
          focus: payload.focus ?? null,
          timelineWeeks: payload.timelineWeeks ?? null,
          trainingPlanSchedule: (payload.trainingPlanSchedule ?? null) as Prisma.InputJsonValue,
        },
        include: { user: true },
      });
    });

    return success({ athlete: result }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
