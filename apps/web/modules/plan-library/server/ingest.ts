import { createHash } from 'crypto';
import type { PlanDistance, PlanLevel, PlanSeason, PlanSourceType, PlanSport } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { extractFromRawText, extractTextFromPdf } from './extract';
import { planSourceBlobStorageConfigured, storePlanSourceDocument } from './document-storage';

const asString = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '');

const DISTANCE_LABELS: Record<PlanDistance, string> = {
  SPRINT: 'Sprint',
  OLYMPIC: 'Olympic',
  HALF_IRONMAN: '70.3 / Half Ironman',
  IRONMAN: 'Ironman',
  DUATHLON_STD: 'Duathlon Standard',
  DUATHLON_SPRINT: 'Duathlon Sprint',
  FIVE_K: '5K',
  TEN_K: '10K',
  HALF_MARATHON: 'Half Marathon',
  MARATHON: 'Marathon',
  OTHER: 'Other',
};

function normalizeEnumToken(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parsePlanSourceType(raw: string): PlanSourceType {
  const normalized = normalizeEnumToken(raw || 'TEXT');
  if (normalized === 'PDF' || normalized === 'URL' || normalized === 'TEXT') return normalized as PlanSourceType;
  throw new ApiError(400, 'INVALID_SOURCE_TYPE', 'Source type must be PDF, URL, or TEXT.');
}

function parsePlanSport(raw: string): PlanSport {
  const normalized = normalizeEnumToken(raw || 'TRIATHLON');
  const map: Record<string, PlanSport> = {
    TRIATHLON: 'TRIATHLON',
    DUATHLON: 'DUATHLON',
    RUN: 'RUN',
    BIKE: 'BIKE',
    SWIM: 'SWIM',
  };
  const value = map[normalized];
  if (value) return value;
  throw new ApiError(400, 'INVALID_SPORT', 'Sport must be Triathlon, Duathlon, Run, Bike, or Swim.');
}

function parsePlanLevel(raw: string): PlanLevel {
  const normalized = normalizeEnumToken(raw || 'BEGINNER');
  const map: Record<string, PlanLevel> = {
    BEGINNER: 'BEGINNER',
    INTERMEDIATE: 'INTERMEDIATE',
    ADVANCED: 'ADVANCED',
  };
  const value = map[normalized];
  if (value) return value;
  throw new ApiError(400, 'INVALID_LEVEL', 'Level must be Beginner, Intermediate, or Advanced.');
}

export function parsePlanDistance(raw: string): PlanDistance {
  const normalized = normalizeEnumToken(raw || 'OTHER');
  if (normalized === 'OTHER') return 'OTHER';
  if (normalized.includes('DUATHLON') && normalized.includes('SPRINT')) return 'DUATHLON_SPRINT';
  if (normalized.includes('DUATHLON')) return 'DUATHLON_STD';
  if (normalized.includes('70_3') || normalized.includes('HALF_IRONMAN')) return 'HALF_IRONMAN';
  if (normalized === 'IRONMAN' || normalized.includes('FULL')) return 'IRONMAN';
  if (normalized.includes('HALF_MARATHON')) return 'HALF_MARATHON';
  if (normalized === 'MARATHON') return 'MARATHON';
  if (normalized === 'SPRINT') return 'SPRINT';
  if (normalized === 'OLYMPIC') return 'OLYMPIC';
  if (normalized === '5K' || normalized === '5_K' || normalized.includes('FIVE_K')) return 'FIVE_K';
  if (normalized === '10K' || normalized === '10_K' || normalized.includes('TEN_K')) return 'TEN_K';
  throw new ApiError(
    400,
    'INVALID_DISTANCE',
    `Distance must be one of: ${Object.values(DISTANCE_LABELS).join(', ')}.`
  );
}

export function parsePlanSeason(raw: string): PlanSeason | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = normalizeEnumToken(trimmed);
  const map: Record<string, PlanSeason> = {
    IN_SEASON: 'IN_SEASON',
    INSEASON: 'IN_SEASON',
    BASE: 'BASE',
    WINTER: 'WINTER',
    BUILD: 'BUILD',
    PEAK: 'PEAK',
    TAPER: 'TAPER',
  };
  const value = map[normalized];
  if (value) return value;
  throw new ApiError(400, 'INVALID_SEASON', 'Season must be one of: In Season, Base, Winter, Build, Peak, Taper.');
}

