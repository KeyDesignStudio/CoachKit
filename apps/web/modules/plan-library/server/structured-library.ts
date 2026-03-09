import { createHash } from 'node:crypto';

import type {
  PlanDistance,
  PlanLevel,
  PlanLibraryImportJobStatus,
  PlanLibraryImportSourceType,
  PlanLibraryTemplateReviewStatus,
  PlanSourceDiscipline,
  PlanSport,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { planSourceBlobStorageConfigured, storePlanSourceDocument } from './document-storage';
import { extractPlanSourceWithRobustPipeline } from './robust-extract';
import { parsePlanDistance, parsePlanSeason } from './ingest';

type ParseIssue = {
  row: number;
  field: string;
  severity: 'error' | 'warning';
  message: string;
};

type DraftRow = {
  weekIndex: number;
  dayOfWeek: number;
  discipline: PlanSourceDiscipline;
  sessionType: string;
  title: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  intensityType: string | null;
  intensityTargetJson: Prisma.InputJsonValue | null;
  recipeV2Json: Prisma.InputJsonValue | null;
  notes: string | null;
  blockName: string | null;
  phaseTag: string | null;
  targetLoadScore: number | null;
  sourceConfidence: number | null;
  needsReview: boolean;
};

async function rebuildTemplateExemplarLinks(params: {
  tx: Prisma.TransactionClient;
  templateId: string;
  coachId: string;
}) {
  const sessions = await params.tx.planLibraryTemplateSession.findMany({
    where: {
      planTemplateWeek: {
        planTemplateId: params.templateId,
      },
    },
    select: {
      id: true,
      discipline: true,
      sessionType: true,
      sourceConfidence: true,
    },
  });

  await params.tx.planLibraryTemplateExemplarLink.deleteMany({
    where: { planTemplateId: params.templateId },
  });

  if (!sessions.length) return;

  const links: Array<{
    planTemplateId: string;
    planSessionId: string;
    retrievalKey: string;
    retrievalWeight: number;
    isActive: boolean;
  }> = [];

  for (const session of sessions) {
    const discipline = String(session.discipline).toUpperCase();
    const sessionType = String(session.sessionType).trim().toLowerCase() || 'endurance';
    const baseWeight = Math.max(0.2, Math.min(2, Number(session.sourceConfidence ?? 1)));
    links.push({
      planTemplateId: params.templateId,
      planSessionId: session.id,
      retrievalKey: `coach:${params.coachId}|disc:${discipline}|type:${sessionType}`,
      retrievalWeight: baseWeight,
      isActive: true,
    });
    links.push({
      planTemplateId: params.templateId,
      planSessionId: session.id,
      retrievalKey: `global|disc:${discipline}|type:${sessionType}`,
      retrievalWeight: Math.max(0.1, baseWeight * 0.7),
      isActive: true,
    });
  }

  await params.tx.planLibraryTemplateExemplarLink.createMany({
    data: links,
  });
}

function asString(v: FormDataEntryValue | null) {
  return typeof v === 'string' ? v.trim() : '';
}

function parseSport(raw: string): PlanSport {
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'TRIATHLON') return 'TRIATHLON';
  if (normalized === 'DUATHLON') return 'DUATHLON';
  if (normalized === 'RUN') return 'RUN';
  if (normalized === 'BIKE') return 'BIKE';
  if (normalized === 'SWIM') return 'SWIM';
  throw new ApiError(400, 'INVALID_SPORT', 'sport must be TRIATHLON, DUATHLON, RUN, BIKE, or SWIM.');
}

function parseLevel(raw: string): PlanLevel {
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'BEGINNER') return 'BEGINNER';
  if (normalized === 'INTERMEDIATE') return 'INTERMEDIATE';
  if (normalized === 'ADVANCED') return 'ADVANCED';
  throw new ApiError(400, 'INVALID_LEVEL', 'level must be BEGINNER, INTERMEDIATE, or ADVANCED.');
}

