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

function getDatePartsAu(date: Date, timeZone?: string): { day: string; month: string; monthLong: string; year: string; weekdayLong: string } | null {
  if (Number.isNaN(date.getTime())) return null;

  const numericParts = new Intl.DateTimeFormat('en-AU', {
    timeZone: timeZone || undefined,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(date);

  const longParts = new Intl.DateTimeFormat('en-AU', {
    timeZone: timeZone || undefined,
    weekday: 'long',
    month: 'long',
    year: 'numeric',
    day: '2-digit',
  }).formatToParts(date);

  const day = numericParts.find((p) => p.type === 'day')?.value;
  const month = numericParts.find((p) => p.type === 'month')?.value;
  const year = numericParts.find((p) => p.type === 'year')?.value;
  const monthLong = longParts.find((p) => p.type === 'month')?.value;
  const weekdayLong = longParts.find((p) => p.type === 'weekday')?.value;
  const dayLong = longParts.find((p) => p.type === 'day')?.value;
  const yearLong = longParts.find((p) => p.type === 'year')?.value;

  if (!day || !month || !year || !monthLong || !weekdayLong || !dayLong || !yearLong) return null;
  return { day: dayLong, month, monthLong, year: yearLong, weekdayLong };
}

export function formatDateShortAu(date: Date, timeZone?: string): string {
  const parts = getDatePartsAu(date, timeZone);
  if (!parts) return '';
  const yy = parts.year.slice(-2);
  return `${parts.day}/${parts.month}/${yy}`;
}

export function formatDateLongAu(date: Date, timeZone?: string): string {
  const parts = getDatePartsAu(date, timeZone);
  if (!parts) return '';
  return `${parts.weekdayLong}, ${parts.day}/${parts.monthLong}/${parts.year}`;
}

export function formatDisplay(dateIso: string): string {
  const date = new Date(dateIso);
  return formatDateShortAu(date) || dateIso;
}

export function formatDisplayInTimeZone(dateIso: string, timeZone?: string): string {
  // dateIso is expected to be a YYYY-MM-DD string.
  // Use UTC midnight as a stable anchor and then format into the requested timezone.
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return formatDisplay(dateIso);

  return formatDateShortAu(date, timeZone) || formatDisplay(dateIso);
}

export function formatDayMonthYearInTimeZone(dateIso: string, timeZone?: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return formatDateLongAu(date, timeZone) || dateIso;
}

export function formatWeekOfLabel(weekStartIso: string, timeZone?: string): string {
  // weekStartIso is expected to be a YYYY-MM-DD string.
  // We use UTC midnight as a stable anchor and then format into the requested timezone.
  const date = new Date(`${weekStartIso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return `Week of ${weekStartIso}`;

  const formatted = formatDateLongAu(date, timeZone);
  if (!formatted) return `Week of ${weekStartIso}`;
  return `Week of ${formatted}`;
}
