export function formatTimeInTimezone(dateUtc: string | Date | undefined | null, timeZone: string): string | null {
  if (!dateUtc) return null;
  const date = dateUtc instanceof Date ? dateUtc : new Date(dateUtc);
  if (Number.isNaN(date.getTime())) return null;

  const format = (tz?: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

  try {
    return format(timeZone);
  } catch {
    // Invalid timeZone or Intl failure: fall back to runtime default.
    return format(undefined);
  }
}
