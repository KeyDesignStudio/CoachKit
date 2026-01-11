type SortableSession = {
  id: string;
  title: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  latestCompletedActivity?: {
    effectiveStartTimeUtc?: string | Date;
    startTime?: string | Date;
  } | null;
};

function parseTimeToMinutes(value: string): number | null {
  // Accept "HH:MM" or "H:MM".
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getZonedMinutes(instant: Date, timeZone: string): number | null {
  if (Number.isNaN(instant.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hours = Number(lookup.hour);
  const minutes = Number(lookup.minute);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getSortableMinutes(item: SortableSession, timeZone: string): number | null {
  const actualStart = item.latestCompletedActivity?.effectiveStartTimeUtc ?? item.latestCompletedActivity?.startTime;
  if (actualStart) {
    const instant = actualStart instanceof Date ? actualStart : new Date(actualStart);
    const zonedMinutes = getZonedMinutes(instant, timeZone);
    if (zonedMinutes != null) return zonedMinutes;
  }

  const planned = item.plannedStartTimeLocal;
  if (planned) {
    const plannedMinutes = parseTimeToMinutes(planned);
    if (plannedMinutes != null) return plannedMinutes;
  }

  return null;
}

function compareNullableStrings(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/**
 * Sort sessions within a day by what the athlete sees:
 * 1) Non-REST before REST
 * 2) Actual start time (zoned) if available, else planned time
 * 3) Null times last
 * 4) Tie-breakers: plannedStartTimeLocal, title, id
 */
export function sortSessionsForDay<T extends SortableSession>(items: T[], athleteTimezone: string): T[] {
  return [...items].sort((a, b) => {
    const aIsRest = a.discipline === 'REST';
    const bIsRest = b.discipline === 'REST';
    if (aIsRest !== bIsRest) return aIsRest ? 1 : -1;

    const aMinutes = getSortableMinutes(a, athleteTimezone);
    const bMinutes = getSortableMinutes(b, athleteTimezone);

    if (aMinutes == null && bMinutes != null) return 1;
    if (aMinutes != null && bMinutes == null) return -1;
    if (aMinutes != null && bMinutes != null && aMinutes !== bMinutes) return aMinutes - bMinutes;

    const plannedTie = compareNullableStrings(a.plannedStartTimeLocal, b.plannedStartTimeLocal);
    if (plannedTie !== 0) return plannedTie;

    const titleTie = (a.title || '').localeCompare(b.title || '');
    if (titleTie !== 0) return titleTie;

    return a.id.localeCompare(b.id);
  });
}
