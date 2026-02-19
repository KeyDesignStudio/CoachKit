import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { CalendarItemStatus, CompletionSource } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError, notFound } from '@/lib/errors';
import { parseDateOnly } from '@/lib/date';
import { findCoachTemplate } from '@/lib/templates';

import { APB_CALENDAR_ORIGIN, APB_MANUAL_EDIT_TAG, APB_SOURCE_PREFIX } from '@/modules/ai-plan-builder/server/calendar-materialise';

const commentsSelect = {
  select: {
    id: true,
    authorId: true,
    body: true,
    createdAt: true,
    author: {
      select: {
        id: true,
        name: true,
        role: true,
      },
    },
  },
  orderBy: { createdAt: 'desc' as const },
  take: 10,
};

const completedActivitiesSelect = {
  select: {
    id: true,
    durationMinutes: true,
    distanceKm: true,
    rpe: true,
    notes: true,
    painFlag: true,
    source: true,
    confirmedAt: true,
    metricsJson: true,
    startTime: true,
  },
  orderBy: { startTime: 'desc' as const },
  take: 5,
};

function mergeLatestCompletion(completions: Array<Record<string, any>>) {
  const latestManual = completions.find((c) => c?.source === CompletionSource.MANUAL) ?? null;
  const latestStrava = completions.find((c) => c?.source === CompletionSource.STRAVA) ?? null;

  if (!latestManual && !latestStrava) return null;

  const metricsCompletion = (latestStrava ?? latestManual)!;

  return {
    id: metricsCompletion.id,
    source: latestStrava?.source ?? latestManual?.source,
    confirmedAt: latestStrava?.confirmedAt ?? latestManual?.confirmedAt ?? null,
    startTime: latestStrava?.startTime ?? latestManual?.startTime,
    durationMinutes: latestStrava?.durationMinutes ?? latestManual?.durationMinutes ?? null,
    distanceKm: latestStrava?.distanceKm ?? latestManual?.distanceKm ?? null,
    rpe: latestManual?.rpe ?? latestStrava?.rpe ?? null,
    notes: latestManual?.notes ?? latestStrava?.notes ?? null,
    painFlag: Boolean(latestManual?.painFlag ?? latestStrava?.painFlag ?? false),
    metricsJson:
      latestStrava?.metricsJson && latestManual?.metricsJson
        ? { ...latestManual.metricsJson, strava: latestStrava.metricsJson?.strava ?? latestManual.metricsJson?.strava }
        : latestStrava?.metricsJson ?? latestManual?.metricsJson ?? null,
  };
}

function getEffectiveActualStartUtc(completion: {
  source: CompletionSource | string;
  startTime: Date;
  metricsJson?: any;
}): Date {
  if (completion.source === CompletionSource.STRAVA) {
    const candidate = completion.metricsJson?.strava?.startDateUtc;
    const parsed = candidate ? new Date(candidate) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  }

  return completion.startTime;
}

export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD.' });
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'plannedStartTimeLocal must be HH:MM (24h).' });
const idSchema = z.string().cuid().or(z.string().cuid2());

const updateSchema = z.object({
  date: isoDate.optional(),
  plannedStartTimeLocal: z.union([localTime, z.null()]).optional(),
  discipline: z.string().trim().min(1).optional(),
  subtype: z.union([z.string().trim().min(1), z.null()]).optional(),
  title: z.string().trim().min(1).optional(),
  plannedDurationMinutes: z.union([z.number().int().positive().max(1000), z.null()]).optional(),
  plannedDistanceKm: z.union([z.number().nonnegative().max(1000), z.null()]).optional(),
  distanceMeters: z.union([z.number().positive(), z.null()]).optional(),
  intensityTarget: z.union([z.string().trim().min(1), z.null()]).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  equipment: z.array(z.string().trim().min(1)).optional(),
  workoutStructure: z.unknown().optional().nullable(),
  notes: z.union([z.string().trim().max(20000), z.null()]).optional(),
  intensityType: z.union([z.string().trim().min(1), z.null()]).optional(),
  intensityTargetJson: z.unknown().optional(),
  workoutDetail: z.union([z.string().trim().max(20000), z.null()]).optional(),
  attachmentsJson: z.unknown().optional(),
  status: z.nativeEnum(CalendarItemStatus).optional(),
  planningStatus: z.union([z.literal('UNPLANNED'), z.literal('PUBLISHED'), z.literal('DRAFT'), z.null()]).optional(),
  templateId: z.union([idSchema, z.null()]).optional(),
});

const includeRefs = {
  template: { select: { id: true, title: true } },
  groupSession: { select: { id: true, title: true } },
};

async function ensureCalendarItem(itemId: string, coachId: string) {
  const item = await prisma.calendarItem.findFirst({
    where: { id: itemId, coachId, deletedAt: null },
    include: includeRefs,
  });

  if (!item) {
    throw notFound('Calendar item not found.');
  }

  return item;
}

