import pdfParse from 'pdf-parse';

import type { PlanPhase, PlanSourceDiscipline, RuleType } from '@prisma/client';
import { compilePlanLogicGraph } from './logic-compiler';
import { parseWorkoutRecipeFromSessionText } from './workout-recipe-parser';
import { segmentPlanDocument } from './document-segmentation';
import { normalizeDistanceUnitsToKm, parseDistanceKm } from './distance-utils';

export type ExtractedWeekTemplate = {
  weekIndex: number;
  phase?: PlanPhase | null;
  totalMinutes?: number | null;
  totalSessions?: number | null;
  notes?: string | null;
};

export type ExtractedSessionTemplate = {
  weekIndex: number;
  ordinal: number;
  dayOfWeek?: number | null;
  discipline: PlanSourceDiscipline;
  sessionType: string;
  title?: string | null;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  intensityType?: string | null;
  intensityTargetJson?: unknown | null;
  recipeV2Json?: unknown | null;
  parserConfidence?: number | null;
  parserWarningsJson?: unknown | null;
  structureJson?: unknown | null;
  notes?: string | null;
};

export type ExtractedRule = {
  ruleType: RuleType;
  phase?: PlanPhase | null;
  appliesJson: unknown;
  ruleJson: unknown;
  explanation: string;
  priority: number;
};

export type ExtractedPlanSource = {
  rawText: string;
  rawJson: unknown | null;
  weeks: ExtractedWeekTemplate[];
  sessions: ExtractedSessionTemplate[];
  rules: ExtractedRule[];
  warnings: string[];
  confidence: number;
};

type SessionCandidate = {
  discipline: PlanSourceDiscipline;
  lines: string[];
  weekIndex: number | null;
  dayOfWeek: number | null;
};

const WEEK_REGEX = /\b(?:week|w)\s*0?(\d{1,2})\b/gi;
const MINUTES_RANGE_REGEX =
  /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i;
const MINUTES_REGEX = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i;
const BULLET_REGEX = /[\u2022\u2023\u25e6\u2043\u2219\uf0b7]/g;
const FRACTION_HALF_REGEX = /\u00bd/g;
const FRACTION_QUARTER_REGEX = /\u00bc/g;
const FRACTION_THREE_QUARTERS_REGEX = /\u00be/g;
const DAY_LABELS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const DISCIPLINE_RULES: Array<{ key: PlanSourceDiscipline; match: RegExp }> = [
  { key: 'SWIM', match: /\bswim\b/i },
  { key: 'BIKE', match: /\bbike\b|\bcycle\b/i },
  { key: 'RUN', match: /\brun\b/i },
  { key: 'STRENGTH', match: /\bstrength\b|\bgym\b/i },
  { key: 'REST', match: /\brest\b|\boff\b/i },
];

const SESSION_TYPE_KEYWORDS: Array<{ key: string; match: RegExp }> = [
  { key: 'long', match: /\blong\b/i },
  { key: 'tempo', match: /\btempo\b/i },
  { key: 'threshold', match: /\bthreshold\b|\blactate\b/i },
  { key: 'vo2', match: /\bvo2\b|\binterval\b/i },
  { key: 'easy', match: /\beasy\b|\brecovery\b/i },
  { key: 'technique', match: /\btechnique\b|\bdrill\b/i },
];

const STRUCTURED_SESSION_HEADER_RULES: Array<{ key: PlanSourceDiscipline; match: RegExp }> = [
  { key: 'SWIM', match: /^(swim)\b/i },
  { key: 'BIKE', match: /^(bike|cycling?)\b/i },
  { key: 'RUN', match: /^(run|run\/walk|jog)\b/i },
  { key: 'STRENGTH', match: /^(strength|s&c|conditioning)\b/i },
  { key: 'REST', match: /^(rest(?: |-)?day|off)\b/i },
];

function normalizeLine(line: string) {
  return line
    .replace(BULLET_REGEX, '-')
    .replace(FRACTION_HALF_REGEX, '0.5')
    .replace(FRACTION_QUARTER_REGEX, '0.25')
    .replace(FRACTION_THREE_QUARTERS_REGEX, '0.75')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function toMinutes(value: number, unit: string) {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith('h')) return value * 60;
  return value;
}

function detectDiscipline(line: string): PlanSourceDiscipline | null {
  for (const rule of DISCIPLINE_RULES) {
    if (rule.match.test(line)) return rule.key;
  }
  return null;
}