function parseImportSourceType(raw: string): PlanLibraryImportSourceType {
  const normalized = raw.trim().toUpperCase().replace(/-/g, '_');
  if (normalized === 'CSV') return 'CSV';
  if (normalized === 'XLSX') return 'XLSX';
  if (normalized === 'PDF_ASSIST') return 'PDF_ASSIST';
  throw new ApiError(400, 'INVALID_SOURCE_TYPE', 'sourceType must be CSV, XLSX, or PDF_ASSIST.');
}

function parseDiscipline(raw: string): PlanSourceDiscipline {
  const normalized = raw.trim().toUpperCase();
  if (
    normalized === 'SWIM_OPEN_WATER' ||
    normalized === 'SWIM OPEN WATER' ||
    normalized === 'OPEN_WATER_SWIM' ||
    normalized === 'OPEN WATER SWIM' ||
    normalized === 'OWS'
  ) {
    return 'SWIM_OPEN_WATER';
  }
  if (normalized === 'SWIM') return 'SWIM';
  if (normalized === 'BIKE') return 'BIKE';
  if (normalized === 'RUN') return 'RUN';
  if (normalized === 'BRICK') return 'BRICK';
  if (normalized === 'STRENGTH') return 'STRENGTH';
  if (normalized === 'REST' || normalized === 'REST_DAY' || normalized === 'REST-DAY') return 'REST';
  throw new Error('discipline must be SWIM, SWIM_OPEN_WATER, BIKE, RUN, BRICK, STRENGTH, or REST.');
}

function toNullableNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function tryParseJson(raw: unknown): Prisma.InputJsonValue | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Prisma.InputJsonValue) : null;
  } catch {
    return null;
  }
}

function milesToKm(value: number) {
  return value * 1.60934;
}

function normalizeDistanceKmFromRow(distanceRaw: unknown, unitRaw: unknown) {
  const value = toNullableNumber(distanceRaw);
  if (value == null) return null;
  const unit = String(unitRaw ?? '').trim().toLowerCase();
  if (unit.startsWith('mi')) return Number(milesToKm(value).toFixed(2));
  return value;
}

function parseCsvDraftRows(csvText: string) {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) {
    throw new ApiError(400, 'CSV_PARSE_FAILED', parsed.errors[0]?.message ?? 'Unable to parse CSV.');
  }

  const issues: ParseIssue[] = [];
  const rows: DraftRow[] = [];
  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const weekIndex = Math.max(1, Math.floor(toNullableNumber(row.weekIndex) ?? 0));
      const dayOfWeek = Math.max(1, Math.min(7, Math.floor(toNullableNumber(row.dayOfWeek) ?? 0)));
      if (!weekIndex || !dayOfWeek) {
        throw new Error('weekIndex and dayOfWeek are required.');
      }
      const sessionType = String(row.sessionType ?? '').trim() || 'endurance';
      rows.push({
        weekIndex,
        dayOfWeek,
        discipline: parseDiscipline(String(row.discipline ?? '')),
        sessionType,
        title: String(row.title ?? '').trim() || null,
        durationMinutes: toNullableNumber(row.durationMinutes),
        distanceKm: normalizeDistanceKmFromRow(row.distanceKm, row.distanceUnit),
        intensityType: String(row.intensityType ?? '').trim() || null,
        intensityTargetJson: tryParseJson(row.intensityTargetJson),
        recipeV2Json: tryParseJson(row.recipeV2Json),
        notes: String(row.notes ?? '').trim() || null,
        blockName: String(row.blockName ?? '').trim() || null,
        phaseTag: String(row.phaseTag ?? '').trim() || null,
        targetLoadScore: toNullableNumber(row.targetLoadScore),
        sourceConfidence: toNullableNumber(row.sourceConfidence) ?? 1,
        needsReview: String(row.needsReview ?? '').trim().toLowerCase() === 'true',
      });
    } catch (error) {
      issues.push({
        row: rowNumber,
        field: 'row',
        severity: 'error',
        message: error instanceof Error ? error.message : 'Invalid row.',
      });
    }
  });

  return { rows, issues };
}

