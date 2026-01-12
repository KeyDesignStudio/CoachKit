import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAthlete } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { parseDateOnly } from '@/lib/date';
import { ApiError } from '@/lib/errors';
import { findCoachTemplate } from '@/lib/templates';

export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD.' });
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'plannedStartTimeLocal must be HH:MM (24h).' })
  .optional()
  .or(z.literal(''));
const cuid = z.string().cuid();

const createCalendarItemSchema = z.object({
  date: isoDate,
  plannedStartTimeLocal: localTime,
  discipline: z.string().trim().min(1).optional(),
  subtype: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  plannedDurationMinutes: z.number().int().positive().max(1000).optional(),
  plannedDistanceKm: z.number().nonnegative().max(1000).optional(),
  intensityType: z.string().trim().min(1).optional(),
  intensityTargetJson: z.unknown().optional(),
  notes: z.string().trim().max(4000).optional(),
  attachmentsJson: z.unknown().optional(),
  templateId: cuid.optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAthlete();
    const payload = createCalendarItemSchema.parse(await request.json());

    const athleteProfile = await prisma.athleteProfile.findUnique({
      where: { userId: user.id },
      select: { coachId: true },
    });

    if (!athleteProfile) {
      throw new ApiError(400, 'ATHLETE_PROFILE_REQUIRED', 'Athlete profile not found.');
    }

    const calendarDate = parseDateOnly(payload.date, 'date');
    const template = payload.templateId ? await findCoachTemplate(payload.templateId, athleteProfile.coachId) : null;

    const title = payload.title ?? template?.title;
    const discipline = payload.discipline ?? template?.discipline;
    const subtype = payload.subtype ?? template?.subtype ?? null;

    if (!title) {
      throw new ApiError(400, 'TITLE_REQUIRED', 'title is required when no template title is provided.');
    }

    if (!discipline) {
      throw new ApiError(400, 'DISCIPLINE_REQUIRED', 'discipline is required when no template discipline is provided.');
    }

    const item = await prisma.calendarItem.create({
      data: {
        coach: {
          connect: { id: athleteProfile.coachId },
        },
        athlete: {
          connect: { userId: user.id },
        },
        date: calendarDate,
        plannedStartTimeLocal:
          payload.plannedStartTimeLocal && payload.plannedStartTimeLocal.trim() ? payload.plannedStartTimeLocal : null,
        discipline,
        subtype,
        title,
        plannedDurationMinutes: payload.plannedDurationMinutes ?? null,
        plannedDistanceKm: payload.plannedDistanceKm ?? null,
        intensityType: payload.intensityType ?? null,
        intensityTargetJson: (payload.intensityTargetJson ?? null) as Prisma.InputJsonValue,
        notes: payload.notes ?? null,
        attachmentsJson: (payload.attachmentsJson ?? null) as Prisma.InputJsonValue,
        status: CalendarItemStatus.PLANNED,
        template: template
          ? {
              connect: { id: template.id },
            }
          : undefined,
      },
      include: {
        template: { select: { id: true, title: true } },
        groupSession: { select: { id: true, title: true } },
      },
    });

    return success({ item }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
