import type { PlanPhase, PlanSourceDiscipline, RuleType } from '@prisma/client';

import { compilePlanLogicGraph } from './logic-compiler';
import { parseWorkoutRecipeFromSessionText } from './workout-recipe-parser';
import { segmentPlanDocument } from './document-segmentation';
import { normalizeDistanceUnitsToKm, parseDistanceKm } from './distance-utils';
import {
  getWeeklyGridCellBox,
  parseLayoutFamilyRules,
  type LayoutFamilyRules,
  type LayoutRuleSourceAnnotation,
} from './layout-rules';
import { extractStructuredPdfDocument, extractTextFromPageRegion, type ExtractedPdfDocument } from './pdf-layout';

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

type FinalizeExtractedPlanSourceParams = {
  rawText: string;
  weeks: ExtractedWeekTemplate[];
  sessions: ExtractedSessionTemplate[];
  warnings: string[];
  durationWeeks?: number | null;
  rawJsonExtra?: Record<string, unknown>;
  confidenceBias?: number;
};

type BuildSessionTemplateParams = {
  weekIndex: number;
  ordinal: number;
  dayOfWeek?: number | null;
  discipline: PlanSourceDiscipline;
  sessionText: string;
  title?: string | null;
};

export type ManualSessionTemplateFields = {
  sessionType: string;
  intensityType: string | null;
  intensityTargetJson: unknown | null;
  recipeV2Json: unknown | null;
  parserConfidence: number;
  parserWarningsJson: unknown | null;
  structureJson: unknown | null;
  notes: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
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
  { key: 'STRENGTH', match: /\bstrength\b|\bgym\b|\bs&c\b|\bconditioning\b|\byoga\b/i },
  { key: 'REST', match: /\brest\b|\boff\b|\brecovery\b/i },
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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

function buildSessionTemplate(params: BuildSessionTemplateParams) {
  const sessionText = normalizeDistanceUnitsToKm(params.sessionText.trim());
  const sessionType = detectSessionType(sessionText);
  const parsed = parseWorkoutRecipeFromSessionText({
    discipline: params.discipline,
    sessionType,
    sessionText,
    title: params.title ?? null,
    durationMinutes: parseMinutes(sessionText),
  });

  return {
    session: {
      weekIndex: params.weekIndex,
      ordinal: params.ordinal,
      dayOfWeek: params.dayOfWeek ?? null,
      discipline: params.discipline,
      sessionType,
      title: (params.title ?? sessionText).slice(0, 120),
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
    } satisfies ExtractedSessionTemplate,
    warnings: parsed.warnings,
  };
}

export function deriveManualSessionTemplateFields(params: {
  discipline: PlanSourceDiscipline;
  title?: string | null;
  notes?: string | null;
  sessionType?: string | null;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  editor?: { email: string; editedAt?: string };
}): ManualSessionTemplateFields {
  const normalizedTitle = params.title?.trim() || null;
  const normalizedNotes = normalizeDistanceUnitsToKm(params.notes?.trim() || '');
  const composedText = [normalizedTitle, normalizedNotes].filter(Boolean).join('\n').trim();
  const built = buildSessionTemplate({
    weekIndex: 0,
    ordinal: 1,
    discipline: params.discipline,
    sessionText: composedText || normalizedTitle || '',
    title: normalizedTitle,
  });

  return {
    sessionType: params.sessionType?.trim() || built.session.sessionType,
    intensityType: built.session.intensityType ?? null,
    intensityTargetJson: built.session.intensityTargetJson ?? null,
    recipeV2Json: built.session.recipeV2Json ?? null,
    parserConfidence: 1,
    parserWarningsJson: null,
    structureJson: built.session.recipeV2Json
      ? {
          recipeV2: built.session.recipeV2Json,
          parser: {
            version: 'manual-review',
            confidence: 1,
            warnings: built.warnings,
          },
          editor: {
            source: 'parser-studio',
            email: params.editor?.email ?? null,
            editedAt: params.editor?.editedAt ?? new Date().toISOString(),
          },
        }
      : {
          editor: {
            source: 'parser-studio',
            email: params.editor?.email ?? null,
            editedAt: params.editor?.editedAt ?? new Date().toISOString(),
          },
        },
    notes: normalizedNotes || null,
    durationMinutes:
      params.durationMinutes != null
        ? params.durationMinutes
        : built.session.durationMinutes ?? null,
    distanceKm:
      params.distanceKm != null
        ? params.distanceKm
        : built.session.distanceKm ?? null,
  };
}

function finalizeExtractedPlanSource(params: FinalizeExtractedPlanSourceParams): ExtractedPlanSource {
  const compiled = compilePlanLogicGraph({
    rawText: params.rawText,
    weeks: params.weeks,
    sessions: params.sessions,
    durationWeeks: params.durationWeeks ?? null,
  });

  const confidence = clamp(
    (params.weeks.length ? 0.3 : 0) +
      (params.sessions.length ? 0.3 : 0) +
      Math.max(0, Math.min(0.4, compiled.graph.confidence)) +
      (params.confidenceBias ?? 0),
    0,
    1
  );

  return {
    rawText: params.rawText,
    rawJson: {
      compiler: {
        version: 'v1',
        graph: compiled.graph,
      },
      ...(params.rawJsonExtra ?? {}),
    },
    weeks: params.weeks,
    sessions: params.sessions,
    rules: compiled.rules,
    warnings: params.warnings,
    confidence,
  };
}

function isMeaningfulSessionCell(text: string) {
  const normalized = normalizeLine(text);
  if (!normalized || normalized.length < 4) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  if (/^(week\s*\d+|mon|tue|wed|thu|fri|sat|sun)$/i.test(normalized)) return false;
  return (
    detectDiscipline(normalized) != null ||
    parseMinutes(normalized) != null ||
    parseDistanceKm(normalized) != null ||
    /\b(optional|brick|fartlek|tempo|steady|easy|massage|yoga|recovery|technique|conditioning|swim|bike|run|rest)\b/i.test(normalized)
  );
}

function extractWeekIndexFromHeaderText(text: string) {
  const matches = extractWeekIndices(text);
  return matches[0] ?? null;
}

function extractPageWeekRangeStart(text: string) {
  const normalized = normalizeLine(text).toLowerCase();
  if (!normalized) return null;
  const rangeMatch = normalized.match(/\bweeks?\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return start - 1;
    }
  }
  return null;
}

