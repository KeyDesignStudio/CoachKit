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

const MORNING_TEMPLATES = [
  "G'day {firstName}. Hope you're ready to make this morning count",
  "G'day {firstName}. Hope you're starting the morning strong",
  "G'day {firstName}. Hope this morning sets the tone",
  "G'day {firstName}. Hope you're feeling fresh this morning",
  "G'day {firstName}. Hope this morning builds momentum",
  "G'day {firstName}. Hope you're stepping into the morning with purpose",
  "G'day {firstName}. Hope this morning moves you forward",
  "G'day {firstName}. Hope you're focused and ready this morning",
  "G'day {firstName}. Hope this morning starts with intent",
  "G'day {firstName}. Hope you're owning the morning",
];

const AFTERNOON_TEMPLATES = [
  "G'day {firstName}. Hope your afternoon's building well",
  "G'day {firstName}. Hope you're keeping the momentum this afternoon",
  "G'day {firstName}. Hope this afternoon moves the needle",
  "G'day {firstName}. Hope you're staying sharp this afternoon",
  "G'day {firstName}. Hope your afternoon's productive and focused",
  "G'day {firstName}. Hope you're finishing strong this afternoon",
  "G'day {firstName}. Hope this afternoon brings solid progress",
  "G'day {firstName}. Hope you're staying consistent this afternoon",
  "G'day {firstName}. Hope your afternoon's lining up well",
  "G'day {firstName}. Hope you're making this afternoon count",
];

const EVENING_TEMPLATES = [
  "G'day {firstName}. Hope you're wrapping up the evening strong",
  "G'day {firstName}. Hope this evening feels productive",
  "G'day {firstName}. Hope you're proud of your effort this evening",
  "G'day {firstName}. Hope this evening helps you reset well",
  "G'day {firstName}. Hope you're finishing the day with intent",
  "G'day {firstName}. Hope this evening feels like progress",
  "G'day {firstName}. Hope you're closing out the day strong",
  "G'day {firstName}. Hope this evening gives you a solid win",
  "G'day {firstName}. Hope you're winding down with purpose this evening",
  "G'day {firstName}. Hope this evening sets you up for tomorrow",
];

function templatePoolForTimeOfDay(partOfDay: TimeOfDay): string[] {
  if (partOfDay === 'morning') return MORNING_TEMPLATES;
  if (partOfDay === 'afternoon') return AFTERNOON_TEMPLATES;
  return EVENING_TEMPLATES;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function stableTemplateIndex(params: { max: number; firstName: string; timeZone?: string | null; partOfDay: TimeOfDay }): number {
  if (params.max <= 1) return 0;
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: params.timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const seed = `${params.firstName.toLowerCase()}|${params.partOfDay}|${dayKey}`;
  return hashString(seed) % params.max;
}

export function getWarmWelcomeMessage(params: { name?: string | null; timeZone?: string | null }): string {
  const firstName = getFirstName(params.name);
  const partOfDay = getTimeOfDay(params.timeZone);
  const templates = templatePoolForTimeOfDay(partOfDay);
  const template = templates[stableTemplateIndex({ max: templates.length, firstName, timeZone: params.timeZone, partOfDay })] ?? templates[0];
  return template.replaceAll('{firstName}', firstName);
}
