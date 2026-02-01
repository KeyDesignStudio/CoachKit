export type RiskTolerance = 'low' | 'med' | 'high';
export type DisciplineEmphasis = 'balanced' | 'swim' | 'bike' | 'run';

export type DraftDiscipline = 'swim' | 'bike' | 'run' | 'strength' | 'rest';
export type DraftSessionType = 'endurance' | 'tempo' | 'threshold' | 'technique' | 'recovery' | 'strength' | 'rest';

export type DraftPlanSetupV1 = {
  weekStart?: 'monday' | 'sunday';
  eventDate: string; // yyyy-mm-dd
  weeksToEvent: number;
  weeklyAvailabilityDays: number[]; // 0=Sun..6=Sat
  weeklyAvailabilityMinutes: number | Record<string, number>; // total minutes/week OR map dayIndex->minutes
  disciplineEmphasis: DisciplineEmphasis;
  riskTolerance: RiskTolerance;
  maxIntensityDaysPerWeek: number; // 1-3
  maxDoublesPerWeek: number; // 0-3
  longSessionDay?: number | null; // 0=Sun..6=Sat
  coachGuidanceText?: string; // plain-English coach guidance; optional
};

export type DraftWeekV1 = {
  weekIndex: number;
  locked: boolean;
  sessions: Array<{
    weekIndex: number;
    ordinal: number;
    dayOfWeek: number;
    discipline: DraftDiscipline;
    type: DraftSessionType;
    durationMinutes: number;
    notes?: string | null;
    locked: boolean;
  }>;
};

export type DraftPlanV1 = {
  version: 'v1';
  setup: DraftPlanSetupV1;
  weeks: DraftWeekV1[];
};

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stableDayList(days: number[]) {
  return Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
}

function availabilityTotalMinutes(availability: DraftPlanSetupV1['weeklyAvailabilityMinutes']) {
  if (typeof availability === 'number') return Math.max(0, Math.round(availability));
  const entries = Object.entries(availability);
  return entries.reduce((sum, [, v]) => sum + (typeof v === 'number' ? Math.max(0, Math.round(v)) : 0), 0);
}

function sessionsPerWeek(setup: DraftPlanSetupV1, daysCount: number) {
  // Conservative defaults: keep it useful, not "clever".
  const base = setup.riskTolerance === 'low' ? 5 : setup.riskTolerance === 'med' ? 6 : 8;
  const minBase = setup.riskTolerance === 'low' ? 4 : setup.riskTolerance === 'med' ? 5 : 6;

  const maxByDays = daysCount + clampInt(setup.maxDoublesPerWeek, 0, 3); // at most one extra session per "double".
  return clampInt(Math.min(base, maxByDays), minBase, Math.max(minBase, maxByDays));
}

function taperMultiplier(setup: DraftPlanSetupV1, weekIndex: number) {
  // weekIndex: 0..weeksToEvent-1, where last week is closest to event.
  const remaining = setup.weeksToEvent - 1 - weekIndex;
  if (remaining >= 2) return 1;

  // Last 2 weeks: reduce 20-40% depending on risk.
  if (setup.riskTolerance === 'low') return remaining === 1 ? 0.85 : 0.75;
  if (setup.riskTolerance === 'med') return remaining === 1 ? 0.8 : 0.7;
  return remaining === 1 ? 0.75 : 0.6;
}

function includesSwim(setup: DraftPlanSetupV1) {
  return setup.disciplineEmphasis === 'balanced' || setup.disciplineEmphasis === 'swim';
}

function mainDiscipline(setup: DraftPlanSetupV1): DraftDiscipline {
  if (setup.disciplineEmphasis === 'swim') return 'swim';
  if (setup.disciplineEmphasis === 'bike') return 'bike';
  if (setup.disciplineEmphasis === 'run') return 'run';
  return 'bike';
}

function pickLongDay(setup: DraftPlanSetupV1, days: number[]) {
  const preferred = setup.longSessionDay;
  if (preferred !== null && preferred !== undefined && days.includes(preferred)) return preferred;

  // Prefer Sat/Sun if available.
  for (const d of [6, 0]) {
    if (days.includes(d)) return d;
  }

  return days[days.length - 1] ?? 0;
}

