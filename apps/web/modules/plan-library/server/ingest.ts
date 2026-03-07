import { createHash } from 'crypto';
import type { PlanDistance, PlanLevel, PlanSeason, PlanSourceType, PlanSport } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/errors';

import { extractPlanSourceWithRobustPipeline } from './robust-extract';
import { planSourceBlobStorageConfigured, storePlanSourceDocument } from './document-storage';
import { ensurePlanSourceLayoutFamilies, inferLayoutFamily } from './layout-families';
import { persistPlanSourceExtractionArtifacts } from './parser-studio';

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
      rawText = '';
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

  const layoutFamilies = await ensurePlanSourceLayoutFamilies();
  const isPdfSource = Boolean(contentBytes && (type === 'PDF' || (type === 'URL' && contentType?.includes('pdf'))));
  const extracted = await extractPlanSourceWithRobustPipeline({
    type,
    contentBytes,
    rawText,
    durationWeeks: Number.isFinite(durationWeeks) ? durationWeeks : null,
    title,
    sport,
    distance,
    level,
  });

  rawText = extracted.rawText;
  const inferredLayoutFamily = inferLayoutFamily({ title, rawText, sourceUrl: sourceUrl ?? null });
  const assignedLayoutFamily = layoutFamilies.find((family) => family.slug === inferredLayoutFamily.slug) ?? null;
  const checksumSha256 = createHash('sha256').update(contentBytes ?? rawText).digest('hex');
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

  const created = await prisma.$transaction(
    async (tx) => {
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
          layoutFamilyId: assignedLayoutFamily?.id ?? null,
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

      const artifacts = await persistPlanSourceExtractionArtifacts(tx, {
        planSourceId: planSource.id,
        version: 1,
        extracted,
        contentType,
        layoutFamily: assignedLayoutFamily
          ? {
              id: assignedLayoutFamily.id,
              slug: assignedLayoutFamily.slug,
              name: assignedLayoutFamily.name,
            }
          : null,
        inferredLayoutFamily,
      });

      return { planSource, version: artifacts.version, run: artifacts.run };
    },
    {
      maxWait: 10_000,
      timeout: 60_000,
    }
  );

  return {
    duplicate: false,
    planSource: created.planSource,
    version: created.version,
    extracted,
  };
}
