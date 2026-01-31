export type WeekStart = 'monday' | 'sunday';

export const DAY_NAMES_SUN0 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function normalizeWeekStart(value: unknown): WeekStart {
  return value === 'sunday' ? 'sunday' : 'monday';
}

export function orderedDayIndices(weekStart: WeekStart): number[] {
  return weekStart === 'monday' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Converts a JS day index (0=Sun..6=Sat) into an offset within the week,
 * where offset 0 is the configured week start.
 */
export function dayOffsetFromWeekStart(dayOfWeek: number, weekStart: WeekStart): number {
  const d = ((Number(dayOfWeek) % 7) + 7) % 7;
  if (weekStart === 'sunday') return d;
  // Monday-start: Mon(1)->0 ... Sun(0)->6
  return (d + 6) % 7;
}

export function daySortKey(dayOfWeek: number, weekStart: WeekStart): number {
  return dayOffsetFromWeekStart(dayOfWeek, weekStart);
}

export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  const startJsDay = weekStart === 'sunday' ? 0 : 1;
  const diff = (jsDay - startJsDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