function daySortKey(dayOfWeek: number, weekStart: 'monday' | 'sunday') {
  const d = ((Number(dayOfWeek) % 7) + 7) % 7;
  if (weekStart === 'sunday') return d;
  return (d + 6) % 7;
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function humanizeWeekDurations(params: {
  sessions: DraftWeekV1['sessions'];
  longDay: number;
}): DraftWeekV1['sessions'] {
  const MIN = 20;
  const MAX = 240;

  const originalTotal = params.sessions.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);

  const rounded = params.sessions.map((s) => {
    const isLongDay = s.dayOfWeek === params.longDay;
    const base = Number(s.durationMinutes) || 0;
    const step = isLongDay || base >= 90 ? 10 : 5;
    const next = Math.max(MIN, Math.min(MAX, roundToStep(base, step)));
    return { ...s, durationMinutes: next, __step: step, __isLongDay: isLongDay } as any;
  });

  let diff = originalTotal - rounded.reduce((sum, s: any) => sum + (Number(s.durationMinutes) || 0), 0);

  const tryAdjust = (direction: 'up' | 'down') => {
    const candidates = rounded
      .slice()
      .sort((a: any, b: any) => {
        // Prefer adjusting non-long-day sessions first.
        if (a.__isLongDay !== b.__isLongDay) return a.__isLongDay ? 1 : -1;

        // Prefer smaller steps for fine adjustments.
        if (a.__step !== b.__step) return a.__step - b.__step;

        // For down: reduce biggest first. For up: increase smallest first.
        return direction === 'down' ? b.durationMinutes - a.durationMinutes : a.durationMinutes - b.durationMinutes;
      });

    for (const s of candidates as any[]) {
      const step = Number(s.__step) || 5;
      if (direction === 'up') {
        if (s.durationMinutes + step > MAX) continue;
        s.durationMinutes += step;
        diff -= step;
        return true;
      }

      if (s.durationMinutes - step < MIN) continue;
      s.durationMinutes -= step;
      diff += step;
      return true;
    }

    return false;
  };

  // Adjust to preserve weekly intent (sum of generated durations) after rounding.
  // Cap iterations to avoid pathological loops.
  let guard = 0;
  while (diff !== 0 && guard++ < 500) {
    if (diff > 0) {
      if (!tryAdjust('up')) break;
    } else {
      if (!tryAdjust('down')) break;
    }
  }

  return rounded.map(({ __step, __isLongDay, ...s }: any) => s);
}

