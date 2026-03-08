import type { PlanDistance, PlanLevel, PlanSourceDiscipline, PlanSourceType, PlanSport } from '@prisma/client';
import { z } from 'zod';

import { OpenAiTransport } from '@/modules/ai-plan-builder/ai/providers/openai-transport';

import { extractFromPdfBuffer, extractFromRawText, type ExtractedPlanSource, type ExtractedSessionTemplate, type ExtractedWeekTemplate } from './extract';
import { normalizeDistanceUnitsToKm, parseDistanceKm } from './distance-utils';
import { extractStructuredPdfDocument } from './pdf-layout';

type RobustExtractionParams = {
  type: PlanSourceType;
  contentBytes: Buffer | null;
  rawText: string;
  durationWeeks?: number | null;
  title: string;
  sport: PlanSport;
  distance: PlanDistance;
  level: PlanLevel;
};

const LLM_SCHEMA = z.object({
  weeks: z
    .array(
      z.object({
        weekNumber: z.number().int().min(1).max(104),
        title: z.string().trim().min(1).max(140).nullable().optional(),
      })
    )
    .default([]),
  sessions: z
    .array(
      z.object({
        weekNumber: z.number().int().min(1).max(104),
        dayLabel: z.string().trim().min(1).max(16).nullable().optional(),
        discipline: z.enum(['SWIM', 'BIKE', 'RUN', 'STRENGTH', 'REST']),
        sessionType: z.string().trim().min(1).max(60).nullable().optional(),
        title: z.string().trim().min(1).max(180),
        details: z.string().trim().min(1).max(2000).nullable().optional(),
        durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
        distanceKm: z.number().min(0).max(400).nullable().optional(),
      })
    )
    .default([]),
  warnings: z.array(z.string().trim().min(1).max(400)).default([]),
});

const DAY_LABELS: Record<string, number> = {
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
  sun: 0,
  sunday: 0,
};

function parseDayOfWeek(dayLabel: string | null | undefined) {
  const normalized = String(dayLabel ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!normalized) return null;
  return DAY_LABELS[normalized] ?? null;
}

function parseDurationMinutes(input: string) {
  const text = String(input ?? '');
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i);
  if (range) {
    const left = Number(range[1]);
    const right = Number(range[2]);
    const unit = String(range[3]).toLowerCase();
    if (Number.isFinite(left) && Number.isFinite(right)) {
      const average = (left + right) / 2;
      return unit.startsWith('h') ? Math.round(average * 60) : Math.round(average);
    }
  }

  const single = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b/i);
  if (!single) return null;
  const value = Number(single[1]);
  const unit = String(single[2]).toLowerCase();
  if (!Number.isFinite(value)) return null;
  return unit.startsWith('h') ? Math.round(value * 60) : Math.round(value);
}

function normalizeSessionType(input: string | null | undefined) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return 'endurance';
  if (raw.includes('tech')) return 'technique';
  if (raw.includes('tempo')) return 'tempo';
  if (raw.includes('easy') || raw.includes('recovery')) return 'easy';
  if (raw.includes('long')) return 'long';
  if (raw.includes('interval') || raw.includes('vo2')) return 'vo2';
  if (raw.includes('threshold')) return 'threshold';
  if (raw.includes('brick')) return 'brick';
  if (raw.includes('strength') || raw.includes('gym') || raw.includes('conditioning')) return 'strength';
  if (raw.includes('rest')) return 'rest';
  return raw.slice(0, 48);
}

function normalizeModelAlias(input: string) {
  const value = String(input ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value === '5.2 instant' || value === '5.2-instant' || value === 'gpt-5.2 instant') return 'gpt-5.2-instant';
  if (value === '5.2' || value === 'gpt-5.2') return 'gpt-5.2';
  if (value === '4.1-mini' || value === 'gpt4.1-mini') return 'gpt-4.1-mini';
  return String(input).trim();
}

