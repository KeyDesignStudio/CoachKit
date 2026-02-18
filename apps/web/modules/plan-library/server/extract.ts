import pdfParse from 'pdf-parse';

import type { PlanPhase, PlanSourceDiscipline, RuleType } from '@prisma/client';
import { compilePlanLogicGraph } from './logic-compiler';

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

const WEEK_REGEX = /\bweek\s*(\d{1,2})\b/i;
const MINUTES_REGEX = /(\d{1,4})\s*(min|mins|minutes)\b/i;
const KM_REGEX = /(\d+(?:\.\d+)?)\s*km\b/i;

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

function detectDiscipline(line: string): PlanSourceDiscipline | null {
  for (const rule of DISCIPLINE_RULES) {
    if (rule.match.test(line)) return rule.key;
  }
  return null;
}

function detectSessionType(line: string): string {
  for (const rule of SESSION_TYPE_KEYWORDS) {
    if (rule.match.test(line)) return rule.key;
  }
  return 'endurance';
}

function parseMinutes(line: string): number | null {
  const match = line.match(MINUTES_REGEX);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseDistanceKm(line: string): number | null {
  const match = line.match(KM_REGEX);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text ?? '';
}

export function extractFromRawText(rawText: string, durationWeeks?: number | null): ExtractedPlanSource {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const weeks: ExtractedWeekTemplate[] = [];
  const sessions: ExtractedSessionTemplate[] = [];
  const warnings: string[] = [];

  let currentWeekIndex: number | null = null;
  const sessionCountByWeek = new Map<number, number>();

  for (const line of lines) {
    const weekMatch = line.match(WEEK_REGEX);
    if (weekMatch) {
      const weekNumber = Number(weekMatch[1]);
      if (Number.isFinite(weekNumber) && weekNumber > 0) {
        currentWeekIndex = weekNumber - 1;
        if (!weeks.some((w) => w.weekIndex === currentWeekIndex)) {
          weeks.push({ weekIndex: currentWeekIndex, notes: line });
        }
        continue;
      }
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
      notes: line,
    });
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
    },
    weeks,
    sessions,
    rules: compiled.rules,
    warnings,
    confidence,
  };
}