function parseXlsxDraftRows(content: Buffer) {
  const workbook = XLSX.read(content, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ApiError(400, 'XLSX_PARSE_FAILED', 'Workbook has no sheets.');
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  const csv = Papa.unparse(rows);
  return parseCsvDraftRows(csv);
}

async function draftRowsFromPdfAssistExtraction(params: {
  durationWeeks: number;
  rawText: string;
  contentBytes: Buffer;
  title: string;
  sport: PlanSport;
  distance: PlanDistance;
  level: PlanLevel;
}) {
  const extracted = await extractPlanSourceWithRobustPipeline({
    type: 'PDF',
    contentBytes: params.contentBytes,
    rawText: params.rawText,
    durationWeeks: params.durationWeeks,
    title: params.title,
    sport: params.sport,
    distance: params.distance,
    level: params.level,
  });
  return extracted.sessions.map<DraftRow>((session) => ({
    weekIndex: session.weekIndex,
    dayOfWeek: session.dayOfWeek ?? 1,
    discipline: session.discipline,
    sessionType: session.sessionType,
    title: session.title ?? null,
    durationMinutes: session.durationMinutes ?? null,
    distanceKm: session.distanceKm ?? null,
    intensityType: session.intensityType ?? null,
    intensityTargetJson:
      session.intensityTargetJson && typeof session.intensityTargetJson === 'object'
        ? (session.intensityTargetJson as Prisma.InputJsonValue)
        : null,
    recipeV2Json:
      session.recipeV2Json && typeof session.recipeV2Json === 'object'
        ? (session.recipeV2Json as Prisma.InputJsonValue)
        : null,
    notes: session.notes ?? null,
    blockName: null,
    phaseTag: null,
    targetLoadScore: null,
    sourceConfidence: session.parserConfidence ?? extracted.confidence,
    needsReview: true,
  }));
}

export async function createPlanLibraryImportJob(params: { form: FormData; userId: string }) {
  const sourceType = parseImportSourceType(asString(params.form.get('sourceType')) || 'CSV');
  const title = asString(params.form.get('title'));
  const sport = parseSport(asString(params.form.get('sport')) || 'TRIATHLON');
  const distance = parsePlanDistance(asString(params.form.get('distance')) || 'OTHER');
  const level = parseLevel(asString(params.form.get('level')) || 'BEGINNER');
  const durationWeeks = Math.max(1, Math.floor(Number(asString(params.form.get('durationWeeks')) || '1')));
  const author = asString(params.form.get('author')) || null;
  const publisher = asString(params.form.get('publisher')) || null;
  const season = parsePlanSeason(asString(params.form.get('season')) || '');

  const file = params.form.get('file');
  if (!file || typeof file === 'string') {
    throw new ApiError(400, 'FILE_REQUIRED', 'A file is required.');
  }

  const content = Buffer.from(await file.arrayBuffer());
  const checksum = createHash('sha256').update(content).digest('hex');
  const fileName = file.name || `${sourceType.toLowerCase()}-upload`;
  const contentType = file.type || 'application/octet-stream';
  const uploaded = planSourceBlobStorageConfigured()
    ? await storePlanSourceDocument({
        checksumSha256: checksum,
        content,
        fileName,
        contentType,
      })
    : null;

  const job = await prisma.planLibraryImportJob.create({
    data: {
      sourceType,
      status: 'PROCESSING',
      createdBy: params.userId,
      rawFileUrl: uploaded?.url ?? null,
      rawFileName: fileName,
      checksum,
      draftJson: {
        title,
        sport,
        distance,
        level,
        durationWeeks,
        season,
        author,
        publisher,
        rows: [],
      } as Prisma.InputJsonValue,
    },
  });

  let status: PlanLibraryImportJobStatus = 'COMPLETED';
  let errorJson: Record<string, unknown> | null = null;
  let issues: ParseIssue[] = [];
  let rows: DraftRow[] = [];

  try {
    if (sourceType === 'PDF_ASSIST') {
      rows = await draftRowsFromPdfAssistExtraction({
        durationWeeks,
        rawText: '',
        contentBytes: content,
        title,
        sport,
        distance,
        level,
      });
    } else if (sourceType === 'XLSX') {
      const parsed = parseXlsxDraftRows(content);
      rows = parsed.rows;
      issues = parsed.issues;
    } else {
      const csvText = content.toString('utf-8');
      const parsed = parseCsvDraftRows(csvText);
      rows = parsed.rows;
      issues = parsed.issues;
    }
  } catch (error) {
    status = 'FAILED';
    errorJson = {
      message: error instanceof Error ? error.message : 'Import failed.',
      code: error instanceof ApiError ? error.code : 'IMPORT_FAILED',
    };
  }

  const updated = await prisma.planLibraryImportJob.update({
    where: { id: job.id },
    data: {
      status,
      completedAt: new Date(),
      errorJson: (errorJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      parseStatsJson: {
        totalRows: rows.length,
        issueCount: issues.length,
        hardErrors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      } as Prisma.InputJsonValue,
      draftJson: {
        title,
        sport,
        distance,
        level,
        durationWeeks,
        season,
        author,
        publisher,
        rows,
        issues,
      } as Prisma.InputJsonValue,
    },
  });

  return updated;
}

export async function getPlanLibraryImportJob(importJobId: string) {
  const job = await prisma.planLibraryImportJob.findUnique({
    where: { id: importJobId },
    include: {
      template: {
        select: { id: true, title: true, reviewStatus: true, isPublished: true, updatedAt: true },
      },
    },
  });
  if (!job) throw new ApiError(404, 'IMPORT_JOB_NOT_FOUND', 'Import job not found.');
  return job;
}

export async function commitPlanLibraryImportDraft(params: { importJobId: string; userId: string }) {
  const job = await getPlanLibraryImportJob(params.importJobId);
  if (job.status !== 'COMPLETED') {
    throw new ApiError(400, 'IMPORT_NOT_READY', 'Import job must be completed before committing draft.');
  }
  const draft = (job.draftJson ?? {}) as Record<string, any>;
  const rows = Array.isArray(draft.rows) ? (draft.rows as DraftRow[]) : [];
  if (!rows.length) {
    throw new ApiError(400, 'NO_ROWS', 'No parsed rows available to commit.');
  }
  const title = String(draft.title ?? '').trim();
  if (!title) throw new ApiError(400, 'TITLE_REQUIRED', 'Template title is required.');

  const template = await prisma.$transaction(async (tx) => {
    const targetTemplateId = job.templateId ?? null;
    const template = targetTemplateId
      ? await tx.planLibraryTemplate.update({
          where: { id: targetTemplateId },
          data: {
            title,
            sport: draft.sport as PlanSport,
            distance: draft.distance as PlanDistance,
            level: draft.level as PlanLevel,
            durationWeeks: Math.max(1, Number(draft.durationWeeks ?? 1)),
            author: draft.author ? String(draft.author) : null,
            publisher: draft.publisher ? String(draft.publisher) : null,
            reviewStatus: 'DRAFT',
            isPublished: false,
            publishedAt: null,
          },
        })
      : await tx.planLibraryTemplate.create({
          data: {
            title,
            sport: draft.sport as PlanSport,
            distance: draft.distance as PlanDistance,
            level: draft.level as PlanLevel,
            durationWeeks: Math.max(1, Number(draft.durationWeeks ?? 1)),
            author: draft.author ? String(draft.author) : null,
            publisher: draft.publisher ? String(draft.publisher) : null,
            createdBy: params.userId,
            reviewStatus: 'DRAFT',
          },
        });

    await tx.planLibraryTemplateSession.deleteMany({
      where: { planTemplateWeek: { planTemplateId: template.id } },
    });
    await tx.planLibraryTemplateWeek.deleteMany({
      where: { planTemplateId: template.id },
    });

    const weekIndexes = [...new Set(rows.map((row) => row.weekIndex))].sort((a, b) => a - b);
    const weekByIndex = new Map<number, string>();
    for (const weekIndex of weekIndexes) {
      const row = rows.find((candidate) => candidate.weekIndex === weekIndex) ?? null;
      const week = await tx.planLibraryTemplateWeek.create({
        data: {
          planTemplateId: template.id,
          weekIndex,
          blockName: row?.blockName ?? null,
          phaseTag: row?.phaseTag ?? null,
          targetLoadScore: row?.targetLoadScore ?? null,
        },
      });
      weekByIndex.set(weekIndex, week.id);
    }

    for (const [ordinal, row] of rows.entries()) {
      const weekId = weekByIndex.get(row.weekIndex);
      if (!weekId) continue;
      await tx.planLibraryTemplateSession.create({
        data: {
          planTemplateWeekId: weekId,
          dayOfWeek: row.dayOfWeek,
          discipline: row.discipline,
          sessionType: row.sessionType,
          title: row.title,
          durationMinutes: row.durationMinutes,
          distanceKm: row.distanceKm,
          intensityType: row.intensityType,
          intensityTargetJson: (row.intensityTargetJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          recipeV2Json: (row.recipeV2Json ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          notes: row.notes,
          sourceConfidence: row.sourceConfidence,
          needsReview: row.needsReview,
          createdAt: new Date(Date.now() + ordinal),
        },
      });
    }

    await rebuildTemplateExemplarLinks({
      tx,
      templateId: template.id,
      coachId: template.createdBy,
    });

    await tx.planLibraryImportJob.update({
      where: { id: params.importJobId },
      data: {
        status: 'COMPLETED',
        templateId: template.id,
      },
    });
    return template;
  });

  return template;
}

export async function listPlanLibraryTemplates(params: {
  reviewStatus?: PlanLibraryTemplateReviewStatus | null;
  isPublished?: boolean | null;
}) {
  return prisma.planLibraryTemplate.findMany({
    where: {
      reviewStatus: params.reviewStatus ?? undefined,
      isPublished: params.isPublished ?? undefined,
    },
    include: {
      weeks: {
        select: {
          id: true,
          weekIndex: true,
          _count: { select: { sessions: true } },
        },
        orderBy: { weekIndex: 'asc' },
      },
      validationRuns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });
}

export async function getPlanLibraryTemplate(templateId: string) {
  const template = await prisma.planLibraryTemplate.findUnique({
    where: { id: templateId },
    include: {
      weeks: {
        include: {
          sessions: {
            orderBy: [{ dayOfWeek: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { weekIndex: 'asc' },
      },
      validationRuns: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      exemplarLinks: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!template) throw new ApiError(404, 'PLAN_TEMPLATE_NOT_FOUND', 'Template not found.');
  return template;
}

export async function updatePlanLibraryTemplateSession(params: {
  templateId: string;
  sessionId: string;
  payload: Partial<{
    dayOfWeek: number;
    discipline: PlanSourceDiscipline;
    sessionType: string;
    title: string | null;
    durationMinutes: number | null;
    distanceKm: number | null;
    intensityType: string | null;
    intensityTargetJson: Prisma.InputJsonValue | null;
    recipeV2Json: Prisma.InputJsonValue | null;
    notes: string | null;
    needsReview: boolean;
  }>;
}) {
  const session = await prisma.planLibraryTemplateSession.findFirst({
    where: {
      id: params.sessionId,
      planTemplateWeek: { planTemplateId: params.templateId },
    },
  });
  if (!session) throw new ApiError(404, 'PLAN_TEMPLATE_SESSION_NOT_FOUND', 'Session not found.');

  const updated = await prisma.planLibraryTemplateSession.update({
    where: { id: session.id },
    data: {
      dayOfWeek: params.payload.dayOfWeek ?? undefined,
      discipline: params.payload.discipline ?? undefined,
      sessionType: params.payload.sessionType?.trim() || undefined,
      title: params.payload.title ?? undefined,
      durationMinutes: params.payload.durationMinutes ?? undefined,
      distanceKm: params.payload.distanceKm ?? undefined,
      intensityType: params.payload.intensityType ?? undefined,
      intensityTargetJson:
        params.payload.intensityTargetJson === undefined
          ? undefined
          : ((params.payload.intensityTargetJson ?? Prisma.JsonNull) as Prisma.InputJsonValue),
      recipeV2Json:
        params.payload.recipeV2Json === undefined
          ? undefined
          : ((params.payload.recipeV2Json ?? Prisma.JsonNull) as Prisma.InputJsonValue),
      notes: params.payload.notes ?? undefined,
      needsReview: params.payload.needsReview ?? undefined,
    },
  });

  const template = await prisma.planLibraryTemplate.findUnique({
    where: { id: params.templateId },
    select: { id: true, createdBy: true },
  });
  if (template) {
    await prisma.$transaction(async (tx) => {
      await rebuildTemplateExemplarLinks({
        tx,
        templateId: template.id,
        coachId: template.createdBy,
      });
    });
  }

  return updated;
}

export async function validatePlanLibraryTemplate(templateId: string) {
  const template = await getPlanLibraryTemplate(templateId);
  const issues: Array<{ type: 'hard' | 'soft'; code: string; message: string }> = [];
  const sessions = template.weeks.flatMap((week) => week.sessions);
  const hardMissing = sessions.filter(
    (session) => !session.discipline || !session.sessionType || session.dayOfWeek < 1 || session.dayOfWeek > 7
  );
  if (hardMissing.length) {
    issues.push({
      type: 'hard',
      code: 'MISSING_REQUIRED_FIELDS',
      message: `${hardMissing.length} sessions are missing required discipline/session/day fields.`,
    });
  }
  const unresolved = sessions.filter((session) => session.needsReview);
  if (unresolved.length) {
    issues.push({
      type: 'soft',
      code: 'NEEDS_REVIEW_ROWS',
      message: `${unresolved.length} sessions are still marked needsReview.`,
    });
  }
  const missingLoadWeeks = template.weeks.filter((week) => week.targetLoadScore == null);
  if (missingLoadWeeks.length) {
    issues.push({
      type: 'soft',
      code: 'MISSING_LOAD_SCORE',
      message: `${missingLoadWeeks.length} weeks have no target load score.`,
    });
  }

  for (const week of template.weeks) {
    const daySet = new Set(week.sessions.map((session) => session.dayOfWeek));
    if (daySet.size !== week.sessions.length) {
      issues.push({
        type: 'hard',
        code: 'DUPLICATE_DAY_SESSIONS',
        message: `Week ${week.weekIndex} contains duplicate day assignments.`,
      });
    }

    const disciplineCount = week.sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.discipline] = (acc[session.discipline] ?? 0) + 1;
      return acc;
    }, {});
    const runCount = (disciplineCount.RUN ?? 0) + (disciplineCount.BRICK ?? 0);
    const bikeCount = (disciplineCount.BIKE ?? 0) + (disciplineCount.BRICK ?? 0);
    const swimCount = (disciplineCount.SWIM ?? 0) + (disciplineCount.SWIM_OPEN_WATER ?? 0);
    if (template.sport === 'TRIATHLON' && (runCount === 0 || bikeCount === 0 || swimCount === 0)) {
      issues.push({
        type: 'soft',
        code: 'DISCIPLINE_IMBALANCE',
        message: `Week ${week.weekIndex} misses one or more core triathlon disciplines.`,
      });
    }

    const sorted = [...week.sessions].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    let hardChain = 0;
    for (const session of sorted) {
      const hardSignal =
        (session.intensityType ?? '').toLowerCase().includes('tempo') ||
        (session.sessionType ?? '').toLowerCase().includes('interval') ||
        (session.sessionType ?? '').toLowerCase().includes('time-trial');
      if (hardSignal) hardChain += 1;
      else hardChain = 0;
      if (hardChain >= 3) {
        issues.push({
          type: 'soft',
          code: 'RECOVERY_SPACING',
          message: `Week ${week.weekIndex} has 3+ hard sessions back-to-back without clear recovery spacing.`,
        });
        break;
      }
    }
  }

  const weekDurations = template.weeks.map((week) =>
    week.sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0)
  );
  if (weekDurations.length >= 3) {
    for (let index = 1; index < weekDurations.length; index += 1) {
      const previous = weekDurations[index - 1] ?? 0;
      const current = weekDurations[index] ?? 0;
      if (previous > 0 && current > previous * 1.25) {
        issues.push({
          type: 'soft',
          code: 'LOAD_JUMP',
          message: `Week ${index + 1} load jumps >25% versus prior week (progression risk).`,
        });
      }
    }
    const average = weekDurations.reduce((sum, value) => sum + value, 0) / weekDurations.length;
    if (average > 0) {
      const variance =
        weekDurations.reduce((sum, value) => sum + (value - average) ** 2, 0) / weekDurations.length;
      const monotony = average / Math.sqrt(Math.max(variance, 1));
      if (monotony > 2.2) {
        issues.push({
          type: 'soft',
          code: 'MONOTONY_RISK',
          message: `Monotony score ${monotony.toFixed(2)} is high; add variability and recovery contrast.`,
        });
      }
    }
  }

  const hardCount = issues.filter((issue) => issue.type === 'hard').length;
  const softCount = issues.filter((issue) => issue.type === 'soft').length;
  const score = Math.max(0, 1 - hardCount * 0.4 - softCount * 0.08);
  const passed = hardCount === 0 && score >= 0.75;

  const run = await prisma.planLibraryTemplateValidationRun.create({
    data: {
      planTemplateId: templateId,
      score,
      passed,
      issuesJson: issues,
    },
  });

  await prisma.planLibraryTemplate.update({
    where: { id: templateId },
    data: {
      qualityScore: score,
      reviewStatus: passed ? 'REVIEWED' : 'DRAFT',
    },
  });

  return run;
}

export async function publishPlanLibraryTemplate(templateId: string) {
  const latestValidation = await prisma.planLibraryTemplateValidationRun.findFirst({
    where: { planTemplateId: templateId },
    orderBy: { createdAt: 'desc' },
  });
  if (!latestValidation) {
    throw new ApiError(400, 'VALIDATION_REQUIRED', 'Run validation before publishing.');
  }
  if (!latestValidation.passed || latestValidation.score < 0.75) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Validation threshold not met; publishing is blocked.');
  }

  const updated = await prisma.planLibraryTemplate.update({
    where: { id: templateId },
    data: {
      isPublished: true,
      publishedAt: new Date(),
      reviewStatus: 'PUBLISHED',
      qualityScore: latestValidation.score,
    },
  });

  await prisma.$transaction(async (tx) => {
    await rebuildTemplateExemplarLinks({
      tx,
      templateId: updated.id,
      coachId: updated.createdBy,
    });
  });

  return updated;
}

export async function getPlanLibraryTemplateAnalytics() {
  const [templates, validationRuns, importJobs, feedback] = await Promise.all([
    prisma.planLibraryTemplate.findMany({
      include: {
        weeks: {
          include: {
            sessions: {
              select: { needsReview: true },
            },
          },
        },
        exemplarLinks: {
          where: { isActive: true },
          select: { retrievalWeight: true },
        },
      },
    }),
    prisma.planLibraryTemplateValidationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { passed: true, score: true, createdAt: true },
    }),
    prisma.planLibraryImportJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { status: true, sourceType: true, createdAt: true },
    }),
    prisma.coachWorkoutExemplarFeedback.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60),
        },
      },
      select: { feedbackType: true, createdAt: true },
    }),
  ]);

  const totalTemplates = templates.length;
  const publishedTemplates = templates.filter((template) => template.isPublished).length;
  const unresolvedSessions = templates
    .flatMap((template) => template.weeks.flatMap((week) => week.sessions))
    .filter((session) => session.needsReview).length;
  const averageQualityScore =
    totalTemplates > 0
      ? templates.reduce((sum, template) => sum + Number(template.qualityScore ?? 0), 0) / totalTemplates
      : 0;

  const validationPassRate =
    validationRuns.length > 0 ? validationRuns.filter((run) => run.passed).length / validationRuns.length : 0;

  const now = Date.now();
  const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
  const currentWindow = feedback.filter((entry) => entry.createdAt.getTime() >= now - thirtyDaysMs);
  const previousWindow = feedback.filter(
    (entry) => entry.createdAt.getTime() < now - thirtyDaysMs && entry.createdAt.getTime() >= now - thirtyDaysMs * 2
  );

  const computeRates = (rows: typeof feedback) => {
    const total = rows.length || 1;
    const edited = rows.filter((row) => row.feedbackType === 'EDITED').length;
    const rejected = rows.filter((row) => row.feedbackType === 'TOO_EASY' || row.feedbackType === 'TOO_HARD').length;
    const goodFit = rows.filter((row) => row.feedbackType === 'GOOD_FIT').length;
    return {
      editRate: edited / total,
      rejectionRate: rejected / total,
      goodFitRate: goodFit / total,
    };
  };

  const currentRates = computeRates(currentWindow);
  const previousRates = computeRates(previousWindow);

  const topTemplates = templates
    .map((template) => ({
      id: template.id,
      title: template.title,
      isPublished: template.isPublished,
      qualityScore: template.qualityScore,
      unresolvedSessions: template.weeks.flatMap((week) => week.sessions).filter((session) => session.needsReview).length,
      retrievalWeight: template.exemplarLinks.reduce((sum, link) => sum + Number(link.retrievalWeight ?? 0), 0),
    }))
    .sort((a, b) => b.retrievalWeight - a.retrievalWeight)
    .slice(0, 8);

  return {
    totals: {
      totalTemplates,
      publishedTemplates,
      draftTemplates: Math.max(0, totalTemplates - publishedTemplates),
      unresolvedSessions,
      averageQualityScore,
      validationPassRate,
    },
    imports: {
      last30d: importJobs.filter((job) => job.createdAt.getTime() >= now - thirtyDaysMs).length,
      failedLast30d: importJobs.filter((job) => job.createdAt.getTime() >= now - thirtyDaysMs && job.status === 'FAILED').length,
      bySourceType: {
        csv: importJobs.filter((job) => job.sourceType === 'CSV').length,
        xlsx: importJobs.filter((job) => job.sourceType === 'XLSX').length,
        pdfAssist: importJobs.filter((job) => job.sourceType === 'PDF_ASSIST').length,
      },
    },
    qualityKpis: {
      current30d: currentRates,
      previous30d: previousRates,
      trend: {
        editRateDelta: currentRates.editRate - previousRates.editRate,
        rejectionRateDelta: currentRates.rejectionRate - previousRates.rejectionRate,
        goodFitRateDelta: currentRates.goodFitRate - previousRates.goodFitRate,
      },
    },
    topTemplates,
  };
}
