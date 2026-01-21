import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  WorkoutLibraryDiscipline,
  WorkoutLibrarySource,
  WorkoutLibrarySessionStatus,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { failure, handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';
import { deriveIntensityCategory, normalizeEquipment, normalizeTags } from '@/lib/workout-library-taxonomy';
import {
  asTrimmedString,
  fetchTextWithTimeoutAndLimit,
  getPlanLibraryDatasetUrl,
  headWithTimeout,
  parseBoolean,
  parseCsvObjects,
  parseJsonOrNull,
  parseOptionalNumber,
  sanitizeUrlForLogs,
  type PlanLibraryDataset,
} from '@/lib/ingestion/plan-library';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 200 * 1024 * 1024; // 200MB
const HEAD_TIMEOUT_MS = 15_000;
const GET_TIMEOUT_MS = 120_000;

const datasetSchema = z.enum(['PLANS', 'SESSIONS', 'SCHEDULE', 'ALL']);

const bodySchema = z
  .object({
    dataset: datasetSchema,
    dryRun: z.boolean().default(true),
    confirmApply: z.boolean().default(false),
    limit: z.number().int().positive().max(200_000).optional(),
    offset: z.number().int().nonnegative().default(0),
    reset: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    if (!body.dryRun && body.confirmApply !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'confirmApply is required when dryRun=false.' });
    }

    if (body.reset && body.dryRun) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reset can only be used with dryRun=false.' });
    }
  });

type ImportRowError = {
  index: number;
  code: string;
  message: string;
  planIdExternal?: string;
  sessionExternalId?: string;
};

type StepSummary = {
  dataset: 'PLANS' | 'SESSIONS' | 'SCHEDULE';
  dryRun: boolean;
  scanned: number;
  valid: number;
  wouldCreate: number;
  wouldUpdate: number;
  created: number;
  updated: number;
  errorCount: number;
  errors: ImportRowError[];
};

type ImportSummary = {
  requestId: string;
  dataset: z.infer<typeof datasetSchema>;
  dryRun: boolean;
  urlHost: string;
  urlPath: string;
  resolvedSource: string;
  startedAt: string;
  finishedAt: string;
  steps: StepSummary[];
  message?: string;
};