function detectSessionType(line: string): string {
  if (/\bbrick\b/i.test(line)) return 'brick';
  if (/\brun\/walk\b/i.test(line)) return 'run-walk';
  if (/\btime trial\b|\btt\b/i.test(line)) return 'time-trial';
  for (const rule of SESSION_TYPE_KEYWORDS) {
    if (rule.match.test(line)) return rule.key;
  }
  return 'endurance';
}

function parseMinutes(line: string): number | null {
  const normalized = normalizeLine(line).replace(/,/g, '');
  const sharedUnitRangeMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i
  );
  if (sharedUnitRangeMatch) {
    const start = toMinutes(Number(sharedUnitRangeMatch[1]), sharedUnitRangeMatch[3]);
    const end = toMinutes(Number(sharedUnitRangeMatch[2]), sharedUnitRangeMatch[3]);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.round((start + end) / 2);
  }

  const rangeMatch = normalized.match(MINUTES_RANGE_REGEX);
  if (rangeMatch) {
    const start = toMinutes(Number(rangeMatch[1]), rangeMatch[2]);
    const end = toMinutes(Number(rangeMatch[3]), rangeMatch[4]);
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.round((start + end) / 2);
  }

  const match = normalized.match(MINUTES_REGEX);
  if (!match) return null;
  const value = toMinutes(Number(match[1]), match[2]);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function extractWeekIndices(line: string) {
  const values = [...normalizeLine(line).matchAll(WEEK_REGEX)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => value - 1);
  return Array.from(new Set(values));
}

function extractDayOfWeek(line: string) {
  const normalized = normalizeLine(line).toLowerCase();
  if (!normalized) return null;
  if (Object.prototype.hasOwnProperty.call(DAY_LABELS, normalized)) return DAY_LABELS[normalized];
  return null;
}

function detectStructuredSessionHeader(line: string): PlanSourceDiscipline | null {
  const normalized = normalizeLine(line);
  if (!normalized) return null;
  const headerLike =
    /^[A-Z/& -]{2,24}$/.test(normalized) ||
    /[:,]/.test(normalized) ||
    /\d/.test(normalized) ||
    /\brun\/walk\b|\beasy\b|\bsteady\b|\btempo\b|\bthreshold\b|\blong\b|\btechnique\b|\bdrill\b|\bbuild\b|\bbrick\b|\btime trial\b/i.test(normalized);
  if (!headerLike) return null;
  if (/we recommend|before you|this plan|please read|training tips|cross training/i.test(normalized)) return null;
  if (/=/.test(normalized)) return null;
  for (const rule of STRUCTURED_SESSION_HEADER_RULES) {
    if (rule.match.test(normalized)) return rule.key;
  }
  return null;
}

function assignInferredWeekIndices(candidates: SessionCandidate[], durationWeeks: number | null | undefined, warnings: string[]) {
  const unresolved = candidates.filter((candidate) => candidate.weekIndex == null);
  if (!unresolved.length) return;

  if (durationWeeks && durationWeeks > 0 && unresolved.length >= durationWeeks && unresolved.length % durationWeeks === 0) {
    unresolved.forEach((candidate, index) => {
      candidate.weekIndex = index % durationWeeks;
    });
    warnings.push('No explicit week markers found for some sessions; week assignment was inferred round-robin across the declared duration.');
    return;
  }

  unresolved.forEach((candidate) => {
    candidate.weekIndex = 0;
  });
  warnings.push('No explicit week markers found for some sessions; they were assigned to week 1 by default.');
}

function extractStructuredSessionCandidates(lines: string[], durationWeeks: number | null | undefined, warnings: string[]) {
  const candidates: SessionCandidate[] = [];
  let currentWeekIndex: number | null = null;
  let currentDayOfWeek: number | null = null;
  let current: SessionCandidate | null = null;

  const finalize = () => {
    if (!current) return;
    current.lines = current.lines.map(normalizeLine).filter(Boolean);
    if (current.lines.length) candidates.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    const dayOfWeek = extractDayOfWeek(line);
    if (dayOfWeek != null) {
      currentDayOfWeek = dayOfWeek;
      continue;
    }

    const weekIndices = extractWeekIndices(line);
    if (weekIndices.length === 1) {
      currentWeekIndex = weekIndices[0] ?? null;
      continue;
    }

    const headerDiscipline = detectStructuredSessionHeader(line);
    if (headerDiscipline) {
      finalize();
      current = {
        discipline: headerDiscipline,
        lines: [line],
        weekIndex: currentWeekIndex,
        dayOfWeek: currentDayOfWeek,
      };
      continue;
    }

    if (current) current.lines.push(line);
  }

  finalize();
  assignInferredWeekIndices(candidates, durationWeeks, warnings);
  return candidates;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text ?? '';
}

