export const DEFAULT_SHORT_INCREMENT_MINUTES = 5;
export const DEFAULT_LONG_INCREMENT_MINUTES = 10;

export function roundToIncrementMinutes(value: number, incrementMinutes: number): number {
  const n = Number.isFinite(value) ? value : 0;
  const inc = Math.max(1, Math.round(incrementMinutes));
  return Math.max(0, Math.round(n / inc) * inc);
}

export function normalizeWeekDurations(params: {
  sessions: Array<{ durationMinutes: number; locked?: boolean; dayOfWeek?: number | null }>;
  longSessionDay?: number | null;
  longSessionThresholdMinutes?: number;
}): { sessions: Array<{ durationMinutes: number }>; targetTotalMinutes: number; finalTotalMinutes: number } {
  const longSessionThresholdMinutes = Math.max(0, Math.round(params.longSessionThresholdMinutes ?? 90));
  const longSessionDay = params.longSessionDay == null ? null : ((Number(params.longSessionDay) % 7) + 7) % 7;

  const rawDurations = params.sessions.map((s) => Math.max(0, Math.round(Number(s.durationMinutes ?? 0))));
  const rawTotal = rawDurations.reduce((sum, m) => sum + m, 0);

  const targetTotalMinutes = roundToIncrementMinutes(rawTotal, DEFAULT_SHORT_INCREMENT_MINUTES);

  const rounded = params.sessions.map((s, idx) => {
    const raw = rawDurations[idx];
    const isLongByDay = longSessionDay != null && s.dayOfWeek != null && ((Number(s.dayOfWeek) % 7) + 7) % 7 === longSessionDay;
    const isLongByMinutes = raw >= longSessionThresholdMinutes;
    const inc = isLongByDay || isLongByMinutes ? DEFAULT_LONG_INCREMENT_MINUTES : DEFAULT_SHORT_INCREMENT_MINUTES;
    return {
      durationMinutes: roundToIncrementMinutes(raw, inc),
      locked: Boolean(s.locked),
    };
  });

  let finalTotalMinutes = rounded.reduce((sum, s) => sum + s.durationMinutes, 0);
  let delta = targetTotalMinutes - finalTotalMinutes;

  // Best-effort rebalance of the weekly total by nudging unlocked sessions.
  // We keep everything on 5-min boundaries, and long sessions only move by 10.
  const maxIters = 10_000;
  let iters = 0;

  while (delta !== 0 && iters < maxIters) {
    iters += 1;

    const needsAdd = delta > 0;

    // Prefer adjusting short sessions in 5-minute steps.
    const shortIdx = rounded.findIndex((s, i) => {
      if (s.locked) return false;
      const minutes = s.durationMinutes;
      const isLong = minutes >= longSessionThresholdMinutes;
      if (isLong) return false;
      return needsAdd ? true : minutes >= DEFAULT_SHORT_INCREMENT_MINUTES;
    });

    if (shortIdx !== -1) {
      const step = DEFAULT_SHORT_INCREMENT_MINUTES;
      if (needsAdd) {
        rounded[shortIdx].durationMinutes += step;
        delta -= step;
      } else {
        rounded[shortIdx].durationMinutes -= step;
        delta += step;
      }
      continue;
    }

    // Then adjust long sessions in 10-minute steps.
    const longIdx = rounded.findIndex((s) => {
      if (s.locked) return false;
      const minutes = s.durationMinutes;
      const isLong = minutes >= longSessionThresholdMinutes;
      if (!isLong) return false;
      return needsAdd ? true : minutes >= DEFAULT_LONG_INCREMENT_MINUTES;
    });

    if (longIdx !== -1) {
      const step = DEFAULT_LONG_INCREMENT_MINUTES;
      if (needsAdd) {
        rounded[longIdx].durationMinutes += step;
        delta -= step;
      } else {
        rounded[longIdx].durationMinutes -= step;
        delta += step;
      }
      continue;
    }

    // No adjustable sessions left; stop.
    break;
  }

  finalTotalMinutes = rounded.reduce((sum, s) => sum + s.durationMinutes, 0);

  return {
    sessions: rounded.map((s) => ({ durationMinutes: s.durationMinutes })),
    targetTotalMinutes,
    finalTotalMinutes,
  };
}

export function normalizeDraftPlanJsonDurations<T extends {
  setup?: { longSessionDay?: number | null };
  weeks: Array<{
    weekIndex: number;
    locked: boolean;
    sessions: Array<{
      ordinal: number;
      dayOfWeek: number;
      discipline: string;
      type: string;
      durationMinutes: number;
      notes?: string | null;
      locked: boolean;
    }>;
  }>;
}>(params: { setup: { longSessionDay?: number | null }; planJson: T }): T {
  const longSessionDay = params.setup?.longSessionDay ?? null;

  const nextWeeks = params.planJson.weeks.map((w) => {
    const normalized = normalizeWeekDurations({
      sessions: w.sessions.map((s) => ({ durationMinutes: s.durationMinutes, locked: s.locked, dayOfWeek: s.dayOfWeek })),
      longSessionDay,
    });
    const nextSessions = w.sessions.map((s, idx) => ({
      ...s,
      durationMinutes: normalized.sessions[idx]?.durationMinutes ?? s.durationMinutes,
    }));

    return { ...w, sessions: nextSessions };
  });

  return { ...params.planJson, weeks: nextWeeks };
}