function extractFromWeeklyGridPdfDocument(params: {
  document: ExtractedPdfDocument;
  rawTextFallback: string;
  durationWeeks?: number | null;
  layoutRules: LayoutFamilyRules;
}) {
  const rules = parseLayoutFamilyRules(params.layoutRules);
  if (!rules) return null;

  const weeksByIndex = new Map<number, ExtractedWeekTemplate>();
  const sessions: ExtractedSessionTemplate[] = [];
  const warnings: string[] = [];
  const sessionCountByWeek = new Map<number, number>();
  let nextFallbackWeekIndex = 0;
  let parsedPageCount = 0;

  for (const page of params.document.pages) {
    if (!page.items.length) continue;

    const excludeBoxes = [...rules.pageTemplate.ignoreRegions, ...rules.pageTemplate.legendRegions];
    const blockTitle = rules.pageTemplate.blockTitleBand
      ? extractTextFromPageRegion({ page, box: rules.pageTemplate.blockTitleBand, excludeBoxes }).text
      : '';

    const columns = rules.pageTemplate.weekColumns
      .map((column, columnIndex) => {
        const headerText = extractTextFromPageRegion({
          page,
          box: {
            x: column.left,
            y: rules.pageTemplate.weekHeaderBand.top,
            width: Math.max(0.01, column.right - column.left),
            height: Math.max(0.01, rules.pageTemplate.weekHeaderBand.bottom - rules.pageTemplate.weekHeaderBand.top),
          },
          excludeBoxes,
        }).text;

        let weekIndex = extractWeekIndexFromHeaderText(headerText) ?? extractWeekIndexFromHeaderText(column.label ?? '');
        if (weekIndex == null) {
          weekIndex = nextFallbackWeekIndex;
          nextFallbackWeekIndex += 1;
          warnings.push(`Page ${page.pageNumber} column ${columnIndex + 1}: week header could not be read; week index was inferred.`);
        } else {
          nextFallbackWeekIndex = Math.max(nextFallbackWeekIndex, weekIndex + 1);
        }

        return {
          ...column,
          weekIndex,
          headerText,
        };
      })
      .sort((left, right) => left.index - right.index);

    const pageRangeStart =
      extractPageWeekRangeStart(blockTitle) ??
      extractPageWeekRangeStart(columns.map((column) => column.headerText).join(' ')) ??
      extractPageWeekRangeStart(page.text);
    const resolvedColumns =
      pageRangeStart != null
        ? columns.map((column, index) => ({
            ...column,
            weekIndex: pageRangeStart + index,
          }))
        : columns;

    for (const column of resolvedColumns) {
      if (!weeksByIndex.has(column.weekIndex)) {
        weeksByIndex.set(column.weekIndex, {
          weekIndex: column.weekIndex,
          notes: blockTitle || column.headerText || null,
        });
      } else if (blockTitle && !weeksByIndex.get(column.weekIndex)?.notes) {
        weeksByIndex.set(column.weekIndex, {
          ...weeksByIndex.get(column.weekIndex)!,
          notes: blockTitle,
        });
      }
    }

    let pageSessions = 0;

    for (const row of rules.pageTemplate.dayRows) {
      for (const column of resolvedColumns) {
        const cellBox = getWeeklyGridCellBox(column, row);
        const cellText = extractTextFromPageRegion({
          page,
          box: cellBox,
          excludeBoxes,
        }).text;

        if (!isMeaningfulSessionCell(cellText)) continue;

        const discipline = detectDiscipline(cellText);
        if (!discipline) {
          warnings.push(`Page ${page.pageNumber} week ${column.weekIndex + 1} row ${row.index + 1}: could not infer discipline from cell text.`);
          continue;
        }

        const ordinal = (sessionCountByWeek.get(column.weekIndex) ?? 0) + 1;
        sessionCountByWeek.set(column.weekIndex, ordinal);
        const lines = cellText.split(/\n+/).map(normalizeLine).filter(Boolean);
        const built = buildSessionTemplate({
          weekIndex: column.weekIndex,
          ordinal,
          dayOfWeek: row.dayOfWeek,
          discipline,
          sessionText: lines.join('\n'),
          title: lines[0] ?? null,
        });

        if (built.warnings.length) {
          warnings.push(...built.warnings.map((warning) => `Session ${ordinal} week ${column.weekIndex + 1}: ${warning}`));
        }

        sessions.push(built.session);
        pageSessions += 1;
      }
    }

    if (pageSessions > 0) {
      parsedPageCount += 1;
    }
  }

  if (!sessions.length) {
    return null;
  }

  const weeks = [...weeksByIndex.values()].sort((left, right) => left.weekIndex - right.weekIndex);
  return finalizeExtractedPlanSource({
    rawText: params.rawTextFallback,
    weeks,
    sessions,
    warnings,
    durationWeeks: params.durationWeeks,
    confidenceBias: 0.12,
    rawJsonExtra: {
      pdfLayout: {
        version: 'weekly-grid-v1',
        mode: 'template',
        templateVersion: rules.version,
        templateSourcePlanId: rules.templateSourcePlanId,
        parsedPageCount,
        pageCount: params.document.pages.length,
      },
    },
  });
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const document = await extractStructuredPdfDocument(buffer);
  return document.rawText;
}

