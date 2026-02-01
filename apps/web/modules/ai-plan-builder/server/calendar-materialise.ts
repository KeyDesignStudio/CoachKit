import { CalendarItemStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { parseDateOnly } from '@/lib/date';
import { addDaysToDayKey, isDayKey } from '@/lib/day-key';

import { dayOffsetFromWeekStart, normalizeWeekStart } from '../lib/week-start';

export const APB_CALENDAR_ORIGIN = 'AI_PLAN_BUILDER';
export const APB_SOURCE_PREFIX = 'apb:';
export const APB_MANUAL_EDIT_TAG = 'APB_MANUAL_EDITED';

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toCalendarDiscipline(raw: string): string {
  const d = String(raw ?? '').trim().toLowerCase();
  if (d === 'run') return 'RUN';
  if (d === 'bike' || d === 'ride' || d === 'cycle') return 'BIKE';
  if (d === 'swim') return 'SWIM';
  if (d === 'brick') return 'BRICK';
  if (d === 'strength') return 'OTHER';
  if (d === 'rest') return 'REST';
  return d ? d.toUpperCase() : 'OTHER';
}

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  if (!isDayKey(dayKey)) throw new ApiError(400, 'INVALID_DATE_FORMAT', 'eventDate must be YYYY-MM-DD.');

  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const jsDay = date.getUTCDay(); // 0=Sun..6=Sat
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
}

function computeSessionDayKey(params: {
  eventDate: string;
  weeksToEvent: number;
  weekStart: 'monday' | 'sunday';
  weekIndex: number;
  dayOfWeek: number;
}): string {
  const eventWeekStart = startOfWeekDayKeyWithWeekStart(params.eventDate, params.weekStart);
  const remainingWeeks = params.weeksToEvent - 1 - params.weekIndex;
  const weekStartDayKey = addDaysToDayKey(eventWeekStart, -7 * remainingWeeks);
  const offset = dayOffsetFromWeekStart(params.dayOfWeek, params.weekStart);
  return addDaysToDayKey(weekStartDayKey, offset);
}

function buildApbTitle(params: { discipline: string; type: string }) {
  const discipline = toCalendarDiscipline(params.discipline);
  const rawType = String(params.type ?? '').trim();
  if (!rawType) return `${discipline} Session`;
  return `${discipline} ${rawType}`;
}

