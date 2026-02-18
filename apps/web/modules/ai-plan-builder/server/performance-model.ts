import { assertCoachOwnsAthlete } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { requireAiPlanBuilderV1Enabled } from './flag';

type EwmaState = {
  ctl: number;
  atl: number;
};

type DailyLoad = {
  dayKey: string;
  load: number;
};

type PerformanceModel = {
  current: {
    dayKey: string;
    ctl: number;
    atl: number;
    tsb: number;
  };
  projected: {
    dayKey: string;
    ctl: number;
    atl: number;
    tsb: number;
  };
  delta: {
    ctl: number;
    atl: number;
    tsb: number;
  };
  upcoming: {
    days: number;
    plannedLoad: number;
    avgDailyLoad: number;
  };
};

function dayKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDayKey(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function addDays(dayKey: string, days: number): string {
  const d = parseDayKey(dayKey);
  d.setUTCDate(d.getUTCDate() + days);
  return dayKeyFromDate(d);
}

function diffDays(start: string, end: string): number {
  const a = parseDayKey(start).getTime();
  const b = parseDayKey(end).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

function expFactor(days: number): number {
  return 1 - Math.exp(-1 / days);
}

function evolve(state: EwmaState, load: number): EwmaState {
  const kCtl = expFactor(42);
  const kAtl = expFactor(7);
  const ctl = state.ctl + (load - state.ctl) * kCtl;
  const atl = state.atl + (load - state.atl) * kAtl;
  return { ctl, atl };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function plannedSessionLoad(durationMinutes: number, sessionType: string): number {
  const type = String(sessionType || '').trim().toLowerCase();
  const factorByType: Record<string, number> = {
    recovery: 0.7,
    easy: 0.8,
    endurance: 1.0,
    main: 1.0,
    strength: 0.9,
    drill: 0.85,
    tempo: 1.15,
    threshold: 1.25,
    vo2: 1.35,
    interval: 1.3,
    brick: 1.2,
    race: 1.4,
  };
  const factor = factorByType[type] ?? 1.0;
  return Math.max(0, durationMinutes) * factor;
}

function completedActivityLoad(durationMinutes: number, rpe: number | null): number {
  const intensity = rpe != null && Number.isFinite(rpe) ? Math.max(1, Math.min(10, rpe)) / 5 : 1;
  return Math.max(0, durationMinutes) * intensity;
}

function startOfWeekDayKeyWithWeekStart(dayKey: string, weekStart: 'monday' | 'sunday'): string {
  const date = parseDayKey(dayKey);
  const jsDay = date.getUTCDay();
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return dayKeyFromDate(date);
}

function sessionDayKey(params: {
  startDate: string;
  weekStart: 'monday' | 'sunday';
  weekIndex: number;
  dayOfWeek: number;
}): string {
  const startWeek = startOfWeekDayKeyWithWeekStart(params.startDate, params.weekStart);
  const startJsDay = params.weekStart === 'sunday' ? 0 : 1;
  const offsetWithinWeek = (params.dayOfWeek - startJsDay + 7) % 7;
  const offsetDays = Math.max(0, params.weekIndex) * 7 + offsetWithinWeek;
  return addDays(startWeek, offsetDays);
}

function materializeSeries(startDayKey: string, endDayKey: string, loadByDay: Map<string, number>) {
  const days = Math.max(0, diffDays(startDayKey, endDayKey));
  const series: DailyLoad[] = [];
  for (let i = 0; i <= days; i += 1) {
    const day = addDays(startDayKey, i);
    series.push({ dayKey: day, load: loadByDay.get(day) ?? 0 });
  }
  return series;
}

export async function getPerformanceModelPreview(params: {
  coachId: string;
  athleteId: string;
  aiPlanDraftId?: string | null;
}): Promise<{ model: PerformanceModel; aiPlanDraftId: string | null }> {
  requireAiPlanBuilderV1Enabled();
  await assertCoachOwnsAthlete(params.athleteId, params.coachId);

  const todayKey = dayKeyFromDate(new Date());
  const historyStart = addDays(todayKey, -120);

  const completed = await prisma.completedActivity.findMany({
    where: {
      athleteId: params.athleteId,
      startTime: { gte: parseDayKey(historyStart) },
    },
    select: {
      startTime: true,
      durationMinutes: true,
      rpe: true,
    },
  });

  const historicalLoadByDay = new Map<string, number>();
  for (const row of completed) {
    const day = dayKeyFromDate(row.startTime);
    const load = completedActivityLoad(Number(row.durationMinutes ?? 0), row.rpe ?? null);
    historicalLoadByDay.set(day, (historicalLoadByDay.get(day) ?? 0) + load);
  }

  let currentState: EwmaState = { ctl: 0, atl: 0 };
  const historySeries = materializeSeries(historyStart, todayKey, historicalLoadByDay);
  for (const day of historySeries) {
    currentState = evolve(currentState, day.load);
  }

  let draft =
    params.aiPlanDraftId && params.aiPlanDraftId.trim()
      ? await prisma.aiPlanDraft.findFirst({
          where: {
            id: params.aiPlanDraftId.trim(),
            coachId: params.coachId,
            athleteId: params.athleteId,
          },
          select: {
            id: true,
            setupJson: true,
            sessions: {
              select: { weekIndex: true, dayOfWeek: true, durationMinutes: true, type: true },
              orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
            },
          },
        })
      : null;

  if (!draft) {
    draft = await prisma.aiPlanDraft.findFirst({
      where: {
        coachId: params.coachId,
        athleteId: params.athleteId,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        setupJson: true,
        sessions: {
          select: { weekIndex: true, dayOfWeek: true, durationMinutes: true, type: true },
          orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
        },
      },
    });
  }

  if (!draft) {
    const ctl = round2(currentState.ctl);
    const atl = round2(currentState.atl);
    const tsb = round2(ctl - atl);
    return {
      aiPlanDraftId: null,
      model: {
        current: { dayKey: todayKey, ctl, atl, tsb },
        projected: { dayKey: todayKey, ctl, atl, tsb },
        delta: { ctl: 0, atl: 0, tsb: 0 },
        upcoming: { days: 0, plannedLoad: 0, avgDailyLoad: 0 },
      },
    };
  }

  const setup = (draft.setupJson ?? {}) as any;
  const startDateRaw = typeof setup?.startDate === 'string' ? setup.startDate : todayKey;
  const weekStart = setup?.weekStart === 'sunday' ? 'sunday' : 'monday';

  const projectedLoadByDay = new Map<string, number>();
  for (const s of draft.sessions ?? []) {
    const dayOfWeek = Number(s.dayOfWeek ?? 0);
    const weekIndex = Number(s.weekIndex ?? 0);
    const durationMinutes = Number(s.durationMinutes ?? 0);
    const dayKey = sessionDayKey({
      startDate: startDateRaw,
      weekStart,
      weekIndex,
      dayOfWeek,
    });
    if (dayKey < todayKey) continue;
    const load = plannedSessionLoad(durationMinutes, String(s.type ?? 'endurance'));
    projectedLoadByDay.set(dayKey, (projectedLoadByDay.get(dayKey) ?? 0) + load);
  }

  const projectedDays = Array.from(projectedLoadByDay.keys()).sort();
  const projectedEndKey = projectedDays.length ? projectedDays[projectedDays.length - 1] : todayKey;
  const projectionSeries = materializeSeries(todayKey, projectedEndKey, projectedLoadByDay);

  let projectedState: EwmaState = { ...currentState };
  for (const day of projectionSeries) {
    projectedState = evolve(projectedState, day.load);
  }

  const current = {
    dayKey: todayKey,
    ctl: round2(currentState.ctl),
    atl: round2(currentState.atl),
    tsb: round2(currentState.ctl - currentState.atl),
  };
  const projected = {
    dayKey: projectedEndKey,
    ctl: round2(projectedState.ctl),
    atl: round2(projectedState.atl),
    tsb: round2(projectedState.ctl - projectedState.atl),
  };
  const plannedLoad = round2(projectionSeries.reduce((sum, d) => sum + d.load, 0));
  const forecastDays = Math.max(0, diffDays(todayKey, projectedEndKey) + (projectedDays.length ? 1 : 0));
  const avgDailyLoad = forecastDays > 0 ? round2(plannedLoad / forecastDays) : 0;

  return {
    aiPlanDraftId: draft.id,
    model: {
      current,
      projected,
      delta: {
        ctl: round2(projected.ctl - current.ctl),
        atl: round2(projected.atl - current.atl),
        tsb: round2(projected.tsb - current.tsb),
      },
      upcoming: {
        days: forecastDays,
        plannedLoad,
        avgDailyLoad,
      },
    },
  };
}

