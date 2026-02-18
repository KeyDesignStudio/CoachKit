/**
 * Batch import external plan files into PlanSource v1.
 *
 * Goals:
 * - Ingest structured plan bundles from CSV (catalogue + schedule + sessions).
 * - Ingest PDFs as additional reference plan sources.
 * - Preserve rich session details (structure_json, intensity targets, duration, distance).
 * - Produce a quality report so coaches can validate ingestion confidence.
 *
 * Run (from repo root):
 *   cd /Volumes/DockSSD/Projects/CoachKit
 *   export DATABASE_URL='postgresql://...'
 *   export APPLY='false' # dry-run by default
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
 *     apps/web/prisma/scripts/import-plan-sources-batch.ts
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import Papa from 'papaparse';
import pdfParse from 'pdf-parse';

import {
  PlanDistance,
  PlanLevel,
  PlanSourceDiscipline,
  PlanSourceType,
  PlanSport,
  Prisma,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_BASE_DIR = '/Users/gordonprice/Downloads/triathlon_training_library';
const DEFAULT_CATALOGUE = 'training_catalogue.csv';
const DEFAULT_SCHEDULE = 'training_schedule.csv';
const DEFAULT_SESSIONS = 'workout_sessions.csv';

const DEFAULT_PDFS = [
  '/Users/gordonprice/Downloads/12WkOlympicBeginner.pdf',
  '/Users/gordonprice/Downloads/10k Run_ 90 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/10k Run_ 60 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/10k Run_ 45 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/5k Run_ 45 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/5k Run_ 60 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/5k Run_ 90 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/220_Trainingplan_15_12WeekRunTraining.pdf',
  '/Users/gordonprice/Downloads/220_Trainingplan_16_4WeekDuathlon.pdf',
  '/Users/gordonprice/Downloads/220_Trainingplan_18_8WeekDuathlon.pdf',
  '/Users/gordonprice/Downloads/220_340_p094-097_TrainingPlan-6bc7136.pdf',
];

type CatalogueRow = {
  plan_id: string;
  plan_name: string;
  plan_type?: string;
  target_event?: string;
  duration_weeks?: string | number;
  cycle_length_days?: string | number;
  source_file?: string;
  race_week_index?: string | number;
  race_day_index?: string | number;
};

type ScheduleRow = {
  plan_id: string;
  week_number?: string | number;
  day_index?: string | number;
  day_key?: string;
  slot?: string | number;
  discipline?: string;
  session_id?: string;
  is_key_session?: string | boolean;
  tags?: string;
};

type SessionRow = {
  session_id: string;
  title?: string;
  discipline?: string;
  session_type?: string;
  total_distance_m?: string | number;
  total_duration_s?: string | number;
  intensity_model?: string;
  intensity_target?: string;
  structure_json?: string;
  source_ref?: string;
};

type CsvIngestionSummary = {
  plansSeen: number;
  plansPrepared: number;
  created: number;
  skippedExisting: number;
  missingSessions: number;
  missingStructure: number;
};

type PdfIngestionSummary = {
  filesSeen: number;
  filesPrepared: number;
  created: number;
  skippedExisting: number;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseCsv<T>(raw: string): T[] {
  const parsed = Papa.parse<T>(raw, { header: true, skipEmptyLines: 'greedy' });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error: ${first.message} (row ${first.row})`);
  }
  return (parsed.data ?? []).filter(Boolean);
}

function safeJson(raw: string): unknown | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

function normalizeDiscipline(raw: string): PlanSourceDiscipline {
  const v = raw.trim().toLowerCase();
  if (v.includes('swim')) return PlanSourceDiscipline.SWIM;
  if (v.includes('bike') || v.includes('cycle')) return PlanSourceDiscipline.BIKE;
  if (v.includes('run')) return PlanSourceDiscipline.RUN;
  if (v.includes('strength') || v.includes('gym')) return PlanSourceDiscipline.STRENGTH;
  return PlanSourceDiscipline.REST;
}

function normalizeSport(raw: string): PlanSport {
  const v = raw.trim().toLowerCase();
  if (v.includes('tri')) return PlanSport.TRIATHLON;
  if (v.includes('dua')) return PlanSport.DUATHLON;
  if (v.includes('bike') || v.includes('cycle')) return PlanSport.BIKE;
  if (v.includes('swim')) return PlanSport.SWIM;
  return PlanSport.RUN;
}

function normalizeDistance(raw: string): PlanDistance {
  const v = raw.trim().toLowerCase();
  if (v.includes('sprint')) return PlanDistance.SPRINT;
  if (v.includes('olympic')) return PlanDistance.OLYMPIC;
  if (v.includes('70.3') || v.includes('half ironman')) return PlanDistance.HALF_IRONMAN;
  if (v.includes('ironman')) return PlanDistance.IRONMAN;
  if (v.includes('duathlon') && v.includes('sprint')) return PlanDistance.DUATHLON_SPRINT;
  if (v.includes('duathlon')) return PlanDistance.DUATHLON_STD;
  if (v.includes('5k') || v.includes('5 km')) return PlanDistance.FIVE_K;
  if (v.includes('10k') || v.includes('10 km')) return PlanDistance.TEN_K;
  if (v.includes('half marathon')) return PlanDistance.HALF_MARATHON;
  if (v.includes('marathon')) return PlanDistance.MARATHON;
  return PlanDistance.OTHER;
}

function normalizeLevel(raw: string): PlanLevel {
  const v = raw.trim().toLowerCase();
  if (v.includes('advanced')) return PlanLevel.ADVANCED;
  if (v.includes('intermediate')) return PlanLevel.INTERMEDIATE;
  return PlanLevel.BEGINNER;
}

function inferDistanceFromFilename(name: string): PlanDistance {
  return normalizeDistance(name);
}

function inferSportFromFilename(name: string): PlanSport {
  return normalizeSport(name);
}

function compactText(lines: string[]): string {
  return lines.map((l) => l.trim()).filter(Boolean).join('\n');
}

async function ingestCsvBundle(params: {
  apply: boolean;
  cataloguePath: string;
  schedulePath: string;
  sessionsPath: string;
  activate: boolean;
}): Promise<CsvIngestionSummary> {
  const [catalogueRaw, scheduleRaw, sessionsRaw] = await Promise.all([
    fs.readFile(params.cataloguePath, 'utf8'),
    fs.readFile(params.schedulePath, 'utf8'),
    fs.readFile(params.sessionsPath, 'utf8'),
  ]);

  const catalogue = parseCsv<CatalogueRow>(catalogueRaw);
  const schedule = parseCsv<ScheduleRow>(scheduleRaw);
  const sessions = parseCsv<SessionRow>(sessionsRaw);

  const scheduleByPlan = new Map<string, ScheduleRow[]>();
  for (const row of schedule) {
    const key = asString(row.plan_id);
    if (!key) continue;
    const list = scheduleByPlan.get(key) ?? [];
    list.push(row);
    scheduleByPlan.set(key, list);
  }

  const sessionsById = new Map<string, SessionRow>();
  for (const row of sessions) {
    const id = asString(row.session_id);
    if (!id) continue;
    sessionsById.set(id, row);
  }

  const summary: CsvIngestionSummary = {
    plansSeen: catalogue.length,
    plansPrepared: 0,
    created: 0,
    skippedExisting: 0,
    missingSessions: 0,
    missingStructure: 0,
  };

  for (const plan of catalogue) {
    const planId = asString(plan.plan_id);
    const title = asString(plan.plan_name) || `Imported plan ${planId}`;
    const rows = (scheduleByPlan.get(planId) ?? []).slice().sort((a, b) => {
      const aw = asNumber(a.week_number) ?? 0;
      const bw = asNumber(b.week_number) ?? 0;
      if (aw !== bw) return aw - bw;
      const ad = asNumber(a.day_index) ?? 0;
      const bd = asNumber(b.day_index) ?? 0;
      if (ad !== bd) return ad - bd;
      const aslot = asNumber(a.slot) ?? 0;
      const bslot = asNumber(b.slot) ?? 0;
      return aslot - bslot;
    });

    if (rows.length === 0) continue;

    const weeks = new Map<number, { weekIndex: number; totalMinutes: number; totalSessions: number; notes: string | null }>();
    const ordinalsByWeek = new Map<number, number>();
    const sessionTemplates: Array<{
      weekIndex: number;
      ordinal: number;
      dayOfWeek: number | null;
      discipline: PlanSourceDiscipline;
      sessionType: string;
      title: string | null;
      durationMinutes: number | null;
      distanceKm: number | null;
      intensityType: string | null;
      intensityTargetJson: unknown | null;
      structureJson: unknown | null;
      notes: string | null;
    }> = [];

    const rawTextLines: string[] = [
      `Plan: ${title}`,
      `Source Plan ID: ${planId}`,
      `Target Event: ${asString(plan.target_event) || 'unknown'}`,
      `Duration Weeks: ${asNumber(plan.duration_weeks) ?? 'unknown'}`,
      '',
    ];

    for (const row of rows) {
      const weekNumber = Math.max(1, asNumber(row.week_number) ?? 1);
      const weekIndex = weekNumber - 1;
      const dayIndex = asNumber(row.day_index);
      const sessionId = asString(row.session_id);
      const session = sessionId ? sessionsById.get(sessionId) : undefined;
      if (!session) summary.missingSessions += 1;

      const ordinal = (ordinalsByWeek.get(weekIndex) ?? 0) + 1;
      ordinalsByWeek.set(weekIndex, ordinal);

      const durationMinutesRaw = asNumber(session?.total_duration_s);
      const durationMinutes = durationMinutesRaw != null ? Math.max(0, Math.round(durationMinutesRaw / 60)) : null;
      const distanceMeters = asNumber(session?.total_distance_m);
      const distanceKm = distanceMeters != null ? Math.max(0, distanceMeters / 1000) : null;

      const structureJson = safeJson(asString(session?.structure_json));
      if (!structureJson) summary.missingStructure += 1;

      const discipline = normalizeDiscipline(asString(row.discipline) || asString(session?.discipline));
      const sessionType = asString(session?.session_type) || 'endurance';
      const sessionTitle = asString(session?.title) || `${asString(row.day_key)} ${discipline}`;
      const intensityModel = asString(session?.intensity_model) || null;
      const intensityTarget = asString(session?.intensity_target) || null;

      sessionTemplates.push({
        weekIndex,
        ordinal,
        dayOfWeek: dayIndex != null ? Math.max(0, Math.min(6, dayIndex)) : null,
        discipline,
        sessionType,
        title: sessionTitle.slice(0, 180) || null,
        durationMinutes,
        distanceKm,
        intensityType: intensityModel,
        intensityTargetJson: intensityTarget ? { model: intensityModel, target: intensityTarget } : null,
        structureJson,
        notes: compactText(
          [
            asString(session?.source_ref) ? `Source: ${asString(session?.source_ref)}` : '',
            asString(row.tags) ? `Tags: ${asString(row.tags)}` : '',
            asString(row.is_key_session) ? `Key Session: ${asString(row.is_key_session)}` : '',
          ].filter(Boolean)
        ) || null,
      });

      const weekAgg = weeks.get(weekIndex) ?? { weekIndex, totalMinutes: 0, totalSessions: 0, notes: null };
      weekAgg.totalSessions += 1;
      weekAgg.totalMinutes += durationMinutes ?? 0;
      weeks.set(weekIndex, weekAgg);

      rawTextLines.push(
        `Week ${weekNumber} ${asString(row.day_key)}: ${sessionTitle} (${discipline}, ${sessionType}` +
          `${durationMinutes != null ? `, ${durationMinutes}min` : ''}` +
          `${distanceKm != null ? `, ${distanceKm.toFixed(1)}km` : ''})`
      );
    }

    const weekTemplates = Array.from(weeks.values()).sort((a, b) => a.weekIndex - b.weekIndex);
    const canonicalPayload = {
      plan,
      weekTemplates,
      sessionTemplates,
      source: 'csv-bundle-v1',
    };
    const checksumSha256 = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');

    summary.plansPrepared += 1;

    if (!params.apply) continue;

    const exists = await prisma.planSource.findUnique({ where: { checksumSha256 }, select: { id: true } });
    if (exists) {
      summary.skippedExisting += 1;
      continue;
    }

    const rawText = compactText(rawTextLines);
    const sport = normalizeSport(asString(plan.plan_type) || asString(plan.target_event));
    const distance = normalizeDistance(asString(plan.target_event));
    const level = normalizeLevel(asString(plan.plan_name));
    const durationWeeks = Math.max(0, Math.round(asNumber(plan.duration_weeks) ?? weekTemplates.length));

    await prisma.$transaction(async (tx) => {
      const source = await tx.planSource.create({
        data: {
          type: PlanSourceType.TEXT,
          title,
          sport,
          distance,
          level,
          durationWeeks,
          season: null,
          author: 'CoachKit batch importer',
          publisher: 'CoachKit',
          sourceFilePath: [params.cataloguePath, params.schedulePath, params.sessionsPath].join(' | '),
          checksumSha256,
          isActive: params.activate,
          rawText,
          rawJson: {
            importer: 'batch-v1',
            planId,
            cycleLengthDays: asNumber(plan.cycle_length_days),
            raceWeekIndex: asNumber(plan.race_week_index),
            raceDayIndex: asNumber(plan.race_day_index),
            quality: {
              missingSessions: sessionTemplates.filter((s) => !s.title).length,
            },
          },
        },
      });

      const version = await tx.planSourceVersion.create({
        data: {
          planSourceId: source.id,
          version: 1,
          extractionMetaJson: {
            sourceType: 'CSV_BUNDLE',
            weekCount: weekTemplates.length,
            sessionCount: sessionTemplates.length,
            confidence: 0.92,
          },
        },
      });

      const createdWeeks = await tx.planSourceWeekTemplate.createManyAndReturn({
        data: weekTemplates.map((w) => ({
          planSourceVersionId: version.id,
          weekIndex: w.weekIndex,
          totalMinutes: w.totalMinutes,
          totalSessions: w.totalSessions,
          notes: w.notes,
        })),
        select: { id: true, weekIndex: true },
      });
      const weekIdByIndex = new Map(createdWeeks.map((w) => [w.weekIndex, w.id]));

      await tx.planSourceSessionTemplate.createMany({
        data: sessionTemplates
          .filter((s) => weekIdByIndex.has(s.weekIndex))
          .map((s) => ({
            planSourceWeekTemplateId: weekIdByIndex.get(s.weekIndex)!,
            ordinal: s.ordinal,
            dayOfWeek: s.dayOfWeek,
            discipline: s.discipline,
            sessionType: s.sessionType,
            title: s.title,
            durationMinutes: s.durationMinutes,
            distanceKm: s.distanceKm,
            intensityType: s.intensityType,
            intensityTargetJson: (s.intensityTargetJson ?? Prisma.JsonNull) as any,
            structureJson: (s.structureJson ?? Prisma.JsonNull) as any,
            notes: s.notes,
          })),
      });
    });

    summary.created += 1;
  }

  return summary;
}

function extractPdfSessions(rawText: string): Array<{
  weekIndex: number;
  ordinal: number;
  dayOfWeek: number | null;
  discipline: PlanSourceDiscipline;
  sessionType: string;
  title: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  notes: string | null;
}> {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sessions: ReturnType<typeof extractPdfSessions> = [];
  let week = 0;
  let ordinal = 0;

  for (const line of lines) {
    const weekMatch = line.match(/\bweek\s*(\d{1,2})\b/i);
    if (weekMatch) {
      week = Math.max(0, (Number(weekMatch[1]) || 1) - 1);
      ordinal = 0;
      continue;
    }

    const looksSession =
      /\b(swim|bike|run|strength|rest|warm up|cool down|interval|tempo|easy|recovery)\b/i.test(line) ||
      /\b\d+\s*(km|m|min|mins|minutes)\b/i.test(line);
    if (!looksSession) continue;

    ordinal += 1;
    const duration = line.match(/(\d{1,3})\s*(min|mins|minutes)\b/i);
    const km = line.match(/(\d+(?:\.\d+)?)\s*km\b/i);

    sessions.push({
      weekIndex: week,
      ordinal,
      dayOfWeek: null,
      discipline: normalizeDiscipline(line),
      sessionType: /\binterval|tempo|threshold|vo2\b/i.test(line) ? 'interval' : 'endurance',
      title: line.slice(0, 180),
      durationMinutes: duration ? Number(duration[1]) : null,
      distanceKm: km ? Number(km[1]) : null,
      notes: line,
    });
  }
  return sessions;
}

async function ingestPdfs(params: { apply: boolean; files: string[]; activate: boolean }): Promise<PdfIngestionSummary> {
  const summary: PdfIngestionSummary = {
    filesSeen: params.files.length,
    filesPrepared: 0,
    created: 0,
    skippedExisting: 0,
  };

  for (const pdfPath of params.files) {
    try {
      const buffer = await fs.readFile(pdfPath);
      const parsed = await pdfParse(buffer);
      const rawText = asString(parsed.text);
      if (!rawText) continue;

      const sessions = extractPdfSessions(rawText);
      const weekMax = sessions.reduce((max, s) => Math.max(max, s.weekIndex), 0);
      const weekTemplates = Array.from({ length: weekMax + 1 }, (_, i) => i).map((weekIndex) => {
        const ws = sessions.filter((s) => s.weekIndex === weekIndex);
        return {
          weekIndex,
          totalMinutes: ws.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0) || null,
          totalSessions: ws.length || null,
          notes: null as string | null,
        };
      });

      const checksumSha256 = createHash('sha256').update(buffer).digest('hex');
      summary.filesPrepared += 1;

      if (!params.apply) continue;

      const exists = await prisma.planSource.findUnique({ where: { checksumSha256 }, select: { id: true } });
      if (exists) {
        summary.skippedExisting += 1;
        continue;
      }

      const title = path.basename(pdfPath, '.pdf').slice(0, 180);
      const sport = inferSportFromFilename(title);
      const distance = inferDistanceFromFilename(title);

      await prisma.$transaction(async (tx) => {
        const source = await tx.planSource.create({
          data: {
            type: PlanSourceType.PDF,
            title,
            sport,
            distance,
            level: normalizeLevel(title),
            durationWeeks: weekTemplates.length || 0,
            season: null,
            author: null,
            publisher: null,
            sourceFilePath: pdfPath,
            checksumSha256,
            isActive: params.activate,
            rawText,
            rawJson: {
              importer: 'batch-v1',
              sourceType: 'PDF',
              pageCount: parsed.numpages ?? null,
            },
          },
        });

        const version = await tx.planSourceVersion.create({
          data: {
            planSourceId: source.id,
            version: 1,
            extractionMetaJson: {
              sourceType: 'PDF',
              weekCount: weekTemplates.length,
              sessionCount: sessions.length,
              confidence: sessions.length > 0 ? 0.72 : 0.4,
            },
          },
        });

        const createdWeeks = await tx.planSourceWeekTemplate.createManyAndReturn({
          data: weekTemplates.map((w) => ({
            planSourceVersionId: version.id,
            weekIndex: w.weekIndex,
            totalMinutes: w.totalMinutes,
            totalSessions: w.totalSessions,
            notes: w.notes,
          })),
          select: { id: true, weekIndex: true },
        });
        const weekIdByIndex = new Map(createdWeeks.map((w) => [w.weekIndex, w.id]));

        await tx.planSourceSessionTemplate.createMany({
          data: sessions
            .filter((s) => weekIdByIndex.has(s.weekIndex))
            .map((s) => ({
              planSourceWeekTemplateId: weekIdByIndex.get(s.weekIndex)!,
              ordinal: s.ordinal,
              dayOfWeek: s.dayOfWeek,
              discipline: s.discipline,
              sessionType: s.sessionType,
              title: s.title,
              durationMinutes: s.durationMinutes,
              distanceKm: s.distanceKm,
              intensityType: null,
              intensityTargetJson: Prisma.JsonNull,
              structureJson: Prisma.JsonNull,
              notes: s.notes,
            })),
        });
      });

      summary.created += 1;
    } catch (error) {
      console.warn(`[pdf-skip] ${pdfPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return summary;
}

async function main() {
  const apply = asString(process.env.APPLY).toLowerCase() === 'true';
  const activate = asString(process.env.ACTIVATE_IMPORTED || 'true').toLowerCase() !== 'false';

  const baseDir = process.env.PLAN_LIBRARY_BASE_DIR || DEFAULT_BASE_DIR;
  const cataloguePath = process.env.PLAN_LIBRARY_CATALOGUE_PATH || path.join(baseDir, DEFAULT_CATALOGUE);
  const schedulePath = process.env.PLAN_LIBRARY_SCHEDULE_PATH || path.join(baseDir, DEFAULT_SCHEDULE);
  const sessionsPath = process.env.PLAN_LIBRARY_SESSIONS_PATH || path.join(baseDir, DEFAULT_SESSIONS);
  const pdfs = (process.env.PLAN_LIBRARY_PDFS
    ? process.env.PLAN_LIBRARY_PDFS.split(',').map((p) => p.trim()).filter(Boolean)
    : DEFAULT_PDFS
  ).filter(Boolean);

  console.log('[plan-source-batch] Starting');
  console.log('[plan-source-batch] Mode:', apply ? 'APPLY' : 'DRY_RUN');
  console.log('[plan-source-batch] Activate imported sources:', activate ? 'true' : 'false');

  const csvSummary = await ingestCsvBundle({
    apply,
    cataloguePath,
    schedulePath,
    sessionsPath,
    activate,
  });
  const pdfSummary = await ingestPdfs({ apply, files: pdfs, activate });

  const report = {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    csv: csvSummary,
    pdf: pdfSummary,
    inputs: {
      cataloguePath,
      schedulePath,
      sessionsPath,
      pdfCount: pdfs.length,
    },
  };

  console.log('[plan-source-batch] Report');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('[plan-source-batch] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
