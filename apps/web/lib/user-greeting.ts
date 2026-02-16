type TimeOfDay = 'morning' | 'afternoon' | 'evening';

function getTimeOfDay(timeZone?: string | null): TimeOfDay {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timeZone || 'UTC',
  });

  const hourPart = formatter
    .formatToParts(new Date())
    .find((part) => part.type === 'hour')?.value;

  const hour = Number.parseInt(hourPart ?? '', 10);
  if (!Number.isFinite(hour)) return 'morning';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function getFirstName(name?: string | null): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] || 'there';
}

export function getWarmWelcomeMessage(params: {
  name?: string | null;
  timeZone?: string | null;
}): string {
  const firstName = getFirstName(params.name);
  const partOfDay = getTimeOfDay(params.timeZone);
  return `G'day ${firstName} Hope you're having a great ${partOfDay}`;
}

