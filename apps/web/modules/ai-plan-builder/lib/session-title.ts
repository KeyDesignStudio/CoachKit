export type AiPlanBuilderSessionTitleInput = {
  discipline?: string | null;
  type?: string | null;
};

function toWords(value: string): string[] {
  // Keep only letters/numbers; split on whitespace/punctuation.
  return value
    .trim()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function titleCaseWord(word: string): string {
  if (!word) return '';
  return word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseWords(words: string[]): string[] {
  return words.map(titleCaseWord).filter(Boolean);
}

function normalizeDiscipline(raw: string): string {
  const d = raw.trim().toLowerCase();
  if (!d) return '';
  if (d === 'run') return 'run';
  if (d === 'bike' || d === 'ride' || d === 'cycle') return 'bike';
  if (d === 'swim') return 'swim';
  if (d === 'brick') return 'brick';
  if (d === 'strength') return 'strength';
  if (d === 'rest') return 'rest';
  // CalendarItem disciplines are often stored as uppercase enums.
  if (d === 'run'.toUpperCase()) return 'run';
  if (d === 'bike'.toUpperCase()) return 'bike';
  if (d === 'swim'.toUpperCase()) return 'swim';
  if (d === 'brick'.toUpperCase()) return 'brick';
  if (d === 'strength'.toUpperCase()) return 'strength';
  if (d === 'rest'.toUpperCase()) return 'rest';
  return d;
}

function sportNoun(discipline: string): string {
  switch (discipline) {
    case 'run':
      return 'Run';
    case 'bike':
      return 'Ride';
    case 'swim':
      return 'Swim';
    case 'brick':
      return 'Brick';
    case 'strength':
      return 'Training';
    case 'rest':
      return 'Day';
    default:
      return 'Workout';
  }
}

function canonicalTypeToken(rawType: string): string | null {
  const t = rawType.trim().toLowerCase();
  if (!t) return null;
  if (t === 'endurance') return 'Endurance';
  if (t === 'tempo') return 'Tempo';
  if (t === 'threshold') return 'Threshold';
  if (t === 'technique') return 'Technique';
  if (t === 'recovery') return 'Recovery';
  if (t === 'strength') return 'Strength';
  if (t === 'rest') return 'Rest';
  return null;
}

function stripTrailingSessionWords(words: string[]): string[] {
  const drop = new Set(['session', 'sessions', 'workout', 'workouts', 'training', 'plan', 'planned']);
  return words.filter((w) => !drop.has(w.toLowerCase()));
}

function includesSportWord(words: string[], sport: string): boolean {
  const s = sport.toLowerCase();
  return words.some((w) => w.toLowerCase() === s);
}

/**
 * Deterministic, compact (2–4 words) titles for AI Plan Builder sessions.
 *
 * Goal: stable, scannable titles across APB cards + calendars without relying on LLM output.
 */
export function buildAiPlanBuilderSessionTitle(input: AiPlanBuilderSessionTitleInput): string {
  const discipline = normalizeDiscipline(String(input.discipline ?? ''));
  const rawType = String(input.type ?? '').trim();

  // Strong special-cases.
  if (discipline === 'rest' || rawType.trim().toLowerCase() === 'rest') return 'Rest Day';
  if (discipline === 'strength' || rawType.trim().toLowerCase() === 'strength') return 'Strength Training';

  const sport = sportNoun(discipline);

  const canonical = canonicalTypeToken(rawType);
  if (canonical) {
    // e.g. "Endurance Run" / "Technique Swim".
    // Keep exactly 2 words for scan-ability.
    return `${canonical} ${sport}`.trim();
  }

  // Unknown / free-text types: keep it stable, short, and avoid "session".
  let typeWords = stripTrailingSessionWords(toWords(rawType));
  const typeWordsTitle = titleCaseWords(typeWords);

  if (!typeWordsTitle.length) {
    return `Planned ${sport}`.trim();
  }

  // If coach typed something like "Tempo Run" already, don't double-suffix.
  const hasSport = includesSportWord(typeWordsTitle, sport);

  const maxWords = 4;
  const base = typeWordsTitle.slice(0, hasSport ? maxWords : maxWords - 1);
  const parts = hasSport ? base : [...base, sport];
  return parts.slice(0, maxWords).join(' ').trim();
}
