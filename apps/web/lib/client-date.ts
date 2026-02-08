export function startOfWeek(date = new Date()): Date {
  const clone = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = clone.getUTCDay();
  const diffToMonday = (weekday + 6) % 7;
  clone.setUTCDate(clone.getUTCDate() - diffToMonday);
  return clone;
}

export function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDisplay(dateIso: string): string {
  const date = new Date(dateIso);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDisplayInTimeZone(dateIso: string, timeZone?: string): string {
  // dateIso is expected to be a YYYY-MM-DD string.
  // Use UTC midnight as a stable anchor and then format into the requested timezone.
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return formatDisplay(dateIso);

  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone || undefined,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDayMonthYearInTimeZone(dateIso: string, timeZone?: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateIso;

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const parts = formatter.formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;

  const fallback = formatter.format(date);
  const formatted = day && month && year ? `${day} ${month} ${year}` : fallback;
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || undefined,
    weekday: 'short',
  }).format(date);

  const stripped = formatted.replace(new RegExp(`^${weekday}\\s+`, 'i'), '').trim();
  return /\b\d{4}\b/.test(stripped) || !(day && month && year) ? stripped : `${day} ${month} ${year}`;
}

function getOrdinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function formatWeekOfLabel(weekStartIso: string, timeZone?: string): string {
  // weekStartIso is expected to be a YYYY-MM-DD string.
  // We use UTC midnight as a stable anchor and then format into the requested timezone.
  const date = new Date(`${weekStartIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return `Week of ${weekStartIso}`;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || undefined,
    month: 'long',
    day: 'numeric',
  }).formatToParts(date);

  const month = parts.find((p) => p.type === 'month')?.value;
  const dayStr = parts.find((p) => p.type === 'day')?.value;
  const day = dayStr ? Number(dayStr) : NaN;
  if (!month || !Number.isFinite(day)) return `Week of ${weekStartIso}`;

  return `Week of ${month} ${day}${getOrdinalSuffix(day)}`;
}