export function extractFromStructuredPdfDocument(params: {
  document: ExtractedPdfDocument;
  durationWeeks?: number | null;
  rawTextFallback?: string | null;
  layoutRulesJson?: unknown | null;
  annotations?: LayoutRuleSourceAnnotation[];
}) {
  const rawText = params.document.rawText || params.rawTextFallback || '';
  const parsedRules = parseLayoutFamilyRules(params.layoutRulesJson ?? null);

  if (parsedRules) {
    const extracted = extractFromWeeklyGridPdfDocument({
      document: params.document,
      rawTextFallback: rawText,
      durationWeeks: params.durationWeeks,
      layoutRules: parsedRules,
    });
    if (extracted) {
      return extracted;
    }
  }

  const fallback = extractFromRawText(rawText, params.durationWeeks ?? null);
  return {
    ...fallback,
    rawJson: {
      ...(fallback.rawJson && typeof fallback.rawJson === 'object' ? (fallback.rawJson as Record<string, unknown>) : {}),
      pdfLayout: {
        version: 'v0',
        mode: 'text-fallback',
        pageCount: params.document.pages.length,
        hasTemplateRules: Boolean(parsedRules),
        annotationCount: params.annotations?.length ?? 0,
      },
    },
  } satisfies ExtractedPlanSource;
}

export async function extractFromPdfBuffer(params: {
  buffer: Buffer;
  durationWeeks?: number | null;
  rawTextFallback?: string | null;
  layoutRulesJson?: unknown | null;
  annotations?: LayoutRuleSourceAnnotation[];
}) {
  const document = await extractStructuredPdfDocument(params.buffer);
  return extractFromStructuredPdfDocument({
    document,
    durationWeeks: params.durationWeeks,
    rawTextFallback: params.rawTextFallback,
    layoutRulesJson: params.layoutRulesJson,
    annotations: params.annotations,
  });
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

    const ordinal = (sessionCountByWeek.get(weekIndex) ?? 0) + 1;
    sessionCountByWeek.set(weekIndex, ordinal);
    const built = buildSessionTemplate({
      weekIndex,
      ordinal,
      dayOfWeek: candidate.dayOfWeek,
      discipline: candidate.discipline,
      sessionText: candidate.lines.join('\n').trim(),
      title: candidate.lines[0] ?? null,
    });

    if (built.warnings.length) {
      warnings.push(...built.warnings.map((warning) => `Session ${ordinal} week ${weekIndex + 1}: ${warning}`));
    }

    sessions.push(built.session);
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

  return finalizeExtractedPlanSource({
    rawText,
    weeks,
    sessions,
    warnings,
    durationWeeks,
    rawJsonExtra: {
      segmentation: {
        version: 'v1',
        warningCount: segmented.warnings.length,
      },
    },
  });
}
