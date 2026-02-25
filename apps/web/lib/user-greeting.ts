export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

function resolveTimeZoneOrFallback(timeZone?: string | null): string | undefined {
  const candidate = String(timeZone ?? '').trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      // ignore invalid timezone and fall through
    }
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function getTimeOfDay(timeZone?: string | null): TimeOfDay {
  const resolvedTz = resolveTimeZoneOrFallback(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', resolvedTz ? { hour: 'numeric', hour12: false, timeZone: resolvedTz } : { hour: 'numeric', hour12: false });

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
  "G'day {firstName}. Start this morning with calm focus and let consistency carry you.",
  "G'day {firstName}. One disciplined session this morning can set the tone for your whole day.",
  "G'day {firstName}. Build confidence this morning through simple, repeatable habits.",
  "G'day {firstName}. Keep your effort smooth this morning and your recovery deliberate.",
  "G'day {firstName}. A clear plan and steady breathing this morning are powerful tools.",
  "G'day {firstName}. This morning is ideal for quality movement and clean execution.",
  "G'day {firstName}. Mental clarity first this morning; performance usually follows.",
  "G'day {firstName}. A focused start this morning creates momentum you can trust.",
];

const AFTERNOON_TEMPLATES = [
  "G'day {firstName}. Keep this afternoon simple: execute well, then recover with intent.",
  "G'day {firstName}. Smart pacing this afternoon will beat forced intensity every time.",
  "G'day {firstName}. If energy dips this afternoon, reduce the load but protect the routine.",
  "G'day {firstName}. This afternoon is a chance to sharpen focus and stack quality work.",
  "G'day {firstName}. Build momentum this afternoon with control, not rush.",
  "G'day {firstName}. A composed afternoon session can strengthen both confidence and form.",
  "G'day {firstName}. Good decisions this afternoon will improve tomorrow's readiness.",
  "G'day {firstName}. Stay patient this afternoon and let consistency do the heavy lifting.",
];

const EVENING_TEMPLATES = [
  "G'day {firstName}. Finish this evening with purpose and set up tomorrow with quality recovery.",
  "G'day {firstName}. Be proud of today's effort and protect your sleep tonight.",
  "G'day {firstName}. Use this evening to reset: hydrate well and let adaptation happen.",
  "G'day {firstName}. Evening discipline counts; recovery is where progress is built.",
  "G'day {firstName}. A calm evening routine can sharpen both focus and resilience.",
  "G'day {firstName}. Close this evening strong by choosing consistency over perfection.",
  "G'day {firstName}. Keep tonight simple: recover well, then arrive ready tomorrow.",
  "G'day {firstName}. Your best next session starts with what you do this evening.",
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
  const resolvedTz = resolveTimeZoneOrFallback(params.timeZone);
  const dayKey = new Intl.DateTimeFormat(
    'en-CA',
    resolvedTz
      ? {
          timeZone: resolvedTz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }
      : {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }
  ).format(new Date());
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
  body = body.replace(/\b(today|tonight|morning|afternoon|evening)(rest|recover|hydrate|breathe|reset|focus|stay|keep)\b/gi, '$1. $2');

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