function resolveModelCandidates() {
  const candidates = [
    normalizeModelAlias(String(process.env.PLAN_LIBRARY_INGEST_MODEL ?? '')),
    normalizeModelAlias(String(process.env.AI_PLAN_BUILDER_LLM_MODEL ?? '')),
    'gpt-5.2-instant',
    'gpt-4.1-mini',
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function renderDocumentForLlm(doc: Awaited<ReturnType<typeof extractStructuredPdfDocument>>) {
  const lineTolerance = 0.0125;
  const pages = doc.pages.map((page) => {
    const sorted = [...page.items].sort((a, b) => {
      const deltaY = a.normalizedY - b.normalizedY;
      if (Math.abs(deltaY) > lineTolerance) return deltaY;
      return a.normalizedX - b.normalizedX;
    });

    const lines: Array<{ y: number; parts: string[] }> = [];
    for (const item of sorted) {
      const text = String(item.text ?? '').trim();
      if (!text) continue;
      const current = lines[lines.length - 1];
      if (!current || Math.abs(current.y - item.normalizedY) > lineTolerance) {
        lines.push({ y: item.normalizedY, parts: [text] });
      } else {
        current.parts.push(text);
      }
    }

    return [
      `=== PAGE ${page.pageNumber} ===`,
      ...lines.map((line) => line.parts.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean),
    ].join('\n');
  });

  return pages.join('\n\n');
}

function shouldUseLlmExtraction(params: {
  llm: ExtractedPlanSource;
  baseline: ExtractedPlanSource;
  durationWeeks: number | null;
}) {
  const llmSessions = params.llm.sessions.length;
  const baselineSessions = params.baseline.sessions.length;
  const llmWeeks = params.llm.weeks.length;
  const expectedWeeks = params.durationWeeks && params.durationWeeks > 0 ? params.durationWeeks : null;
  const baselineWarnings = Array.isArray(params.baseline.warnings) ? params.baseline.warnings : [];
  const baselineLooksCollapsed = baselineWarnings.some((warning) =>
    /dense[- ]text recovery|collapsed|merged ocr|template rules were present but yielded no accepted grid sessions/i.test(warning)
  );

  if (llmSessions === 0) return false;
  if (expectedWeeks && llmWeeks < Math.max(2, Math.floor(expectedWeeks * 0.5))) return false;

  // If deterministic parsing is clearly collapsed/merged OCR, allow LLM extraction
  // with more permissive thresholds.
  if (baselineLooksCollapsed) {
    if (expectedWeeks && llmWeeks >= Math.max(2, Math.floor(expectedWeeks * 0.67)) && llmSessions >= expectedWeeks * 2) {
      return true;
    }
    if (llmSessions >= Math.max(6, Math.floor(baselineSessions * 0.25))) return true;
    return false;
  }

  if (baselineSessions >= 1 && llmSessions < Math.max(8, Math.floor(baselineSessions * 0.45))) return false;
  return true;
}

function buildLlmExtractedPlanSource(params: {
  rawText: string;
  durationWeeks: number | null;
  structured: z.infer<typeof LLM_SCHEMA>;
}): ExtractedPlanSource {
  const weeksMap = new Map<number, ExtractedWeekTemplate>();
  const ordinals = new Map<number, number>();
  const sessions: ExtractedSessionTemplate[] = [];

  for (const week of params.structured.weeks) {
    const weekIndex = Math.max(0, week.weekNumber - 1);
    weeksMap.set(weekIndex, {
      weekIndex,
      notes: week.title ?? null,
    });
  }

  for (const session of params.structured.sessions) {
    const weekIndex = Math.max(0, session.weekNumber - 1);
    if (!weeksMap.has(weekIndex)) {
      weeksMap.set(weekIndex, { weekIndex, notes: null });
    }

    const ordinal = (ordinals.get(weekIndex) ?? 0) + 1;
    ordinals.set(weekIndex, ordinal);

    const normalizedDetails = normalizeDistanceUnitsToKm(String(session.details ?? ''));
    const normalizedTitle = normalizeDistanceUnitsToKm(String(session.title ?? ''));
    const mergedText = [normalizedTitle, normalizedDetails].filter(Boolean).join('\n').trim();
    const parsedDistance = parseDistanceKm(mergedText);
    const parsedDuration = parseDurationMinutes(mergedText);

    sessions.push({
      weekIndex,
      ordinal,
      dayOfWeek: parseDayOfWeek(session.dayLabel),
      discipline: session.discipline as PlanSourceDiscipline,
      sessionType: normalizeSessionType(session.sessionType),
      title: normalizedTitle || null,
      durationMinutes: session.durationMinutes ?? parsedDuration,
      distanceKm: session.distanceKm ?? parsedDistance,
      intensityType: null,
      intensityTargetJson: null,
      recipeV2Json: null,
      parserConfidence: 0.9,
      parserWarningsJson: null,
      structureJson: {
        source: 'llm-structured-ingest-v2',
        dayLabel: session.dayLabel ?? null,
      },
      notes: normalizedDetails || null,
    });
  }

  const weeks = [...weeksMap.values()].sort((a, b) => a.weekIndex - b.weekIndex);
  const warnings = [...params.structured.warnings];
  const confidence = sessions.length > 0 ? 0.9 : 0.4;

  return {
    rawText: params.rawText,
    rawJson: {
      extractionMode: 'llm-structured-ingest-v2',
      weekCount: weeks.length,
      sessionCount: sessions.length,
    },
    weeks,
    sessions,
    rules: [],
    warnings,
    confidence,
  };
}

async function extractWithLlm(params: {
  rawText: string;
  title: string;
  sport: PlanSport;
  distance: PlanDistance;
  level: PlanLevel;
  durationWeeks: number | null;
}) {
  const apiKey = String(process.env.OPENAI_API_KEY ?? '').trim();
  if (!apiKey) return null;

  const sourceText = params.rawText.slice(0, 140_000);
  const models = resolveModelCandidates();
  if (!models.length) return null;

  const transport = new OpenAiTransport({ apiKey });
  const errors: string[] = [];
  for (const model of models) {
    try {
      const structured = await transport.generateStructuredJson({
        model,
        timeoutMs: 45_000,
        maxOutputTokens: 30_000,
        schema: LLM_SCHEMA,
        system: [
          'You extract endurance training plans into strict structured JSON.',
          'Do not invent sessions.',
          'Use week numbers and day labels if present.',
          'Normalize distance units to kilometers (convert miles to km).',
          'Keep one session per distinct workout item.',
          'Ignore marketing text, logos, and editorial headers.',
        ].join('\n'),
        input: [
          `Plan title: ${params.title}`,
          `Sport: ${params.sport}`,
          `Distance: ${params.distance}`,
          `Level: ${params.level}`,
          `Expected duration weeks: ${params.durationWeeks ?? 'unknown'}`,
          '',
          'Plan source text:',
          sourceText,
        ].join('\n'),
      });

      const extracted = buildLlmExtractedPlanSource({
        rawText: params.rawText,
        durationWeeks: params.durationWeeks,
        structured,
      });
      extracted.warnings = [...extracted.warnings, `LLM extraction model used: ${model}.`];
      return extracted;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      errors.push(`${model}: ${message}`);
    }
  }

  throw new Error(`all model attempts failed (${errors.join(' | ')})`);
}

export async function extractPlanSourceWithRobustPipeline(params: RobustExtractionParams): Promise<ExtractedPlanSource> {
  const durationWeeks = Number.isFinite(params.durationWeeks ?? null) ? Number(params.durationWeeks) : null;

  let baseline: ExtractedPlanSource;
  if (
    params.contentBytes &&
    (params.type === 'PDF' || (params.type === 'URL' && String(params.rawText ?? '').trim().length === 0))
  ) {
    baseline = await extractFromPdfBuffer({
      buffer: params.contentBytes,
      durationWeeks,
      rawTextFallback: params.rawText,
      layoutRulesJson: null,
    });
  } else {
    baseline = extractFromRawText(params.rawText, durationWeeks);
  }

  try {
    let sourceText = baseline.rawText;
    let repairedPdfText: string | null = null;
    if (params.type === 'PDF' && params.contentBytes) {
      const doc = await extractStructuredPdfDocument(params.contentBytes);
      if (doc.rawText.trim()) sourceText = doc.rawText;
      repairedPdfText = renderDocumentForLlm(doc);
    }

    let llm = await extractWithLlm({
      rawText: sourceText,
      title: params.title,
      sport: params.sport,
      distance: params.distance,
      level: params.level,
      durationWeeks,
    });
    if (!llm) return baseline;

    if (llm.sessions.length === 0 && repairedPdfText && repairedPdfText.trim().length > 0) {
      const retry = await extractWithLlm({
        rawText: repairedPdfText,
        title: params.title,
        sport: params.sport,
        distance: params.distance,
        level: params.level,
        durationWeeks,
      });
      if (retry) {
        llm = {
          ...retry,
          warnings: [...retry.warnings, 'LLM retry used page-rendered text reconstruction for improved parsing.'],
        };
      }
    }

    if (!shouldUseLlmExtraction({ llm, baseline, durationWeeks })) {
      return {
        ...baseline,
        warnings: [
          ...(Array.isArray(baseline.warnings) ? baseline.warnings : []),
          `LLM structured extraction did not clear quality gates; deterministic extraction was retained (llm weeks ${llm.weeks.length}, llm sessions ${llm.sessions.length}, baseline weeks ${baseline.weeks.length}, baseline sessions ${baseline.sessions.length}).`,
        ],
      };
    }

    return llm;
  } catch (error) {
    return {
      ...baseline,
      warnings: [
        ...(Array.isArray(baseline.warnings) ? baseline.warnings : []),
        `LLM structured extraction failed; deterministic extraction was retained (${error instanceof Error ? error.message : 'unknown error'}).`,
      ],
    };
  }
}