export function generateDraftPlanDeterministicV1(setupRaw: DraftPlanSetupV1): DraftPlanV1 {
  const days = stableDayList(setupRaw.weeklyAvailabilityDays);
  const weeksToEvent = clampInt(setupRaw.weeksToEvent, 1, 52);
  const maxIntensityDaysPerWeek = clampInt(setupRaw.maxIntensityDaysPerWeek, 1, 3);
  const maxDoublesPerWeek = clampInt(setupRaw.maxDoublesPerWeek, 0, 3);
  const weekStart: 'monday' | 'sunday' = setupRaw.weekStart === 'sunday' ? 'sunday' : 'monday';

  const setup: DraftPlanSetupV1 = {
    ...setupRaw,
    weekStart,
    weeksToEvent,
    weeklyAvailabilityDays: days,
    maxIntensityDaysPerWeek,
    maxDoublesPerWeek,
  };

  const totalMinutesBase = availabilityTotalMinutes(setup.weeklyAvailabilityMinutes);
  const targetSessions = sessionsPerWeek(setup, days.length);
  const longDay = pickLongDay(setup, days);

  const weeks: DraftWeekV1[] = [];

  for (let weekIndex = 0; weekIndex < weeksToEvent; weekIndex++) {
    const multiplier = taperMultiplier(setup, weekIndex);
    const weekTotalMinutes = clampInt(totalMinutesBase * multiplier, 60, Math.max(60, totalMinutesBase));

    // Assign sessions deterministically across available days.
    // Build a day->slots list (1 per day, plus doubles on earliest days).
    const slots: number[] = [];
    for (const d of days) slots.push(d);
    for (let i = 0; i < maxDoublesPerWeek; i++) {
      const extraDay = days[i % days.length];
      if (extraDay !== undefined) slots.push(extraDay);
    }

    const weekSlots = slots.slice(0, targetSessions).sort((a, b) => a - b);

    // Determine which days are "intensity" (avoid consecutive).
    const intensityDays: number[] = [];
    for (const d of weekSlots) {
      if (intensityDays.length >= maxIntensityDaysPerWeek) break;
      const last = intensityDays[intensityDays.length - 1];
      if (last !== undefined && Math.abs(d - last) <= 1) continue;
      // Avoid using long day as intensity.
      if (d === longDay) continue;
      intensityDays.push(d);
    }

    const avgMinutes = clampInt(weekTotalMinutes / Math.max(1, weekSlots.length), 20, 120);

    const sessions: DraftWeekV1['sessions'] = [];

    let ordinal = 0;

    // Technique swim once per week if swim included (on the first available day).
    if (includesSwim(setup) && weekSlots.length > 0) {
      const d = weekSlots[0];
      sessions.push({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: d,
        discipline: 'swim',
        type: 'technique',
        durationMinutes: clampInt(avgMinutes * 0.8, 20, 60),
        notes: 'Technique focus',
        locked: false,
      });
    }

    // Long session weekly if >= 6 weeks.
    if (weeksToEvent >= 6) {
      const longIsBike = weekIndex % 2 === 0;
      const discipline: DraftDiscipline = longIsBike ? 'bike' : 'run';
      sessions.push({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: longDay,
        discipline,
        type: 'endurance',
        durationMinutes: clampInt(avgMinutes * 2.2, 60, 180),
        notes: discipline === 'bike' ? 'Long ride' : 'Long run',
        locked: false,
      });
    }

    // Brick every 2 weeks for med/high.
    if ((setup.riskTolerance === 'med' || setup.riskTolerance === 'high') && weekIndex % 2 === 1) {
      sessions.push({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: longDay,
        discipline: 'bike',
        type: 'endurance',
        durationMinutes: clampInt(avgMinutes * 1.3, 40, 120),
        notes: 'Brick (add short run off bike)',
        locked: false,
      });
    }

    // Fill remaining slots deterministically.
    const preferredMain = mainDiscipline(setup);

    while (sessions.length < weekSlots.length) {
      const day = weekSlots[sessions.length % weekSlots.length];
      const isIntensity = intensityDays.includes(day);

      const discipline: DraftDiscipline =
        setup.disciplineEmphasis === 'balanced'
          ? (sessions.length % 3 === 0 ? 'run' : sessions.length % 3 === 1 ? 'bike' : includesSwim(setup) ? 'swim' : 'run')
          : preferredMain;

      const type: DraftSessionType =
        discipline === 'swim'
          ? 'technique'
          : isIntensity
            ? (setup.riskTolerance === 'high' ? 'threshold' : 'tempo')
            : 'endurance';

      sessions.push({
        weekIndex,
        ordinal: ordinal++,
        dayOfWeek: day,
        discipline,
        type,
        durationMinutes: clampInt(avgMinutes, 20, 120),
        notes: isIntensity ? 'Key session' : null,
        locked: false,
      });
    }

    // Sort by configured week start, then ordinal for a stable UI order.
    const sorted = sessions
      .slice()
      .sort((a, b) => daySortKey(a.dayOfWeek, weekStart) - daySortKey(b.dayOfWeek, weekStart) || a.ordinal - b.ordinal)
      .map((s, idx) => ({ ...s, ordinal: idx }));

    const humanized = humanizeWeekDurations({ sessions: sorted, longDay });

    weeks.push({ weekIndex, locked: false, sessions: humanized });
  }

  return { version: 'v1', setup, weeks };
}

