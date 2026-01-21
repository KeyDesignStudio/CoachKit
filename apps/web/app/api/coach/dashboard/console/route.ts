import { NextRequest } from 'next/server';
import { CalendarItemStatus } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { assertValidDateRange, parseDateOnly } from '@/lib/date';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD.' })
    .optional()
    .nullable(),
  athleteId: z.string().optional().nullable(),
  discipline: z.string().optional().nullable(),
});

const COMPLETED_STATUSES: CalendarItemStatus[] = [
  CalendarItemStatus.COMPLETED_MANUAL,
  CalendarItemStatus.COMPLETED_SYNCED,
  CalendarItemStatus.COMPLETED_SYNCED_DRAFT,
];

const REVIEWABLE_STATUSES: CalendarItemStatus[] = [...COMPLETED_STATUSES, CalendarItemStatus.SKIPPED];

const COMMENTS_LIMIT = 10;

function minutesOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function distanceOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  actionAt: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  workoutDetail: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    rpe: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: {
      id: string;
      name: string | null;
      role: 'COACH' | 'ATHLETE';
    };
  }>;
  hasAthleteComment: boolean;
  commentCount: number;
};

function getInboxPriority(item: ReviewItem): number {
  const painFlag = item.latestCompletedActivity?.painFlag ?? false;
  const hasComment = item.hasAthleteComment;
  const isSkipped = item.status === 'SKIPPED';

  if (painFlag && hasComment) return 1;
  if (painFlag) return 2;
  if (hasComment) return 3;
  if (isSkipped) return 4;
  return 5;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();
    const { searchParams } = new URL(request.url);

    const params = querySchema.parse({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      athleteId: searchParams.get('athleteId'),
      discipline: searchParams.get('discipline'),
    });

    const fromDate = params.from ? parseDateOnly(params.from, 'from') : null;
    const toDate = params.to ? parseDateOnly(params.to, 'to') : null;
    if (fromDate && toDate) {
      assertValidDateRange(fromDate, toDate);
    }

    const athleteId = (params.athleteId ?? '').trim() || null;
    const discipline = (params.discipline ?? '').trim().toUpperCase() || null;

    const rangeFilter = fromDate && toDate ? { date: { gte: fromDate, lte: toDate } } : {};
    const athleteFilter = athleteId ? { athleteId } : {};
    const disciplineFilter = discipline ? { discipline } : {};

    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId: user.id },
      select: {
        userId: true,
        disciplines: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ user: { name: 'asc' } }],
    });

    const athleteRows = athletes.map((a) => ({
      id: a.userId,
      name: a.user.name,
      disciplines: a.disciplines,
    }));

    // KPI counts
    const [completedCount, skippedCount] = await Promise.all([
      prisma.calendarItem.count({
        where: {
          coachId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...athleteFilter,
          ...disciplineFilter,
          status: { in: COMPLETED_STATUSES },
        },
      }),
      prisma.calendarItem.count({
        where: {
          coachId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...athleteFilter,
          ...disciplineFilter,
          status: CalendarItemStatus.SKIPPED,
        },
      }),
    ]);

    // Total time/distance: sum of latest completed activity per calendar item.
    // We pull the latest activity per item to avoid double-counting multiple activities.
    const completedItems = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        deletedAt: null,
        ...rangeFilter,
        ...athleteFilter,
        ...disciplineFilter,
        status: { in: COMPLETED_STATUSES },
      },
      select: {
        id: true,
        athleteId: true,
        discipline: true,
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: { durationMinutes: true, distanceKm: true, painFlag: true },
        },
      },
    });

    let totalMinutes = 0;
    let totalDistanceKm = 0;

    const disciplineTotals = new Map<string, { totalMinutes: number; totalDistanceKm: number }>();

    completedItems.forEach((item) => {
      const latest = item.completedActivities?.[0];
      const m = minutesOrZero(latest?.durationMinutes);
      const d = distanceOrZero(latest?.distanceKm);

      totalMinutes += m;
      totalDistanceKm += d;

      const key = (item.discipline || 'OTHER').toUpperCase();
      const prev = disciplineTotals.get(key) ?? { totalMinutes: 0, totalDistanceKm: 0 };
      prev.totalMinutes += m;
      prev.totalDistanceKm += d;
      disciplineTotals.set(key, prev);
    });

    const disciplines = ['BIKE', 'RUN', 'SWIM', 'OTHER'] as const;
    const disciplineLoad = disciplines.map((disc) => {
      const v = disciplineTotals.get(disc) ?? { totalMinutes: 0, totalDistanceKm: 0 };
      return { discipline: disc, totalMinutes: v.totalMinutes, totalDistanceKm: v.totalDistanceKm };
    });

    // Attention counts
    const [painFlagCount, athleteCommentWorkoutCount, awaitingReviewCount] = await Promise.all([
      prisma.calendarItem.count({
        where: {
          coachId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...athleteFilter,
          ...disciplineFilter,
          completedActivities: { some: { painFlag: true } },
        },
      }),
      prisma.calendarItem.count({
        where: {
          coachId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...athleteFilter,
          ...disciplineFilter,
          comments: { some: { author: { role: 'ATHLETE' } } },
        },
      }),
      prisma.calendarItem.count({
        where: {
          coachId: user.id,
          deletedAt: null,
          ...rangeFilter,
          ...athleteFilter,
          ...disciplineFilter,
          status: { in: REVIEWABLE_STATUSES },
          reviewedAt: null,
        },
      }),
    ]);

    // Review inbox items (unreviewed completed/skipped) for this range
    const inboxItems = await prisma.calendarItem.findMany({
      where: {
        coachId: user.id,
        deletedAt: null,
        ...rangeFilter,
        ...athleteFilter,
        ...disciplineFilter,
        status: { in: REVIEWABLE_STATUSES },
        reviewedAt: null,
      },
      orderBy: [{ actionAt: 'desc' }, { updatedAt: 'desc' }, { date: 'desc' }],
      select: {
        id: true,
        athleteId: true,
        date: true,
        actionAt: true,
        plannedStartTimeLocal: true,
        discipline: true,
        subtype: true,
        title: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        intensityType: true,
        intensityTargetJson: true,
        workoutDetail: true,
        attachmentsJson: true,
        status: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        athlete: {
          select: {
            user: { select: { id: true, name: true } },
          },
        },
        completedActivities: {
          orderBy: [{ startTime: 'desc' as const }],
          take: 1,
          select: {
            id: true,
            source: true,
            durationMinutes: true,
            distanceKm: true,
            rpe: true,
            painFlag: true,
            startTime: true,
          },
        },
        comments: {
          orderBy: [{ createdAt: 'desc' as const }],
          take: COMMENTS_LIMIT,
          select: {
            id: true,
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
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    const formattedInbox: ReviewItem[] = inboxItems.map((item: any) => {
      const comments = (item.comments ?? []).slice().reverse();
      const hasAthleteComment = comments.some((c: any) => c.author?.role === 'ATHLETE');

      const latestCompletedActivity = item.completedActivities?.[0] ?? null;
      const persisted = item.actionAt ? new Date(item.actionAt) : null;
      const fallback = latestCompletedActivity?.startTime ? new Date(latestCompletedActivity.startTime) : new Date(item.updatedAt);
      const actionAt = persisted && !Number.isNaN(persisted.getTime()) ? persisted : fallback;

      return {
        id: item.id,
        date: item.date,
        actionAt: actionAt.toISOString(),
        plannedStartTimeLocal: item.plannedStartTimeLocal,
        discipline: item.discipline,
        title: item.title,
        plannedDurationMinutes: item.plannedDurationMinutes,
        plannedDistanceKm: item.plannedDistanceKm,
        workoutDetail: item.workoutDetail,
        status: item.status,
        athlete: item.athlete?.user ?? null,
        latestCompletedActivity,
        comments,
        hasAthleteComment,
        commentCount: item._count?.comments ?? comments.length,
      };
    });

    formattedInbox.sort((a, b) => {
      const ap = getInboxPriority(a);
      const bp = getInboxPriority(b);
      if (ap !== bp) return ap - bp;
      return new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime();
    });

    return success(
      {
        athletes: athleteRows,
        kpis: {
          workoutsCompleted: completedCount,
          workoutsSkipped: skippedCount,
          totalTrainingMinutes: totalMinutes,
          totalDistanceKm,
        },
        attention: {
          painFlagWorkouts: painFlagCount,
          athleteCommentWorkouts: athleteCommentWorkoutCount,
          skippedWorkouts: skippedCount,
          awaitingCoachReview: awaitingReviewCount,
        },
        disciplineLoad,
        reviewInbox: formattedInbox,
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
