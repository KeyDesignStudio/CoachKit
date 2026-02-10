import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { TrainingPlanFrequency } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { handleError, success } from '@/lib/http';
import { normalizeAustralianMobile } from '@/modules/athlete-intake/validation';
import { ensureAthleteBrief } from '@/modules/ai-plan-builder/server/athlete-brief';


const updateAthleteSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    disciplines: z.array(z.string().trim().min(1)).min(1).optional(),
    primaryGoal: z.string().trim().max(2000).nullable().optional(),
    gender: z.string().trim().max(2000).nullable().optional(),
    trainingSuburb: z.string().trim().max(2000).nullable().optional(),
    mobilePhone: z.string().trim().max(2000).nullable().optional(),
    secondaryGoals: z.array(z.string().trim().min(1)).optional(),
    focus: z.string().trim().max(2000).nullable().optional(),
    eventName: z.string().trim().max(2000).nullable().optional(),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be YYYY-MM-DD').nullable().optional(),
    timelineWeeks: z.number().int().min(1).max(104).nullable().optional(),
    experienceLevel: z.string().trim().max(2000).nullable().optional(),
    weeklyMinutesTarget: z.number().int().min(0).max(1500).nullable().optional(),
    consistencyLevel: z.string().trim().max(2000).nullable().optional(),
    swimConfidence: z.number().int().min(1).max(5).nullable().optional(),
    bikeConfidence: z.number().int().min(1).max(5).nullable().optional(),
    runConfidence: z.number().int().min(1).max(5).nullable().optional(),
    availableDays: z.array(z.string().trim().min(1)).optional(),
    scheduleVariability: z.string().trim().max(2000).nullable().optional(),
    sleepQuality: z.string().trim().max(2000).nullable().optional(),
    equipmentAccess: z.string().trim().max(2000).nullable().optional(),
    travelConstraints: z.string().trim().max(2000).nullable().optional(),
    injuryStatus: z.string().trim().max(2000).nullable().optional(),
    constraintsNotes: z.string().trim().max(2000).nullable().optional(),
    feedbackStyle: z.string().trim().max(2000).nullable().optional(),
    tonePreference: z.string().trim().max(2000).nullable().optional(),
    checkInCadence: z.string().trim().max(2000).nullable().optional(),
    structurePreference: z.number().int().min(1).max(5).nullable().optional(),
    motivationStyle: z.string().trim().max(2000).nullable().optional(),
    trainingPlanSchedule: z
      .object({
        frequency: z.nativeEnum(TrainingPlanFrequency),
        dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
        weekOfMonth: z.number().int().min(1).max(4).nullable().optional(),
      })
      .nullable()
      .optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD').nullable().optional(),
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

