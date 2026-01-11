import { formatTimeInTimezone } from '@/lib/formatTimeInTimezone';
import { isStravaTimeDebugEnabled } from '@/lib/debug';

type CalendarItemLike = {
  id?: string;
  date: string;
  status: string;
  plannedStartTimeLocal: string | null;
  latestCompletedActivity?: {
    effectiveStartTimeUtc?: string | Date;
    startTime?: string | Date;
    source?: string;
    startTimeUtc?: string | null;
    debug?: {
      stravaTime?: {
        tzUsed?: string;
        stravaStartDateUtcRaw?: string | null;
        stravaStartDateLocalRaw?: string | null;
        storedStartTimeUtc?: string | null;
      };
    };
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
export function getCalendarDisplayTime(
  item: CalendarItemLike,
  athleteTimezone: string,
  now: Date = new Date()
): string | null {
  const planned = item.plannedStartTimeLocal;

  if (item.status === 'SKIPPED') return planned;

  const actualStart = item.latestCompletedActivity?.effectiveStartTimeUtc ?? item.latestCompletedActivity?.startTime;
  if (actualStart) {
    const formattedLocalTime = formatTimeInTimezone(actualStart, athleteTimezone);

    // DEV-ONLY DEBUG — Strava time diagnostics
    // Never enabled in production. Do not rely on this data.
    if (isStravaTimeDebugEnabled() && typeof window !== 'undefined' && item.latestCompletedActivity?.source === 'STRAVA') {
      const key = '__ck_strava_time_debug_count__';
      const current = Number((window as any)[key] ?? 0);
      if (Number.isFinite(current) && current < 25) {
        (window as any)[key] = current + 1;
        // eslint-disable-next-line no-console
        console.log('[strava-time]', {
          itemId: item.id,
          itemDate: item.date,
          athleteTimezone,
          planned,
          actualStart,
          effectiveStartTimeUtc: item.latestCompletedActivity?.effectiveStartTimeUtc ?? null,
          stravaStartDateUtcRaw: item.latestCompletedActivity?.debug?.stravaTime?.stravaStartDateUtcRaw ?? null,
          stravaStartDateLocalRaw:
            item.latestCompletedActivity?.debug?.stravaTime?.stravaStartDateLocalRaw ?? null,
          formattedLocalTime,
        });
      }
    }

    return formattedLocalTime;
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