export async function ingestPlanSourceFromForm(params: {
  form: FormData;
  sourceTag?: string;
  defaultIsActive?: boolean;
}) {
  const form = params.form;
  const type = parsePlanSourceType(asString(form.get('type')) || 'TEXT');
  const title = asString(form.get('title')) || 'Untitled plan source';
  const sport = parsePlanSport(asString(form.get('sport')) || 'TRIATHLON');
  const distance = parsePlanDistance(asString(form.get('distance')) || 'OTHER');
  const level = parsePlanLevel(asString(form.get('level')) || 'BEGINNER');
  const durationWeeks = Number(asString(form.get('durationWeeks')) || '0');
  const season = parsePlanSeason(asString(form.get('season')) || '');
  const author = asString(form.get('author')) || undefined;
  const publisher = asString(form.get('publisher')) || undefined;
  const licenseText = asString(form.get('licenseText')) || undefined;
  const sourceUrl = asString(form.get('sourceUrl')) || undefined;
  const sourceFilePath = asString(form.get('sourceFilePath')) || undefined;
  const explicitIsActive = asString(form.get('isActive'));

  let rawText = '';
  let contentBytes: Buffer | null = null;
  let contentType: string | null = null;
  let sourcePathComputed = sourceFilePath;
  let uploadedFileName = 'upload.pdf';

  if (type === 'PDF') {
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      throw new ApiError(400, 'FILE_REQUIRED', 'PDF upload is required.');
    }
    const arrayBuffer = await file.arrayBuffer();
    contentBytes = Buffer.from(arrayBuffer);
    contentType = file.type || 'application/pdf';
    uploadedFileName = file.name || uploadedFileName;
    rawText = await extractTextFromPdf(contentBytes);
    if (!sourcePathComputed && params.sourceTag) {
      sourcePathComputed = `${params.sourceTag}:${uploadedFileName}`;
    }
  } else if (type === 'URL') {
    if (!sourceUrl) {
      throw new ApiError(400, 'URL_REQUIRED', 'sourceUrl is required for URL ingestion.');
    }
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new ApiError(400, 'URL_FETCH_FAILED', `Failed to fetch sourceUrl (${response.status}).`);
    }
    contentType = response.headers.get('content-type');
    const buffer = Buffer.from(await response.arrayBuffer());
    contentBytes = buffer;
    if (contentType?.includes('pdf')) {
      rawText = await extractTextFromPdf(buffer);
    } else {
      rawText = buffer.toString('utf-8');
    }
  } else {
    rawText = asString(form.get('rawText'));
    if (!rawText) {
      throw new ApiError(400, 'TEXT_REQUIRED', 'rawText is required for TEXT ingestion.');
    }
    contentBytes = Buffer.from(rawText, 'utf-8');
    if (!sourcePathComputed && params.sourceTag) {
      sourcePathComputed = `${params.sourceTag}:manual-text`;
    }
  }

  const checksumSha256 = createHash('sha256').update(contentBytes ?? rawText).digest('hex');
  const extracted = extractFromRawText(rawText, Number.isFinite(durationWeeks) ? durationWeeks : null);
  const canStoreUploadedPdf = type === 'PDF' && contentBytes && contentBytes.length > 0;
  let storedDocument: Awaited<ReturnType<typeof storePlanSourceDocument>> = null;

  let existing = await prisma.planSource.findUnique({
    where: { checksumSha256 },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (existing) {
    if (canStoreUploadedPdf && !existing.storedDocumentUrl && planSourceBlobStorageConfigured()) {
      storedDocument = await storePlanSourceDocument({
        checksumSha256,
        content: contentBytes!,
        fileName: uploadedFileName,
        contentType: contentType || 'application/pdf',
      });
    }
    if (canStoreUploadedPdf && !existing.storedDocumentUrl && storedDocument) {
      existing = await prisma.planSource.update({
        where: { id: existing.id },
        data: {
          storedDocumentUrl: storedDocument.url,
          storedDocumentKey: storedDocument.key,
          storedDocumentContentType: storedDocument.contentType,
          storedDocumentUploadedAt: storedDocument.uploadedAt,
          ...(existing.sourceFilePath ? {} : { sourceFilePath: sourcePathComputed || null }),
        },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      });
    }
    return {
      duplicate: true,
      planSource: existing,
      version: existing.versions[0] ?? null,
      extracted,
    };
  }

  const isActive =
    explicitIsActive === 'true'
      ? true
      : explicitIsActive === 'false'
        ? false
        : params.defaultIsActive === true;

  if (canStoreUploadedPdf && planSourceBlobStorageConfigured()) {
    storedDocument = await storePlanSourceDocument({
      checksumSha256,
      content: contentBytes!,
      fileName: uploadedFileName,
      contentType: contentType || 'application/pdf',
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const planSource = await tx.planSource.create({
      data: {
        type,
        title,
        sport,
        distance,
        level,
        durationWeeks: Number.isFinite(durationWeeks) && durationWeeks > 0 ? Math.floor(durationWeeks) : 0,
        season,
        author,
        publisher,
        licenseText,
        sourceUrl,
        sourceFilePath: sourcePathComputed || null,
        storedDocumentUrl: storedDocument?.url ?? null,
        storedDocumentKey: storedDocument?.key ?? null,
        storedDocumentContentType: storedDocument?.contentType ?? null,
        storedDocumentUploadedAt: storedDocument?.uploadedAt ?? null,
        checksumSha256,
        isActive,
        rawText,
        rawJson: extracted.rawJson as any,
      },
    });

    const version = await tx.planSourceVersion.create({
      data: {
        planSourceId: planSource.id,
        version: 1,
        extractionMetaJson: {
          contentType,
          warnings: extracted.warnings,
          confidence: extracted.confidence,
          sessionCount: extracted.sessions.length,
          weekCount: extracted.weeks.length,
        } as any,
      },
    });

    if (extracted.weeks.length) {
      await tx.planSourceWeekTemplate.createMany({
        data: extracted.weeks.map((week) => ({
          planSourceVersionId: version.id,
          weekIndex: week.weekIndex,
          phase: week.phase ?? null,
          totalMinutes: week.totalMinutes ?? null,
          totalSessions: week.totalSessions ?? null,
          notes: week.notes ?? null,
        })),
      });
    }

    if (extracted.sessions.length) {
      const weekIds = await tx.planSourceWeekTemplate.findMany({
        where: { planSourceVersionId: version.id },
        select: { id: true, weekIndex: true },
      });
      const weekMap = new Map(weekIds.map((w) => [w.weekIndex, w.id]));

      await tx.planSourceSessionTemplate.createMany({
        data: extracted.sessions
          .filter((session) => weekMap.has(session.weekIndex))
          .map((session) => ({
            planSourceWeekTemplateId: weekMap.get(session.weekIndex)!,
            ordinal: session.ordinal,
            dayOfWeek: session.dayOfWeek ?? null,
            discipline: session.discipline as any,
            sessionType: session.sessionType,
            title: session.title ?? null,
            durationMinutes: session.durationMinutes ?? null,
            distanceKm: session.distanceKm ?? null,
            intensityType: session.intensityType ?? null,
            intensityTargetJson: session.intensityTargetJson as any,
            recipeV2Json: session.recipeV2Json as any,
            parserConfidence: session.parserConfidence ?? null,
            parserWarningsJson: session.parserWarningsJson as any,
            structureJson: session.structureJson as any,
            notes: session.notes ?? null,
          })),
      });
    }

    if (extracted.rules.length) {
      await tx.planSourceRule.createMany({
        data: extracted.rules.map((rule) => ({
          planSourceVersionId: version.id,
          ruleType: rule.ruleType as any,
          phase: rule.phase ?? null,
          appliesJson: rule.appliesJson as any,
          ruleJson: rule.ruleJson as any,
          explanation: rule.explanation,
          priority: rule.priority,
        })),
      });
    }

    return { planSource, version };
  });

  return {
    duplicate: false,
    planSource: created.planSource,
    version: created.version,
    extracted,
  };
}