function isRetryableMaterialiseError(error: unknown): boolean {
  const code = typeof (error as any)?.code === 'string' ? String((error as any).code) : null;
  const name = typeof (error as any)?.name === 'string' ? String((error as any).name) : null;
  // P2028: interactive transaction closed; we don't use interactive tx here, but keep it as a safe transient retry.
  return name === 'PrismaClientKnownRequestError' && code === 'P2028';
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type MaterialiseCalendarResult = {
  upsertedCount: number;
  softDeletedCount: number;
  publishedPlanId: string;
};

export async function materialisePublishedAiPlanToCalendar(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId: string;
  proposalId?: string;
  requestId?: string;
}): Promise<MaterialiseCalendarResult> {
  const run = async () => {
    const draft = await prisma.aiPlanDraft.findUnique({
      where: { id: params.aiPlanDraftId },
      select: { id: true, athleteId: true, coachId: true, setupJson: true, visibilityStatus: true },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    if (draft.visibilityStatus !== 'PUBLISHED') {
      throw new ApiError(409, 'DRAFT_NOT_PUBLISHED', 'Draft plan must be PUBLISHED to materialise calendar items.');
    }

    const athlete = await prisma.user.findUnique({ where: { id: params.athleteId }, select: { timezone: true } });
    const timeZone = athlete?.timezone ?? 'UTC';

    const setupJson = (draft.setupJson ?? {}) as any;
    const eventDate = String(setupJson?.eventDate ?? '').trim();
    const weekStart = normalizeWeekStart(setupJson?.weekStart);
    const weeksToEvent = clampInt(setupJson?.weeksToEvent, 1, 52, 1);

    if (!isDayKey(eventDate)) {
      throw new ApiError(400, 'INVALID_DRAFT_SETUP', 'Draft setup eventDate must be YYYY-MM-DD.');
    }

    const sessions = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: draft.id },
      select: {
        id: true,
        weekIndex: true,
        ordinal: true,
        dayOfWeek: true,
        discipline: true,
        type: true,
        durationMinutes: true,
        notes: true,
        locked: true,
      },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });

    const desiredSourceIds = sessions.map((s) => `${APB_SOURCE_PREFIX}${s.id}`);

    const existing = desiredSourceIds.length
      ? await prisma.calendarItem.findMany({
          where: {
            athleteId: params.athleteId,
            origin: APB_CALENDAR_ORIGIN,
            sourceActivityId: { in: desiredSourceIds },
          },
          select: {
            sourceActivityId: true,
            coachEdited: true,
            tags: true,
            status: true,
            deletedAt: true,
            plannedStartTimeLocal: true,
          },
        })
      : [];

    const existingBySourceId = new Map<
      string,
      {
        coachEdited: boolean;
        tags: string[];
        status: CalendarItemStatus;
        deletedAt: Date | null;
        plannedStartTimeLocal: string | null;
      }
    >(
      existing
        .filter(
          (e): e is {
            sourceActivityId: string;
            coachEdited: boolean;
            tags: string[];
            status: CalendarItemStatus;
            deletedAt: Date | null;
            plannedStartTimeLocal: string | null;
          } => Boolean(e.sourceActivityId)
        )
        .map(
          (e) =>
            [
              String(e.sourceActivityId),
              {
                coachEdited: Boolean((e as any).coachEdited ?? false),
                tags: (e.tags ?? []) as string[],
                status: e.status,
                deletedAt: e.deletedAt,
                plannedStartTimeLocal: e.plannedStartTimeLocal,
              },
            ] as const
        )
    );

    let upsertedCount = 0;

    for (const s of sessions) {
      const sourceActivityId = `${APB_SOURCE_PREFIX}${s.id}`;
      const existingItem = existingBySourceId.get(sourceActivityId) ?? null;
      const existingTags = existingItem?.tags ?? [];
      const isManuallyEdited = Boolean(existingItem?.coachEdited) || existingTags.includes(APB_MANUAL_EDIT_TAG);

      const dayKey = computeSessionDayKey({
        eventDate,
        weeksToEvent,
        weekStart,
        weekIndex: s.weekIndex,
        dayOfWeek: s.dayOfWeek,
      });

      // NOTE: CalendarItem.date is stored as UTC midnight of the YYYY-MM-DD key.
      // The UI interprets it in athlete timezone using the same day-key boundary logic.
      const date = parseDateOnly(dayKey, 'date');

      const canUpdateDate =
        !existingItem ||
        existingItem.deletedAt != null ||
        (existingItem.status === CalendarItemStatus.PLANNED && existingItem.plannedStartTimeLocal == null);

      const restoreOnly: Prisma.CalendarItemUpdateInput = {
        deletedAt: null,
        deletedByUserId: null,
      };

      const fullUpdate: Prisma.CalendarItemUpdateInput = {
        ...restoreOnly,
        ...(canUpdateDate ? { date } : {}),
        discipline: toCalendarDiscipline(s.discipline),
        subtype: null,
        title: buildApbTitle({ discipline: s.discipline, type: s.type }),
        plannedDurationMinutes: Math.max(0, Math.round(s.durationMinutes ?? 0)),
        notes: s.notes ?? null,
        workoutDetail: s.notes ?? null,
      };

      await prisma.calendarItem.upsert({
        where: {
          athleteId_origin_sourceActivityId: {
            athleteId: params.athleteId,
            origin: APB_CALENDAR_ORIGIN,
            sourceActivityId,
          },
        },
        create: {
          athleteId: params.athleteId,
          coachId: params.coachId,
          date,
          plannedStartTimeLocal: null,
          coachEdited: false,
          origin: APB_CALENDAR_ORIGIN,
          planningStatus: 'PLANNED',
          sourceActivityId,
          discipline: toCalendarDiscipline(s.discipline),
          subtype: null,
          title: buildApbTitle({ discipline: s.discipline, type: s.type }),
          plannedDurationMinutes: Math.max(0, Math.round(s.durationMinutes ?? 0)),
          plannedDistanceKm: null,
          distanceMeters: null,
          intensityTarget: null,
          tags: [],
          equipment: [],
          workoutStructure: Prisma.DbNull,
          notes: s.notes ?? null,
          workoutDetail: s.notes ?? null,
          intensityType: null,
          intensityTargetJson: Prisma.DbNull,
          attachmentsJson: Prisma.DbNull,
          status: CalendarItemStatus.PLANNED,
          deletedAt: null,
          deletedByUserId: null,
        },
        update: isManuallyEdited ? restoreOnly : fullUpdate,
      });

      upsertedCount += 1;
    }

    // Soft-delete any previously materialised APB items that are no longer present.
    const existingActive = await prisma.calendarItem.findMany({
      where: {
        athleteId: params.athleteId,
        origin: APB_CALENDAR_ORIGIN,
        sourceActivityId: { startsWith: APB_SOURCE_PREFIX },
        deletedAt: null,
      },
      select: { id: true, sourceActivityId: true },
    });

    const desiredSet = new Set(desiredSourceIds);
    const idsToSoftDelete = existingActive
      .filter((i) => i.sourceActivityId && !desiredSet.has(String(i.sourceActivityId)))
      .map((i) => i.id);

    let softDeletedCount = 0;
    if (idsToSoftDelete.length) {
      const res = await prisma.calendarItem.updateMany({
        where: { id: { in: idsToSoftDelete } },
        data: { deletedAt: new Date(), deletedByUserId: params.coachId },
      });
      softDeletedCount = res.count;
    }

    // Diagnostics
    console.info('APB_CALENDAR_MATERIALISED', {
      requestId: params.requestId ?? null,
      athleteId: params.athleteId,
      coachId: params.coachId,
      proposalId: params.proposalId ?? null,
      publishedPlanId: draft.id,
      timeZone,
      upsertedCount,
      softDeletedCount,
    });

    return { upsertedCount, softDeletedCount, publishedPlanId: draft.id };
  };

  try {
    return await run();
  } catch (e) {
    if (!isRetryableMaterialiseError(e)) throw e;
    await sleep(150);
    return await run();
  }
}
