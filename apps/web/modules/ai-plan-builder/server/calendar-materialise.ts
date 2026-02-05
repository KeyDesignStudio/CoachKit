import { CalendarItemStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';
import { parseDateOnly } from '@/lib/date';
import { addDaysToDayKey, getLocalDayKey, isDayKey } from '@/lib/day-key';
import {
  assertNormalizedSessionDetailMatchesTotal,
  renderWorkoutDetailFromSessionDetailV1,
} from '@/lib/workoutDetailRenderer';

import { dayOffsetFromWeekStart, normalizeWeekStart } from '../lib/week-start';
import { sessionDetailV1Schema } from '../rules/session-detail';

import { buildAiPlanBuilderSessionTitle } from '../lib/session-title';

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
  if (!isDayKey(dayKey)) throw new ApiError(400, 'INVALID_DATE_FORMAT', 'Date must be YYYY-MM-DD.');

  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const jsDay = date.getUTCDay(); // 0=Sun..6=Sat
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  return addDaysToDayKey(dayKey, -diff);
}

function computeSessionDayKey(params: {
  // When startDate is present, weekIndex counts forward from startDate's week boundary.
  startDate?: string | null;
  // Legacy name: eventDate == completion date.
  completionDate: string;
  weeksToEvent: number;
  weekStart: 'monday' | 'sunday';
  weekIndex: number;
  dayOfWeek: number;
}): string {
  const offset = dayOffsetFromWeekStart(params.dayOfWeek, params.weekStart);

  if (params.startDate && isDayKey(params.startDate)) {
    const week0Start = startOfWeekDayKeyWithWeekStart(params.startDate, params.weekStart);
    const weekStartDayKey = addDaysToDayKey(week0Start, 7 * params.weekIndex);
    return addDaysToDayKey(weekStartDayKey, offset);
  }

  const completionWeekStart = startOfWeekDayKeyWithWeekStart(params.completionDate, params.weekStart);
  const remainingWeeks = params.weeksToEvent - 1 - params.weekIndex;
  const weekStartDayKey = addDaysToDayKey(completionWeekStart, -7 * remainingWeeks);
  return addDaysToDayKey(weekStartDayKey, offset);
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
      select: {
        id: true,
        athleteId: true,
        coachId: true,
        setupJson: true,
        planJson: true,
        visibilityStatus: true,
        planSourceSelectionJson: true,
      },
    });

    if (!draft || draft.athleteId !== params.athleteId || draft.coachId !== params.coachId) {
      throw new ApiError(404, 'NOT_FOUND', 'Draft plan not found.');
    }

    if (draft.visibilityStatus !== 'PUBLISHED') {
      throw new ApiError(409, 'DRAFT_NOT_PUBLISHED', 'Draft plan must be PUBLISHED to materialise calendar items.');
    }

    const athlete = await prisma.user.findUnique({ where: { id: params.athleteId }, select: { timezone: true } });
    const timeZone = athlete?.timezone ?? 'UTC';

    const planSetup = (draft.planJson as any)?.setup ?? null;
    const setupJson = (draft.setupJson ?? planSetup ?? {}) as any;
    // Draft setup is stored as JSON and has historically been serialized in a few different
    // shapes (YYYY-MM-DD, ISO timestamps, locale strings). Normalise to a canonical day key.
    const rawCompletionDate = (setupJson as any)?.completionDate ?? (setupJson as any)?.eventDate;
    const completionDate = getLocalDayKey(
      typeof rawCompletionDate === 'string' ? rawCompletionDate.trim() : (rawCompletionDate as any),
      timeZone
    );

    const rawStartDate = (setupJson as any)?.startDate;
    const startDate = rawStartDate
      ? getLocalDayKey(typeof rawStartDate === 'string' ? rawStartDate.trim() : (rawStartDate as any), timeZone)
      : null;

    const weekStart = normalizeWeekStart(setupJson?.weekStart);
    const weeksToEvent = clampInt(setupJson?.weeksToEvent, 1, 52, 1);

    if (!isDayKey(completionDate)) {
      throw new ApiError(400, 'INVALID_DRAFT_SETUP', 'Draft setup completionDate must be YYYY-MM-DD.');
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
        detailJson: true,
        locked: true,
      },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
    });

    const maxWeekIndex = sessions.reduce((acc, s) => Math.max(acc, Number(s.weekIndex) || 0), -1);
    const effectiveWeeksToEvent = Math.max(weeksToEvent, maxWeekIndex >= 0 ? maxWeekIndex + 1 : 0);

    const desiredSourceIds = sessions.map((s) => `${APB_SOURCE_PREFIX}${s.id}`);

    const existing = desiredSourceIds.length
      ? await prisma.calendarItem.findMany({
          where: {
            athleteId: params.athleteId,
            origin: APB_CALENDAR_ORIGIN,
            sourceActivityId: { in: desiredSourceIds },
          },
          // NOTE: Some workspaces resolve Prisma types from a different package root.
          // Keep runtime fields stable but avoid hard typing on select.
          select: {
            sourceActivityId: true,
            coachEdited: true,
            tags: true,
            status: true,
            deletedAt: true,
            plannedStartTimeLocal: true,
          } as any,
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
    >();

    for (const e of existing as any[]) {
      const sourceActivityId = typeof e?.sourceActivityId === 'string' ? e.sourceActivityId : null;
      if (!sourceActivityId) continue;
      existingBySourceId.set(sourceActivityId, {
        coachEdited: Boolean(e?.coachEdited ?? false),
        tags: Array.isArray(e?.tags) ? e.tags : [],
        status: e?.status as CalendarItemStatus,
        deletedAt: (e?.deletedAt as Date | null) ?? null,
        plannedStartTimeLocal: (e?.plannedStartTimeLocal as string | null) ?? null,
      });
    }

    let upsertedCount = 0;

    for (const s of sessions) {
      const sourceActivityId = `${APB_SOURCE_PREFIX}${s.id}`;
      const existingItem = existingBySourceId.get(sourceActivityId) ?? null;
      const existingTags = existingItem?.tags ?? [];
      const isManuallyEdited = Boolean(existingItem?.coachEdited) || existingTags.includes(APB_MANUAL_EDIT_TAG);

      const detailParsed = sessionDetailV1Schema.safeParse((s as any).detailJson);
      if (!detailParsed.success) {
        throw new ApiError(
          409,
          'MISSING_SESSION_DETAIL',
          'Draft session detailJson is required and must conform to SessionDetailV1 to publish.'
        );
      }

      try {
        assertNormalizedSessionDetailMatchesTotal({
          detail: detailParsed.data,
          totalMinutes: Number(s.durationMinutes ?? 0),
          incrementMinutes: 5,
        });
      } catch (e) {
        throw new ApiError(409, 'INVALID_SESSION_DETAIL', String((e as any)?.message ?? e));
      }

      const workoutDetail = renderWorkoutDetailFromSessionDetailV1(detailParsed.data);

      const title = buildAiPlanBuilderSessionTitle({ discipline: s.discipline, type: s.type });

      const planSourceMeta = (draft.planSourceSelectionJson ?? null) as any;
      const planSourceVersionIds = Array.isArray(planSourceMeta?.selectedPlanSourceVersionIds)
        ? planSourceMeta.selectedPlanSourceVersionIds
        : [];
      const selectedPlanSource = planSourceMeta?.selectedPlanSource ?? null;
      const attachmentsJson: Prisma.InputJsonValue = {
        aiPlanDraftId: draft.id,
        aiPlanDraftSessionId: s.id,
        planSourceVersionIds,
        planSourceId: selectedPlanSource?.planSourceId ?? null,
        planSourceVersionId: selectedPlanSource?.planSourceVersionId ?? null,
        planSourceVersion: selectedPlanSource?.planSourceVersion ?? null,
        planSourceTitle: selectedPlanSource?.title ?? null,
        planSourceArchetype: selectedPlanSource?.archetype ?? null,
        planSourceHash: selectedPlanSource?.checksumSha256 ?? null,
        planSourceInfluence: planSourceMeta?.influenceSummary ?? null,
      };

      const dayKey = computeSessionDayKey({
        startDate,
        completionDate,
        weeksToEvent: effectiveWeeksToEvent,
        weekStart,
        weekIndex: Number(s.weekIndex) || 0,
        dayOfWeek: Number(s.dayOfWeek) || 0,
      });
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
        subtype: String((s as any)?.type ?? '').trim() || null,
        title,
        plannedDurationMinutes: Math.max(0, Math.round(s.durationMinutes ?? 0)),
        notes: s.notes ?? null,
        workoutDetail,
        workoutStructure: (detailParsed.data as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        attachmentsJson,
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
          origin: APB_CALENDAR_ORIGIN,
          planningStatus: 'PLANNED',
          sourceActivityId,
          discipline: toCalendarDiscipline(s.discipline),
          subtype: String((s as any)?.type ?? '').trim() || null,
          title,
          plannedDurationMinutes: Math.max(0, Math.round(s.durationMinutes ?? 0)),
          plannedDistanceKm: null,
          distanceMeters: null,
          intensityTarget: null,
          tags: [],
          equipment: [],
          workoutStructure: (detailParsed.data as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
          notes: s.notes ?? null,
          workoutDetail,
          intensityType: null,
          intensityTargetJson: Prisma.DbNull,
          attachmentsJson,
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
      weeksToEventConfigured: weeksToEvent,
      weeksToEventEffective: effectiveWeeksToEvent,
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
