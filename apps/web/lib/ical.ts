type IcsEvent = {
  uid: string;
  dtStartUtc: Date;
  dtEndUtc: Date;
  summary: string;
  description?: string | null;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatUtcDateTime(value: Date): string {
  return (
    value.getUTCFullYear() +
    pad2(value.getUTCMonth() + 1) +
    pad2(value.getUTCDate()) +
    'T' +
    pad2(value.getUTCHours()) +
    pad2(value.getUTCMinutes()) +
    pad2(value.getUTCSeconds()) +
    'Z'
  );
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line: string, limit = 75): string {
  if (line.length <= limit) return line;

  const parts: string[] = [];
  let remaining = line;

  while (remaining.length > limit) {
    parts.push(remaining.slice(0, limit));
    remaining = ' ' + remaining.slice(limit);
  }

  parts.push(remaining);
  return parts.join('\r\n');
}

function emitLine(lines: string[], line: string) {
  lines.push(foldIcsLine(line));
}

export function buildIcsCalendar(params: {
  timeZone: string;
  calName: string;
  nowUtc?: Date;
  events: IcsEvent[];
}): string {
  const now = params.nowUtc ?? new Date();

  const lines: string[] = [];
  emitLine(lines, 'BEGIN:VCALENDAR');
  emitLine(lines, 'VERSION:2.0');
  emitLine(lines, 'PRODID:-//CoachKit//EN');
  emitLine(lines, 'CALSCALE:GREGORIAN');
  emitLine(lines, 'METHOD:PUBLISH');
  emitLine(lines, `X-WR-CALNAME:${escapeIcsText(params.calName)}`);
  emitLine(lines, `X-WR-TIMEZONE:${escapeIcsText(params.timeZone)}`);

  for (const event of params.events) {
    emitLine(lines, 'BEGIN:VEVENT');
    emitLine(lines, `UID:${escapeIcsText(event.uid)}`);
    emitLine(lines, `DTSTAMP:${formatUtcDateTime(now)}`);
    emitLine(lines, `DTSTART:${formatUtcDateTime(event.dtStartUtc)}`);
    emitLine(lines, `DTEND:${formatUtcDateTime(event.dtEndUtc)}`);
    emitLine(lines, `SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description) {
      emitLine(lines, `DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    emitLine(lines, 'END:VEVENT');
  }

  emitLine(lines, 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