function isProductionEnv(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

function parseDiscipline(raw: unknown): WorkoutLibraryDiscipline {
  const token = String(raw ?? '').trim().toUpperCase();
  if (!token) return WorkoutLibraryDiscipline.OTHER;

  if (token === 'RUN' || token === 'RUNNING') return WorkoutLibraryDiscipline.RUN;
  if (token === 'BIKE' || token === 'CYCLING' || token === 'CYCLE') return WorkoutLibraryDiscipline.BIKE;
  if (token === 'SWIM' || token === 'SWIMMING') return WorkoutLibraryDiscipline.SWIM;
  if (token === 'BRICK') return WorkoutLibraryDiscipline.BRICK;
  if (token === 'STRENGTH' || token === 'GYM' || token === 'LIFT' || token === 'WEIGHTS') return WorkoutLibraryDiscipline.STRENGTH;

  if (token.includes('RUN')) return WorkoutLibraryDiscipline.RUN;
  if (token.includes('BIKE') || token.includes('CYCLE')) return WorkoutLibraryDiscipline.BIKE;
  if (token.includes('SWIM')) return WorkoutLibraryDiscipline.SWIM;
  if (token.includes('BRICK')) return WorkoutLibraryDiscipline.BRICK;
  if (token.includes('STRENGTH') || token.includes('GYM')) return WorkoutLibraryDiscipline.STRENGTH;

  return WorkoutLibraryDiscipline.OTHER;
}

function parseDelimitedList(raw: unknown): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  return text
    .split(/[;,]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function metersFromValueAndUnit(value: number | undefined, unitRaw: unknown): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const unit = String(unitRaw ?? '').trim().toLowerCase();
  if (!unit) return null;

  if (unit === 'm' || unit === 'meter' || unit === 'meters') return value;
  if (unit === 'km' || unit === 'kilometer' || unit === 'kilometers') return value * 1000;
  if (unit === 'mi' || unit === 'mile' || unit === 'miles') return value * 1609.34;
  if (unit === 'yd' || unit === 'yard' || unit === 'yards') return value * 0.9144;

  return null;
}

function firstLine(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const line = trimmed.split(/\r?\n/)[0] ?? '';
  return line.trim();
}

function buildSessionTitle(input: {
  discipline: WorkoutLibraryDiscipline;
  category: string;
  durationSec: number;
  distanceMeters: number | null;
  rawText: string;
}): string {
  const disciplineLabel = input.discipline === WorkoutLibraryDiscipline.OTHER ? '' : input.discipline;
  const category = input.category.trim();

  const parts: string[] = [];
  if (category) parts.push(category);
  if (disciplineLabel) parts.push(disciplineLabel);

  if (input.distanceMeters != null && input.distanceMeters > 0) {
    const km = input.distanceMeters / 1000;
    parts.push(`${km.toFixed(km >= 10 ? 0 : 1)}km`);
  } else if (input.durationSec > 0) {
    const min = Math.round(input.durationSec / 60);
    parts.push(`${min}min`);
  }

  const base = parts.filter(Boolean).join(' • ');
  if (base) return base;

  const fallback = firstLine(input.rawText);
  return fallback ? fallback.slice(0, 120) : 'Imported session';
}

async function fetchCsvRowsOrThrow(dataset: PlanLibraryDataset, requestId: string) {
  const url = getPlanLibraryDatasetUrl(dataset);
  const safe = sanitizeUrlForLogs(url);

  const head = await headWithTimeout(url, { timeoutMs: HEAD_TIMEOUT_MS });
  if (!head.ok) {
    throw new ApiError(502, 'HEAD_FAILED', `HEAD failed: ${head.status}`, {
      ...safe,
      headStatus: head.status,
      contentType: head.contentType,
      contentLength: head.contentLength,
      requestId,
      step: `head:${dataset}`,
    });
  }

  if (head.contentLength != null && head.contentLength > MAX_BYTES) {
    return {
      rows: [],
      safe,
      head,
      blocked: failure('DATASET_TOO_LARGE', 'Dataset exceeds 200MB limit.', 413, requestId, {
        ...safe,
        headStatus: head.status,
        contentType: head.contentType,
        contentLength: head.contentLength,
      }),
    };
  }

  const fetched = await fetchTextWithTimeoutAndLimit(url, { timeoutMs: GET_TIMEOUT_MS, maxBytes: MAX_BYTES });
  const rows = parseCsvObjects(fetched.text);

  return {
    rows,
    safe,
    head,
    blocked: null as Response | null,
  };
}

async function maybeResetNonProd(requestId: string) {
  if (isProductionEnv()) {
    return failure('RESET_DISABLED_IN_PROD', 'reset is disabled in production.', 400, requestId);
  }

  const [instances, items] = await prisma.$transaction([
    prisma.athletePlanInstance.count(),
    prisma.athletePlanInstanceItem.count(),
  ]);

  if (instances > 0 || items > 0) {
    return failure(
      'RESET_BLOCKED_HAS_ATHLETE_DATA',
      'reset blocked: athlete plan history exists. Refusing to delete plan library tables.',
      400,
      requestId,
      { diagnostics: { athletePlanInstance: instances, athletePlanInstanceItem: items } }
    );
  }

  const deleted = await prisma.$transaction([
    prisma.planTemplateScheduleRow.deleteMany(),
    prisma.planTemplate.deleteMany(),
    prisma.workoutLibrarySession.deleteMany({ where: { source: WorkoutLibrarySource.PLAN_LIBRARY } }),
  ]);

  return success({
    ok: true,
    requestId,
    deleted: {
      planTemplateScheduleRow: deleted[0].count,
      planTemplate: deleted[1].count,
      workoutLibrarySession: deleted[2].count,
    },
  });
}

async function importPlans(opts: {
  requestId: string;
  dryRun: boolean;
  limit?: number;
  offset: number;
}): Promise<{
  step: StepSummary;
  url: { urlHost: string; urlPath: string; resolvedSource: string };
  blocked: Response | null;
  planIds: string[];
}>{
  const fetched = await fetchCsvRowsOrThrow('PLANS', opts.requestId);
  if (fetched.blocked) return { step: emptyStep('PLANS', opts.dryRun), url: fetched.safe, blocked: fetched.blocked, planIds: [] };

  const sliced = fetched.rows.slice(opts.offset, opts.limit ? opts.offset + opts.limit : undefined);

  const errors: ImportRowError[] = [];
  const items: Array<{
    planIdExternal: string;
    name: string;
    tags: string[];
    sourceFile: string | null;
    goalDistancesJson: unknown | null;
    goalTimesJson: unknown | null;
  }> = [];

  for (let i = 0; i < sliced.length; i++) {
    const r = sliced[i] ?? {};
    const planIdExternal = asTrimmedString(r.plan_id);
    if (!planIdExternal) {
      errors.push({ index: opts.offset + i + 1, code: 'PLAN_ID_REQUIRED', message: 'plan_id is required.' });
      continue;
    }

    const name = asTrimmedString(r.plan_name);
    const tags = normalizeTags(parseDelimitedList(r.tags));
    const sourceFile = asTrimmedString(r.source_file) || null;

    const goalDistances = asTrimmedString(r.goal_distances);
    const goalTimes = asTrimmedString(r.goal_times);

    items.push({
      planIdExternal,
      name: name || planIdExternal,
      tags,
      sourceFile,
      goalDistancesJson: goalDistances ? { raw: goalDistances } : null,
      goalTimesJson: goalTimes ? { raw: goalTimes } : null,
    });
  }

  const keys = Array.from(new Set(items.map((it) => it.planIdExternal)));
  const existing = await prisma.planTemplate.findMany({
    where: { planIdExternal: { in: keys } },
    select: { planIdExternal: true },
  });
  const existingSet = new Set(existing.map((e) => e.planIdExternal));

  const wouldCreate = items.filter((it) => !existingSet.has(it.planIdExternal)).length;
  const wouldUpdate = items.length - wouldCreate;

  if (!opts.dryRun && errors.length > 0) {
    return {
      step: {
        dataset: 'PLANS',
        dryRun: opts.dryRun,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
      planIds: keys,
    };
  }

  if (opts.dryRun) {
    return {
      step: {
        dataset: 'PLANS',
        dryRun: true,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
      planIds: keys,
    };
  }

  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    await prisma.$transaction(
      batch.map((it) =>
        prisma.planTemplate.upsert({
          where: { planIdExternal: it.planIdExternal },
          update: {
            name: it.name,
            tags: it.tags,
            sourceFile: it.sourceFile,
            goalDistancesJson: it.goalDistancesJson ?? undefined,
            goalTimesJson: it.goalTimesJson ?? undefined,
          },
          create: {
            planIdExternal: it.planIdExternal,
            name: it.name,
            tags: it.tags,
            sourceFile: it.sourceFile,
            goalDistancesJson: it.goalDistancesJson ?? undefined,
            goalTimesJson: it.goalTimesJson ?? undefined,
          },
        })
      )
    );
  }

  return {
    step: {
      dataset: 'PLANS',
      dryRun: false,
      scanned: sliced.length,
      valid: items.length,
      wouldCreate,
      wouldUpdate,
      created: wouldCreate,
      updated: wouldUpdate,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    },
    url: fetched.safe,
    blocked: null,
    planIds: keys,
  };
}

async function importSessions(opts: {
  requestId: string;
  dryRun: boolean;
  limit?: number;
  offset: number;
  createdByUserId: string;
}): Promise<{
  step: StepSummary;
  url: { urlHost: string; urlPath: string; resolvedSource: string };
  blocked: Response | null;
  sessionIds: string[];
}>{
  const fetched = await fetchCsvRowsOrThrow('SESSIONS', opts.requestId);
  if (fetched.blocked) {
    return { step: emptyStep('SESSIONS', opts.dryRun), url: fetched.safe, blocked: fetched.blocked, sessionIds: [] };
  }

  const sliced = fetched.rows.slice(opts.offset, opts.limit ? opts.offset + opts.limit : undefined);

  const errors: ImportRowError[] = [];
  const items: Array<{
    externalId: string;
    discipline: WorkoutLibraryDiscipline;
    category: string | null;
    description: string;
    rawText: string | null;
    durationSec: number;
    distanceMeters: number | null;
    intensityTarget: string;
    intensityCategory: ReturnType<typeof deriveIntensityCategory>;
    equipment: string[];
    tags: string[];
    paceTargetsJson: unknown | null;
    prescriptionJson: unknown | null;
    title: string;
  }> = [];

  for (let i = 0; i < sliced.length; i++) {
    const r = sliced[i] ?? {};
    const externalId = asTrimmedString(r.session_id);
    if (!externalId) {
      errors.push({ index: opts.offset + i + 1, code: 'SESSION_ID_REQUIRED', message: 'session_id is required.' });
      continue;
    }

    const discipline = parseDiscipline(r.discipline);
    const category = asTrimmedString(r.category) || null;
    const instructions = asTrimmedString(r.instructions);
    const rawText = asTrimmedString(r.raw_text) || null;

    const durationMinTarget =
      parseOptionalNumber(r.duration_min_prescription_target) ??
      parseOptionalNumber(r.duration_min) ??
      (() => {
        const low = parseOptionalNumber(r.duration_min_low);
        const high = parseOptionalNumber(r.duration_min_high);
        if (low != null && high != null) return (low + high) / 2;
        return undefined;
      })();

    const durationSec = Math.max(0, Math.round((durationMinTarget ?? 0) * 60));

    const distanceTarget =
      parseOptionalNumber(r.distance_prescription_target) ??
      parseOptionalNumber(r.distance_value_legacy) ??
      null;

    const distanceUnit = r.distance_prescription_unit ?? r.distance_unit_legacy;
    const distanceMeters = metersFromValueAndUnit(distanceTarget ?? undefined, distanceUnit);

    const zoneTarget = parseOptionalNumber(r.intensity_zone_target);
    const intensityHint = asTrimmedString(r.intensity_hint);
    const intensityTarget = zoneTarget != null ? `Z${Math.round(zoneTarget)}` : intensityHint || category || 'Other';
    const intensityCategory = deriveIntensityCategory(intensityTarget);

    const equipment = normalizeEquipment(parseDelimitedList(r.equipment));
    const tags = normalizeTags([category || '', ...equipment]);

    const distancePrescription = parseJsonOrNull(r.distance_prescription_json);
    const durationPrescription = parseJsonOrNull(r.duration_prescription_json);

    const paceTargetsJson = {
      paceMinPerKmTarget: parseOptionalNumber(r.pace_min_per_km_target),
      paceMinPerKmFastest: parseOptionalNumber(r.pace_min_per_km_fastest),
      paceMinPerKmSlowest: parseOptionalNumber(r.pace_min_per_km_slowest),
      swimPaceMinPer100mTarget: parseOptionalNumber(r.swim_pace_min_per_100m_target),
      intensityZoneMin: parseOptionalNumber(r.intensity_zone_min),
      intensityZoneTarget: zoneTarget,
      intensityZoneMax: parseOptionalNumber(r.intensity_zone_max),
    };

    const prescriptionJson = {
      distance: distancePrescription,
      duration: durationPrescription,
      unitHints: {
        distanceUnit: asTrimmedString(distanceUnit) || null,
        durationUnit: 'min',
      },
    };

    const description = instructions || rawText || 'Imported session.';

    const title = buildSessionTitle({
      discipline,
      category: category || '',
      durationSec,
      distanceMeters,
      rawText: rawText || '',
    });

    items.push({
      externalId,
      discipline,
      category,
      description,
      rawText,
      durationSec,
      distanceMeters,
      intensityTarget,
      intensityCategory,
      equipment,
      tags,
      paceTargetsJson,
      prescriptionJson,
      title,
    });
  }

  const keys = Array.from(new Set(items.map((it) => it.externalId)));
  const existing = await prisma.workoutLibrarySession.findMany({
    where: { externalId: { in: keys } },
    select: { externalId: true },
  });
  const existingSet = new Set(existing.map((e) => e.externalId).filter(Boolean) as string[]);

  const wouldCreate = items.filter((it) => !existingSet.has(it.externalId)).length;
  const wouldUpdate = items.length - wouldCreate;

  if (!opts.dryRun && errors.length > 0) {
    return {
      step: {
        dataset: 'SESSIONS',
        dryRun: opts.dryRun,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
      sessionIds: keys,
    };
  }

  if (opts.dryRun) {
    return {
      step: {
        dataset: 'SESSIONS',
        dryRun: true,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
      sessionIds: keys,
    };
  }

  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    await prisma.$transaction(
      batch.map((it) =>
        prisma.workoutLibrarySession.upsert({
          where: { externalId: it.externalId },
          update: {
            title: it.title,
            discipline: it.discipline,
            status: WorkoutLibrarySessionStatus.DRAFT,
            source: WorkoutLibrarySource.PLAN_LIBRARY,
            tags: it.tags,
            description: it.description,
            durationSec: it.durationSec,
            intensityTarget: it.intensityTarget,
            intensityCategory: it.intensityCategory,
            distanceMeters: it.distanceMeters,
            category: it.category,
            rawText: it.rawText,
            paceTargetsJson: it.paceTargetsJson ?? undefined,
            prescriptionJson: it.prescriptionJson ?? undefined,
            equipment: it.equipment,
          },
          create: {
            externalId: it.externalId,
            title: it.title,
            discipline: it.discipline,
            status: WorkoutLibrarySessionStatus.DRAFT,
            source: WorkoutLibrarySource.PLAN_LIBRARY,
            tags: it.tags,
            description: it.description,
            durationSec: it.durationSec,
            intensityTarget: it.intensityTarget,
            intensityCategory: it.intensityCategory,
            distanceMeters: it.distanceMeters,
            category: it.category,
            rawText: it.rawText,
            paceTargetsJson: it.paceTargetsJson ?? undefined,
            prescriptionJson: it.prescriptionJson ?? undefined,
            equipment: it.equipment,
            createdByUserId: opts.createdByUserId,
          },
        })
      )
    );
  }

  return {
    step: {
      dataset: 'SESSIONS',
      dryRun: false,
      scanned: sliced.length,
      valid: items.length,
      wouldCreate,
      wouldUpdate,
      created: wouldCreate,
      updated: wouldUpdate,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    },
    url: fetched.safe,
    blocked: null,
    sessionIds: keys,
  };
}

function emptyStep(dataset: StepSummary['dataset'], dryRun: boolean): StepSummary {
  return { dataset, dryRun, scanned: 0, valid: 0, wouldCreate: 0, wouldUpdate: 0, created: 0, updated: 0, errorCount: 0, errors: [] };
}

function scheduleKey(k: { planTemplateId: string; weekIndex: number; dayIndex: number; ordinal: number }): string {
  return `${k.planTemplateId}|${k.weekIndex}|${k.dayIndex}|${k.ordinal}`;
}

async function importSchedule(opts: {
  requestId: string;
  dryRun: boolean;
  limit?: number;
  offset: number;
  resolveHints?: {
    planIds: Set<string>;
    sessionIds: Set<string>;
  };
}): Promise<{ step: StepSummary; url: { urlHost: string; urlPath: string; resolvedSource: string }; blocked: Response | null }>{
  const fetched = await fetchCsvRowsOrThrow('SCHEDULE', opts.requestId);
  if (fetched.blocked) return { step: emptyStep('SCHEDULE', opts.dryRun), url: fetched.safe, blocked: fetched.blocked };

  const sliced = fetched.rows.slice(opts.offset, opts.limit ? opts.offset + opts.limit : undefined);

  const errors: ImportRowError[] = [];
  const rawItems: Array<{
    planIdExternal: string;
    sessionExternalId: string | null;
    weekIndex: number;
    dayIndex: number;
    dayOfWeek: number;
    ordinal: number;
    isOptional: boolean;
    isOff: boolean;
    rawText: string | null;
  }> = [];

  for (let i = 0; i < sliced.length; i++) {
    const r = sliced[i] ?? {};

    const planIdExternal = asTrimmedString(r.plan_id);
    if (!planIdExternal) {
      errors.push({ index: opts.offset + i + 1, code: 'PLAN_ID_REQUIRED', message: 'plan_id is required.' });
      continue;
    }

    const week = parseOptionalNumber(r.week);
    const day = parseOptionalNumber(r.day);

    const weekIndex = week != null ? Math.max(0, Math.trunc(week)) : 0;
    const dayIndex = day != null ? Math.max(0, Math.trunc(day)) : 0;
    if (!weekIndex || !dayIndex) {
      errors.push({
        index: opts.offset + i + 1,
        code: 'WEEK_DAY_REQUIRED',
        message: 'week and day are required.' ,
        planIdExternal,
      });
      continue;
    }

    const isOptional = parseBoolean(r.is_optional);
    const isOff = parseBoolean(r.is_off);
    const rawText = asTrimmedString(r.raw_text) || null;

    const sessionExternalId = isOff ? null : asTrimmedString(r.session_id) || null;
    if (!isOff && !sessionExternalId) {
      errors.push({
        index: opts.offset + i + 1,
        code: 'SESSION_ID_REQUIRED',
        message: 'session_id is required when is_off is false.',
        planIdExternal,
      });
      continue;
    }

    const ordinal = (() => {
      const explicit = parseOptionalNumber((r as any).ordinal ?? (r as any).order ?? (r as any).session_order);
      if (explicit != null && Number.isFinite(explicit)) return Math.max(0, Math.trunc(explicit));
      return 0;
    })();

    const dayOfWeek = ((dayIndex - 1) % 7) + 1;

    rawItems.push({
      planIdExternal,
      sessionExternalId,
      weekIndex,
      dayIndex,
      dayOfWeek,
      ordinal,
      isOptional,
      isOff,
      rawText,
    });
  }

  const planIds = Array.from(new Set(rawItems.map((it) => it.planIdExternal)));
  const sessionIds = Array.from(new Set(rawItems.map((it) => it.sessionExternalId).filter(Boolean) as string[]));

  // Special-case: dataset=ALL dry-run should validate schedule against the same-request plans/sessions,
  // without requiring prior DB writes.
  if (opts.dryRun && opts.resolveHints) {
    const items = rawItems
      .map((it) => ({
        planIdExternal: it.planIdExternal,
        sessionExternalId: it.sessionExternalId,
        weekIndex: it.weekIndex,
        dayIndex: it.dayIndex,
        dayOfWeek: it.dayOfWeek,
        ordinal: it.ordinal,
        isOptional: it.isOptional,
        isOff: it.isOff,
        rawText: it.rawText,
      }))
      .filter(Boolean);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!opts.resolveHints.planIds.has(it.planIdExternal)) {
        errors.push({
          index: opts.offset + i + 1,
          code: 'PLAN_NOT_FOUND',
          message: `Plan not found for plan_id=${it.planIdExternal}.`,
          planIdExternal: it.planIdExternal,
        });
      }

      if (!it.isOff && it.sessionExternalId && !opts.resolveHints.sessionIds.has(it.sessionExternalId)) {
        errors.push({
          index: opts.offset + i + 1,
          code: 'SESSION_NOT_FOUND',
          message: `Session not found for session_id=${it.sessionExternalId}.`,
          planIdExternal: it.planIdExternal,
          sessionExternalId: it.sessionExternalId,
        });
      }
    }

    return {
      step: {
        dataset: 'SCHEDULE',
        dryRun: true,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate: items.length,
        wouldUpdate: 0,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
    };
  }

  const [plans, sessions] = await prisma.$transaction([
    prisma.planTemplate.findMany({ where: { planIdExternal: { in: planIds } }, select: { id: true, planIdExternal: true } }),
    prisma.workoutLibrarySession.findMany({ where: { externalId: { in: sessionIds } }, select: { id: true, externalId: true } }),
  ]);

  const planMap = new Map(plans.map((p) => [p.planIdExternal, p.id] as const));
  const sessionMap = new Map(sessions.map((s) => [s.externalId as string, s.id] as const));

  const items: Array<{
    planTemplateId: string;
    weekIndex: number;
    dayIndex: number;
    dayOfWeek: number;
    ordinal: number;
    isOptional: boolean;
    isOff: boolean;
    rawText: string | null;
    workoutLibrarySessionId: string | null;
  }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i];
    const planTemplateId = planMap.get(it.planIdExternal);
    if (!planTemplateId) {
      errors.push({
        index: opts.offset + i + 1,
        code: 'PLAN_NOT_FOUND',
        message: `Plan not found for plan_id=${it.planIdExternal}.`,
        planIdExternal: it.planIdExternal,
      });
      continue;
    }

    const workoutLibrarySessionId = it.isOff
      ? null
      : it.sessionExternalId
        ? sessionMap.get(it.sessionExternalId) ?? null
        : null;

    if (!it.isOff && it.sessionExternalId && !workoutLibrarySessionId) {
      errors.push({
        index: opts.offset + i + 1,
        code: 'SESSION_NOT_FOUND',
        message: `Session not found for session_id=${it.sessionExternalId}.`,
        planIdExternal: it.planIdExternal,
        sessionExternalId: it.sessionExternalId,
      });
      continue;
    }

    items.push({
      planTemplateId,
      weekIndex: it.weekIndex,
      dayIndex: it.dayIndex,
      dayOfWeek: it.dayOfWeek,
      ordinal: it.ordinal,
      isOptional: it.isOptional,
      isOff: it.isOff,
      rawText: it.rawText,
      workoutLibrarySessionId,
    });
  }

  // Determine wouldCreate/wouldUpdate by looking up existing compound keys.
  const existingSet = new Set<string>();
  for (let i = 0; i < items.length; i += 200) {
    const batch = items.slice(i, i + 200);
    const existing = await prisma.planTemplateScheduleRow.findMany({
      where: {
        OR: batch.map((b) => ({
          planTemplateId: b.planTemplateId,
          weekIndex: b.weekIndex,
          dayIndex: b.dayIndex,
          ordinal: b.ordinal,
        })),
      },
      select: { planTemplateId: true, weekIndex: true, dayIndex: true, ordinal: true },
    });

    for (const row of existing) {
      existingSet.add(
        scheduleKey({
          planTemplateId: row.planTemplateId,
          weekIndex: row.weekIndex,
          dayIndex: row.dayIndex,
          ordinal: row.ordinal,
        })
      );
    }
  }

  const wouldCreate = items.filter((it) => !existingSet.has(scheduleKey(it))).length;
  const wouldUpdate = items.length - wouldCreate;

  if (!opts.dryRun && errors.length > 0) {
    return {
      step: {
        dataset: 'SCHEDULE',
        dryRun: opts.dryRun,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
    };
  }

  if (opts.dryRun) {
    return {
      step: {
        dataset: 'SCHEDULE',
        dryRun: true,
        scanned: sliced.length,
        valid: items.length,
        wouldCreate,
        wouldUpdate,
        created: 0,
        updated: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      },
      url: fetched.safe,
      blocked: null,
    };
  }

  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    await prisma.$transaction(
      batch.map((it) =>
        prisma.planTemplateScheduleRow.upsert({
          where: {
            planTemplateId_weekIndex_dayIndex_ordinal: {
              planTemplateId: it.planTemplateId,
              weekIndex: it.weekIndex,
              dayIndex: it.dayIndex,
              ordinal: it.ordinal,
            },
          },
          update: {
            workoutLibrarySessionId: it.workoutLibrarySessionId,
            dayOfWeek: it.dayOfWeek,
            isOptional: it.isOptional,
            isOff: it.isOff,
            rawText: it.rawText,
          },
          create: {
            planTemplateId: it.planTemplateId,
            workoutLibrarySessionId: it.workoutLibrarySessionId,
            weekIndex: it.weekIndex,
            dayIndex: it.dayIndex,
            dayOfWeek: it.dayOfWeek,
            ordinal: it.ordinal,
            isOptional: it.isOptional,
            isOff: it.isOff,
            rawText: it.rawText,
          },
        })
      )
    );
  }

  return {
    step: {
      dataset: 'SCHEDULE',
      dryRun: false,
      scanned: sliced.length,
      valid: items.length,
      wouldCreate,
      wouldUpdate,
      created: wouldCreate,
      updated: wouldUpdate,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    },
    url: fetched.safe,
    blocked: null,
  };
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = new Date();

  try {
    const { user } = await requireAdmin();

    const body = bodySchema.parse(await request.json());

    if (body.reset) {
      // reset is intentionally disallowed in production.
      if (!body.dryRun && body.confirmApply === true) {
        return await maybeResetNonProd(requestId);
      }
    }

    const order: Array<'PLANS' | 'SESSIONS' | 'SCHEDULE'> =
      body.dataset === 'ALL' ? ['PLANS', 'SESSIONS', 'SCHEDULE'] : [body.dataset];

    const steps: StepSummary[] = [];
    let urlMeta: { urlHost: string; urlPath: string; resolvedSource: string } | null = null;

    let hints: { planIds: Set<string>; sessionIds: Set<string> } | null = null;

    for (const dataset of order) {
      if (dataset === 'PLANS') {
        const res = await importPlans({ requestId, dryRun: body.dryRun, limit: body.limit, offset: body.offset });
        urlMeta = urlMeta ?? res.url;
        steps.push(res.step);
        if (body.dataset === 'ALL' && body.dryRun) {
          hints = hints ?? { planIds: new Set(), sessionIds: new Set() };
          for (const id of res.planIds) hints.planIds.add(id);
        }
        if (res.blocked) return res.blocked;
        if (!body.dryRun && res.step.errorCount > 0) {
          return success({
            requestId,
            dataset: body.dataset,
            dryRun: body.dryRun,
            ...res.url,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            steps,
            message: 'Import blocked: fix row errors, then retry.',
          } satisfies ImportSummary);
        }
      }

      if (dataset === 'SESSIONS') {
        const res = await importSessions({
          requestId,
          dryRun: body.dryRun,
          limit: body.limit,
          offset: body.offset,
          createdByUserId: user.id,
        });
        urlMeta = urlMeta ?? res.url;
        steps.push(res.step);
        if (body.dataset === 'ALL' && body.dryRun) {
          hints = hints ?? { planIds: new Set(), sessionIds: new Set() };
          for (const id of res.sessionIds) hints.sessionIds.add(id);
        }
        if (res.blocked) return res.blocked;
        if (!body.dryRun && res.step.errorCount > 0) {
          return success({
            requestId,
            dataset: body.dataset,
            dryRun: body.dryRun,
            ...res.url,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            steps,
            message: 'Import blocked: fix row errors, then retry.',
          } satisfies ImportSummary);
        }
      }

      if (dataset === 'SCHEDULE') {
        const res = await importSchedule({
          requestId,
          dryRun: body.dryRun,
          limit: body.limit,
          offset: body.offset,
          resolveHints: body.dataset === 'ALL' && body.dryRun && hints ? hints : undefined,
        });
        urlMeta = urlMeta ?? res.url;
        steps.push(res.step);
        if (res.blocked) return res.blocked;
        if (!body.dryRun && res.step.errorCount > 0) {
          return success({
            requestId,
            dataset: body.dataset,
            dryRun: body.dryRun,
            ...res.url,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            steps,
            message: 'Import blocked: fix row errors, then retry.',
          } satisfies ImportSummary);
        }
      }
    }

    const finishedAt = new Date();
    const url = urlMeta ?? sanitizeUrlForLogs(getPlanLibraryDatasetUrl('PLANS'));

    return success({
      requestId,
      dataset: body.dataset,
      dryRun: body.dryRun,
      ...url,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      steps,
    } satisfies ImportSummary);
  } catch (error) {
    return handleError(error, { requestId, where: 'POST /api/admin/plan-library/import' });
  }
}
