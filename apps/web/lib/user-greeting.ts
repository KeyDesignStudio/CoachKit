export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export function getTimeOfDay(timeZone?: string | null): TimeOfDay {
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

export function getFirstName(name?: string | null): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] || 'there';
}

const MORNING_TEMPLATES = [
  "G'day {firstName}. Start with calm focus this morning and your body and mind will thank you all day.",
  "G'day {firstName}. A steady session and a steady mind this morning can shape a strong day ahead.",
  "G'day {firstName}. Progress today comes from simple wins: breathe well, move well, recover well.",
  "G'day {firstName}. This morning is a chance to build confidence through consistent, healthy effort.",
  "G'day {firstName}. Begin with intent this morning; small disciplined choices become big results.",
];

const AFTERNOON_TEMPLATES = [
  "G'day {firstName}. Keep the afternoon simple: quality effort, good posture, and steady breathing.",
  "G'day {firstName}. Consistency this afternoon builds both physical durability and mental resilience.",
  "G'day {firstName}. If energy dips this afternoon, reduce intensity but protect your routine.",
  "G'day {firstName}. Strong afternoons are built on smart pacing, not forcing every rep.",
  "G'day {firstName}. Keep momentum this afternoon with focused work and deliberate recovery choices.",
];

const EVENING_TEMPLATES = [
  "G'day {firstName}. This evening, a calm finish and good recovery habits set up tomorrow's performance.",
  "G'day {firstName}. Be proud of the effort today; quality rest tonight is part of elite preparation.",
  "G'day {firstName}. Use tonight to reset: hydrate, breathe, and let your body adapt to today's work.",
  "G'day {firstName}. Evening discipline matters too; recovery is where training becomes progress.",
  "G'day {firstName}. Finish the day with purpose and give your mind and body space to recharge.",
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

export function sanitizeAiGreeting(params: {
  rawGreeting: string;
  firstName: string;
  timeOfDay: TimeOfDay;
  completedToday?: number;
  scheduledToday?: number;
  role?: string;
}): string {
  const suffixByTime: Record<TimeOfDay, string> = {
    morning: 'this morning',
    afternoon: 'this afternoon',
    evening: 'this evening',
  };

  const cleaned = String(params.rawGreeting ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

  if (!cleaned) {
    return getWarmWelcomeMessage({ name: params.firstName });
  }

  const normalizedPrefix = `G'day ${params.firstName}.`;
  let body = cleaned.replace(/^g['’]day\b[^.]*\.\s*/i, '');
  body = body.replace(/^[-:,. ]+/, '').trim();
  if (!body) body = `Hope you're taking care of your body and mind ${suffixByTime[params.timeOfDay]}.`;

  // Fix merged sentence boundaries like "...todayrest..." from model output.
  body = body.replace(/([a-z])([A-Z][a-z])/g, '$1. $2');

  const withTimeAnchor = body.toLowerCase().includes('morning') || body.toLowerCase().includes('afternoon') || body.toLowerCase().includes('evening')
    ? body
    : `${body} ${suffixByTime[params.timeOfDay]}.`;

  let finalBody = withTimeAnchor.trim();
  if (!/[.!?]$/.test(finalBody)) finalBody = `${finalBody}.`;

  const completedToday = Math.max(0, Number(params.completedToday ?? 0));
  const scheduledToday = Math.max(0, Number(params.scheduledToday ?? 0));
  const role = String(params.role ?? '').toLowerCase();
  const mentionsWorkoutToday =
    /\b(session|sessions|workout|workouts|training)\b/i.test(finalBody) &&
    /\btoday|tonight|this morning|this afternoon|this evening\b/i.test(finalBody);
  if (role === 'athlete' && completedToday === 0 && scheduledToday === 0 && mentionsWorkoutToday) {
    return getWarmWelcomeMessage({ name: params.firstName });
  }

  return `${normalizedPrefix} ${finalBody}`.slice(0, 220);
}
