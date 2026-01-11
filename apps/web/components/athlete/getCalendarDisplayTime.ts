type CalendarItemLike = {
  date: string;
  status: string;
  plannedStartTimeLocal: string | null;
  latestCompletedActivity?: {
    startTime?: string | Date;
    source?: string;
  } | null;
};

function getZonedDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatZonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

function getItemDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.includes('T')) return value.split('T')[0];
  // Fallback: parse and derive UTC date (should be rare).
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return value;
}

/**
 * Calendar display time rule (athlete timezone):
 * - SKIPPED: planned time
 * - Completed (MANUAL/STRAVA): actual start time
 * - Future day: planned time
 * - Past/no completion: planned time (for now)
 */
export function getCalendarDisplayTime(item: CalendarItemLike, athleteTimezone: string, now: Date = new Date()): string | null {
  const planned = item.plannedStartTimeLocal;

  if (item.status === 'SKIPPED') return planned;

  const actualStart = item.latestCompletedActivity?.startTime;
  if (actualStart) {
    const instant = actualStart instanceof Date ? actualStart : new Date(actualStart);
    if (!Number.isNaN(instant.getTime())) {
      return formatZonedTime(instant, athleteTimezone);
    }
  }

  const itemDayKey = getItemDateKey(item.date);
  const todayKey = getZonedDateKey(now, athleteTimezone);
  const isFuture = itemDayKey > todayKey;

  if (isFuture) return planned;

  return planned;
}

export function getZonedDateKeyForNow(timeZone: string, now: Date = new Date()): string {
  return getZonedDateKey(now, timeZone);
}