export function extractFromRawText(rawText: string, durationWeeks?: number | null): ExtractedPlanSource {
  const segmented = segmentPlanDocument(rawText);
  const lines = segmented.filteredLines;

  const weeks: ExtractedWeekTemplate[] = [];
  const sessions: ExtractedSessionTemplate[] = [];
  const warnings: string[] = [...segmented.warnings];
  const sessionCountByWeek = new Map<number, number>();
  const structuredCandidates = extractStructuredSessionCandidates(lines, durationWeeks, warnings);

  for (const candidate of structuredCandidates) {
    const weekIndex = candidate.weekIndex ?? 0;
    if (!weeks.some((week) => week.weekIndex === weekIndex)) {
      weeks.push({ weekIndex, notes: candidate.lines[0] ?? null });
    }

    const sessionText = normalizeDistanceUnitsToKm(candidate.lines.join('\n').trim());
    const sessionType = detectSessionType(sessionText);
    const parsed = parseWorkoutRecipeFromSessionText({
      discipline: candidate.discipline,
      sessionType,
      sessionText,
      title: candidate.lines[0] ?? null,
      durationMinutes: parseMinutes(sessionText),
    });

    const ordinal = (sessionCountByWeek.get(weekIndex) ?? 0) + 1;
    sessionCountByWeek.set(weekIndex, ordinal);

    if (parsed.warnings.length) {
      warnings.push(...parsed.warnings.map((warning) => `Session ${ordinal} week ${weekIndex + 1}: ${warning}`));
    }

    sessions.push({
      weekIndex,
      ordinal,
      dayOfWeek: candidate.dayOfWeek,
      discipline: candidate.discipline,
      sessionType,
      title: (candidate.lines[0] ?? sessionText).slice(0, 120),
      durationMinutes: parsed.estimatedDurationMinutes ?? parseMinutes(sessionText),
      distanceKm: parseDistanceKm(sessionText),
      intensityType: parsed.intensityType ?? null,
      intensityTargetJson: parsed.intensityTargetJson ?? null,
      recipeV2Json: parsed.recipeV2 ?? null,
      parserConfidence: parsed.confidence ?? null,
      parserWarningsJson: parsed.warnings.length ? parsed.warnings : null,
      structureJson: parsed.recipeV2
        ? {
            recipeV2: parsed.recipeV2,
            parser: {
              version: 'v2',
              confidence: parsed.confidence,
              warnings: parsed.warnings,
            },
          }
        : null,
      notes: sessionText,
    });
  }

  if (!sessions.length) {
    let currentWeekIndex: number | null = null;
    for (const line of lines) {
      const weekIndices = extractWeekIndices(line);
      if (weekIndices.length === 1) {
        currentWeekIndex = weekIndices[0] ?? null;
        if (currentWeekIndex != null && !weeks.some((w) => w.weekIndex === currentWeekIndex)) {
          weeks.push({ weekIndex: currentWeekIndex, notes: line });
        }
        continue;
      }

      const discipline = detectDiscipline(line);
      if (!discipline || currentWeekIndex == null) continue;

      const ordinal = (sessionCountByWeek.get(currentWeekIndex) ?? 0) + 1;
      sessionCountByWeek.set(currentWeekIndex, ordinal);

      sessions.push({
        weekIndex: currentWeekIndex,
        ordinal,
        discipline,
        sessionType: detectSessionType(line),
        title: line.slice(0, 120),
        durationMinutes: parseMinutes(line),
        distanceKm: parseDistanceKm(line),
        notes: normalizeDistanceUnitsToKm(line),
      });
    }
  }

  if (!weeks.length) {
    if (durationWeeks && durationWeeks > 0) {
      for (let i = 0; i < durationWeeks; i += 1) {
        weeks.push({ weekIndex: i });
      }
      warnings.push('No explicit week markers found; weeks inferred from durationWeeks.');
    } else {
      warnings.push('No explicit week markers found in source text.');
    }
  }

  const compiled = compilePlanLogicGraph({
    rawText,
    weeks,
    sessions,
    durationWeeks: durationWeeks ?? null,
  });

  const confidence = Math.min(
    1,
    (weeks.length ? 0.3 : 0) + (sessions.length ? 0.3 : 0) + Math.max(0, Math.min(0.4, compiled.graph.confidence))
  );

  return {
    rawText,
    rawJson: {
      compiler: {
        version: 'v1',
        graph: compiled.graph,
      },
      segmentation: {
        version: 'v1',
        warningCount: segmented.warnings.length,
      },
    },
    weeks,
    sessions,
    rules: compiled.rules,
    warnings,
    confidence,
  };
}