export async function PATCH(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireCoach();
    const payload = updateSchema.parse(await request.json());

    const hasUpdates = Object.values(payload).some((value) => value !== undefined);

    if (!hasUpdates) {
      throw new ApiError(400, 'NO_FIELDS_PROVIDED', 'At least one field must be provided.');
    }

    const existing = await ensureCalendarItem(context.params.itemId, user.id);

    let templateDefaults: Awaited<ReturnType<typeof findCoachTemplate>> | null = null;

    if (payload.templateId !== undefined && payload.templateId !== null) {
      templateDefaults = await findCoachTemplate(payload.templateId, user.id);
    }

    const data: Prisma.CalendarItemUpdateInput = {};

    if (payload.date) {
      data.date = parseDateOnly(payload.date, 'date');
    }

    if (payload.plannedStartTimeLocal !== undefined) {
      data.plannedStartTimeLocal = payload.plannedStartTimeLocal;
    }

    if (payload.discipline) {
      data.discipline = payload.discipline;
    } else if (templateDefaults?.discipline) {
      data.discipline = templateDefaults.discipline;
    }

    if (payload.subtype !== undefined) {
      data.subtype = payload.subtype;
    } else if (templateDefaults?.subtype) {
      data.subtype = templateDefaults.subtype;
    }

    if (payload.title) {
      data.title = payload.title;
    } else if (templateDefaults?.title) {
      data.title = templateDefaults.title;
    }

    if (payload.plannedDurationMinutes !== undefined) {
      data.plannedDurationMinutes = payload.plannedDurationMinutes;
    }

    if (payload.plannedDistanceKm !== undefined) {
      data.plannedDistanceKm = payload.plannedDistanceKm;
    }

    if (payload.distanceMeters !== undefined) {
      data.distanceMeters = payload.distanceMeters;
      // Keep legacy km field in sync when distanceMeters is explicitly updated.
      data.plannedDistanceKm = payload.distanceMeters != null ? payload.distanceMeters / 1000 : null;
    }

    if (payload.intensityTarget !== undefined) {
      data.intensityTarget = payload.intensityTarget;
    }

    if (payload.tags !== undefined) {
      data.tags = payload.tags;
    }

    if (payload.equipment !== undefined) {
      data.equipment = payload.equipment;
    }

    if (payload.workoutStructure !== undefined) {
      data.workoutStructure = payload.workoutStructure as Prisma.InputJsonValue;
    }

    if (payload.notes !== undefined) {
      data.notes = payload.notes;
    }

    if (payload.intensityType !== undefined) {
      data.intensityType = payload.intensityType;
    }

    if (payload.intensityTargetJson !== undefined) {
      data.intensityTargetJson = payload.intensityTargetJson as Prisma.InputJsonValue;
    }

    if (payload.workoutDetail !== undefined) {
      data.workoutDetail = payload.workoutDetail;
    }

    if (payload.attachmentsJson !== undefined) {
      data.attachmentsJson = payload.attachmentsJson as Prisma.InputJsonValue;
    }

    // If a coach edits an APB-origin item, mark it as manually edited so APB materialisation
    // does not overwrite coach overrides on subsequent publishes.
    const isApbOrigin =
      existing.origin === APB_CALENDAR_ORIGIN &&
      typeof (existing as any).sourceActivityId === 'string' &&
      String((existing as any).sourceActivityId).startsWith(APB_SOURCE_PREFIX);

    const touchesManualFields =
      payload.date !== undefined ||
      payload.plannedStartTimeLocal !== undefined ||
      payload.discipline !== undefined ||
      payload.subtype !== undefined ||
      payload.title !== undefined ||
      payload.plannedDurationMinutes !== undefined ||
      payload.plannedDistanceKm !== undefined ||
      payload.distanceMeters !== undefined ||
      payload.intensityTarget !== undefined ||
      payload.tags !== undefined ||
      payload.equipment !== undefined ||
      payload.workoutStructure !== undefined ||
      payload.notes !== undefined ||
      payload.intensityType !== undefined ||
      payload.intensityTargetJson !== undefined ||
      payload.workoutDetail !== undefined ||
      payload.attachmentsJson !== undefined ||
      payload.templateId !== undefined;

    if (isApbOrigin && touchesManualFields) {
      const base = payload.tags !== undefined ? payload.tags : ((existing.tags ?? []) as string[]);
      const next = Array.from(new Set([...(base ?? []), APB_MANUAL_EDIT_TAG]));
      data.tags = next;

      // Explicit flag so downstream materialisation can reliably detect manual overrides.
      // (We keep the tag as a backwards-compatible signal.)
      data.coachEdited = true;
    }

    if (payload.status) {
      data.status = payload.status;
    }

    if (payload.planningStatus !== undefined) {
      data.planningStatus = payload.planningStatus;
    }

    if (payload.templateId !== undefined) {
      data.template = payload.templateId
        ? {
            connect: { id: payload.templateId },
          }
        : { disconnect: true };
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'NO_EFFECTIVE_CHANGES', 'No valid changes supplied.');
    }

    const updated = await prisma.calendarItem.update({
      where: { id: context.params.itemId },
      data,
      include: includeRefs,
    });

    return success({ item: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireCoach();
    const itemId = context.params.itemId;

    const [item, comments, completedActivities] = await Promise.all([
      prisma.calendarItem.findFirst({
        where: { id: itemId, coachId: user.id, deletedAt: null },
        include: {
          ...includeRefs,
          athlete: {
            select: {
              user: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.comment.findMany({
        where: { calendarItemId: itemId },
        ...commentsSelect,
      }),
      prisma.completedActivity.findMany({
        where: { calendarItemId: itemId },
        ...completedActivitiesSelect,
      }),
    ]);

    if (!item) {
      throw notFound('Calendar item not found.');
    }

    const completed = mergeLatestCompletion((completedActivities ?? []) as Array<Record<string, any>>) as
      | ({ source: string; startTime: Date; metricsJson?: any } & Record<string, any>)
      | null;

    const completedWithEffective = completed
      ? {
          ...completed,
          effectiveStartTimeUtc: getEffectiveActualStartUtc(completed).toISOString(),
        }
      : undefined;

    return success({
      item: {
        ...item,
        athlete: item.athlete?.user ?? null,
        comments: comments ?? [],
        completedActivities: completedWithEffective ? [completedWithEffective] : [],
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { itemId: string } }
) {
  try {
    const { user } = await requireCoach();
    await ensureCalendarItem(context.params.itemId, user.id);
    await prisma.calendarItem.delete({ where: { id: context.params.itemId } });

    return success({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