export async function GET() {
  try {
    const { user } = await requireAthlete();
    const athlete = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });

    if (!athlete) {
      throw new ApiError(404, 'ATHLETE_PROFILE_REQUIRED', 'Athlete profile not found.');
    }

    return success({ athlete });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const athlete = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });

    if (!athlete) {
      throw new ApiError(404, 'ATHLETE_PROFILE_REQUIRED', 'Athlete profile not found.');
    }

    const payload = updateAthleteSchema.parse(await request.json());

    const hasUpdates = Object.values(payload).some((value) => value !== undefined);
    if (!hasUpdates) {
      throw new ApiError(400, 'NO_FIELDS_PROVIDED', 'At least one field must be provided.');
    }

    if (payload.timezone === undefined) {
      throw new ApiError(400, 'TIMEZONE_REQUIRED', 'Timezone is required.');
    }

    const userData: Prisma.UserUpdateInput = {};
    const profileData: Prisma.AthleteProfileUpdateInput = {};

    const normalizedName = payload.name?.trim() || null;
    const normalizedFirstName = payload.firstName?.trim() || null;
    const normalizedLastName = payload.lastName?.trim() || null;

    if (normalizedName || normalizedFirstName || normalizedLastName) {
      const existingName = athlete.user?.name ?? '';
      const [existingFirst, ...existingRest] = existingName.split(' ').filter(Boolean);
      const nextFirst = normalizedFirstName ?? (normalizedName ? normalizedName.split(' ')[0] : existingFirst) ?? null;
      const nextLast =
        normalizedLastName ?? (normalizedName ? normalizedName.split(' ').slice(1).join(' ') : existingRest.join(' ')) ?? null;

      profileData.firstName = nextFirst;
      profileData.lastName = nextLast || null;
      userData.name = [nextFirst, nextLast].filter(Boolean).join(' ') || null;
    }

    if (payload.timezone) {
      userData.timezone = payload.timezone;
      profileData.timezone = payload.timezone;
    }

    if (payload.disciplines) {
      profileData.disciplines = payload.disciplines;
    }

    if (payload.primaryGoal !== undefined) {
      profileData.primaryGoal = payload.primaryGoal;
    }

    if (payload.gender !== undefined) {
      profileData.gender = payload.gender;
    }

    if (payload.trainingSuburb !== undefined) {
      profileData.trainingSuburb = payload.trainingSuburb;
    }

    if (payload.mobilePhone !== undefined) {
      if (payload.mobilePhone === null || payload.mobilePhone.trim() === '') {
        profileData.mobilePhone = null;
      } else {
        const normalized = normalizeAustralianMobile(payload.mobilePhone);
        if (!normalized) {
          throw new ApiError(
            400,
            'INVALID_MOBILE_PHONE',
            'Enter an Australian mobile number, e.g. 04xx xxx xxx or +614xx xxx xxx.'
          );
        }
        profileData.mobilePhone = normalized;
      }
    }

    if (payload.secondaryGoals !== undefined) {
      profileData.secondaryGoals = payload.secondaryGoals;
    }

    if (payload.focus !== undefined) {
      profileData.focus = payload.focus;
    }

    if (payload.eventName !== undefined) {
      profileData.eventName = payload.eventName;
    }

    if (payload.eventDate !== undefined) {
      profileData.eventDate = payload.eventDate ? new Date(payload.eventDate + 'T00:00:00.000Z') : null;
    }

    if (payload.timelineWeeks !== undefined) {
      profileData.timelineWeeks = payload.timelineWeeks;
    }

    if (payload.experienceLevel !== undefined) {
      profileData.experienceLevel = payload.experienceLevel;
    }

    if (payload.weeklyMinutesTarget !== undefined) {
      profileData.weeklyMinutesTarget = payload.weeklyMinutesTarget;
    }

    if (payload.consistencyLevel !== undefined) {
      profileData.consistencyLevel = payload.consistencyLevel;
    }

    if (payload.swimConfidence !== undefined) {
      profileData.swimConfidence = payload.swimConfidence;
    }

    if (payload.bikeConfidence !== undefined) {
      profileData.bikeConfidence = payload.bikeConfidence;
    }

    if (payload.runConfidence !== undefined) {
      profileData.runConfidence = payload.runConfidence;
    }

    if (payload.availableDays !== undefined) {
      profileData.availableDays = payload.availableDays;
    }

    if (payload.scheduleVariability !== undefined) {
      profileData.scheduleVariability = payload.scheduleVariability;
    }

    if (payload.sleepQuality !== undefined) {
      profileData.sleepQuality = payload.sleepQuality;
    }

    if (payload.equipmentAccess !== undefined) {
      profileData.equipmentAccess = payload.equipmentAccess;
    }

    if (payload.travelConstraints !== undefined) {
      profileData.travelConstraints = payload.travelConstraints;
    }

    if (payload.injuryStatus !== undefined) {
      profileData.injuryStatus = payload.injuryStatus;
    }

    if (payload.constraintsNotes !== undefined) {
      profileData.constraintsNotes = payload.constraintsNotes;
    }

    if (payload.feedbackStyle !== undefined) {
      profileData.feedbackStyle = payload.feedbackStyle;
    }

    if (payload.tonePreference !== undefined) {
      profileData.tonePreference = payload.tonePreference;
    }

    if (payload.checkInCadence !== undefined) {
      profileData.checkInCadence = payload.checkInCadence;
    }

    if (payload.structurePreference !== undefined) {
      profileData.structurePreference = payload.structurePreference;
    }

    if (payload.motivationStyle !== undefined) {
      profileData.motivationStyle = payload.motivationStyle;
    }

    if (payload.trainingPlanSchedule !== undefined) {
      profileData.trainingPlanSchedule = payload.trainingPlanSchedule as Prisma.InputJsonValue;
    }

    if (payload.dateOfBirth !== undefined) {
      profileData.dateOfBirth = payload.dateOfBirth ? new Date(payload.dateOfBirth + 'T00:00:00.000Z') : null;
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

    if (updated.coachId) {
      await ensureAthleteBrief({ athleteId: updated.userId, coachId: updated.coachId });
    }

    return success({ athlete: updated });
  } catch (error) {
    return handleError(error);
  }
}
