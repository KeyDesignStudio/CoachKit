import type { PlanSourceAnnotationType } from '@prisma/client';

import type { NormalizedBbox } from './pdf-layout';

export type LayoutRuleSourceAnnotation = {
  pageNumber: number;
  annotationType: PlanSourceAnnotationType;
  label: string | null;
  note: string | null;
  bboxJson: NormalizedBbox;
};

export type WeeklyGridLayoutRules = {
  version: 'weekly-grid-template-v1';
  familySlug: string;
  templateSourcePlanId: string;
  compiledAt: string;
  annotationCounts: Record<PlanSourceAnnotationType, number>;
  pageTemplate: {
    weekColumns: Array<{
      index: number;
      centerX: number;
      left: number;
      right: number;
      label: string | null;
    }>;
    dayRows: Array<{
      index: number;
      dayOfWeek: number | null;
      label: string | null;
      centerY: number;
      top: number;
      bottom: number;
    }>;
    weekHeaderBand: {
      top: number;
      bottom: number;
    };
    blockTitleBand: NormalizedBbox | null;
    ignoreRegions: NormalizedBbox[];
    legendRegions: NormalizedBbox[];
  };
};

export type LayoutFamilyRules = WeeklyGridLayoutRules;

const WEEKLY_GRID_COMPATIBLE_FAMILIES = new Set(['weekly-grid', 'mixed-editorial']);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isNormalizedBbox(value: unknown): value is NormalizedBbox {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y) &&
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height)
  );
}

function centerX(box: NormalizedBbox) {
  return box.x + box.width / 2;
}

function centerY(box: NormalizedBbox) {
  return box.y + box.height / 2;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function averageBox(boxes: NormalizedBbox[]): NormalizedBbox | null {
  if (!boxes.length) return null;
  return {
    x: average(boxes.map((box) => box.x)),
    y: average(boxes.map((box) => box.y)),
    width: average(boxes.map((box) => box.width)),
    height: average(boxes.map((box) => box.height)),
  };
}

function isNonNullBox(value: NormalizedBbox | null): value is NormalizedBbox {
  return Boolean(value);
}

function clusterAnnotations(
  annotations: Array<LayoutRuleSourceAnnotation & { bbox: NormalizedBbox }>,
  axis: 'x' | 'y',
  tolerance: number
) {
  const sorted = [...annotations].sort((left, right) =>
    axis === 'x' ? centerX(left.bbox) - centerX(right.bbox) : centerY(left.bbox) - centerY(right.bbox)
  );
  const groups: Array<Array<LayoutRuleSourceAnnotation & { bbox: NormalizedBbox }>> = [];

  for (const annotation of sorted) {
    const value = axis === 'x' ? centerX(annotation.bbox) : centerY(annotation.bbox);
    const current = groups[groups.length - 1];
    if (!current) {
      groups.push([annotation]);
      continue;
    }
    const currentValue = average(
      current.map((entry) => (axis === 'x' ? centerX(entry.bbox) : centerY(entry.bbox)))
    );
    if (Math.abs(value - currentValue) <= tolerance) {
      current.push(annotation);
    } else {
      groups.push([annotation]);
    }
  }

  return groups;
}

function parseDayOfWeek(label: string | null | undefined) {
  const normalized = (label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

  if (!normalized) return null;
  if (normalized.startsWith('mon')) return 1;
  if (normalized.startsWith('tue')) return 2;
  if (normalized.startsWith('wed')) return 3;
  if (normalized.startsWith('thu')) return 4;
  if (normalized.startsWith('fri')) return 5;
  if (normalized.startsWith('sat')) return 6;
  if (normalized.startsWith('sun')) return 0;
  return null;
}

function deriveBandsFromCenters(centers: number[], minEdge: number, maxEdge: number) {
  if (!centers.length) return [] as Array<{ left: number; right: number }>;
  const sorted = [...centers].sort((a, b) => a - b);
  const bands: Array<{ left: number; right: number }> = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const left = previous == null ? minEdge : (previous + current) / 2;
    const right = next == null ? maxEdge : (current + next) / 2;
    bands.push({
      left: clamp(left, 0, 1),
      right: clamp(right, 0, 1),
    });
  }

  return bands;
}

function buildAnnotationCounts(annotations: LayoutRuleSourceAnnotation[]) {
  return annotations.reduce<Record<PlanSourceAnnotationType, number>>(
    (counts, annotation) => {
      counts[annotation.annotationType] += 1;
      return counts;
    },
    {
      WEEK_HEADER: 0,
      DAY_LABEL: 0,
      SESSION_CELL: 0,
      BLOCK_TITLE: 0,
      IGNORE_REGION: 0,
      LEGEND: 0,
      NOTE: 0,
    }
  );
}

export function parseLayoutFamilyRules(rulesJson: unknown): LayoutFamilyRules | null {
  if (!rulesJson || typeof rulesJson !== 'object') return null;
  const candidate = rulesJson as Record<string, unknown>;
  if (candidate.version !== 'weekly-grid-template-v1') return null;

  const pageTemplate = candidate.pageTemplate;
  if (!pageTemplate || typeof pageTemplate !== 'object') return null;
  const pageTemplateRecord = pageTemplate as Record<string, unknown>;

  const weekColumns = Array.isArray(pageTemplateRecord.weekColumns)
    ? pageTemplateRecord.weekColumns
        .map((column, index) => {
          if (!column || typeof column !== 'object') return null;
          const record = column as Record<string, unknown>;
          const center = Number(record.centerX);
          const left = Number(record.left);
          const right = Number(record.right);
          if (![center, left, right].every(Number.isFinite)) return null;
          return {
            index,
            centerX: center,
            left,
            right,
            label: typeof record.label === 'string' ? record.label : null,
          };
        })
        .filter((value): value is { index: number; centerX: number; left: number; right: number; label: string | null } => value != null)
    : [];

  const dayRows = Array.isArray(pageTemplateRecord.dayRows)
    ? pageTemplateRecord.dayRows
        .map((row, index) => {
          if (!row || typeof row !== 'object') return null;
          const record = row as Record<string, unknown>;
          const center = Number(record.centerY);
          const top = Number(record.top);
          const bottom = Number(record.bottom);
          if (![center, top, bottom].every(Number.isFinite)) return null;
          return {
            index,
            dayOfWeek: typeof record.dayOfWeek === 'number' && Number.isFinite(record.dayOfWeek) ? record.dayOfWeek : null,
            label: typeof record.label === 'string' ? record.label : null,
            centerY: center,
            top,
            bottom,
          };
        })
        .filter((value): value is { index: number; dayOfWeek: number | null; label: string | null; centerY: number; top: number; bottom: number } => value != null)
    : [];

  const weekHeaderBandCandidate = pageTemplateRecord.weekHeaderBand;
  const weekHeaderBand =
    weekHeaderBandCandidate && typeof weekHeaderBandCandidate === 'object'
      ? {
          top: Number((weekHeaderBandCandidate as Record<string, unknown>).top),
          bottom: Number((weekHeaderBandCandidate as Record<string, unknown>).bottom),
        }
      : null;

  if (
    !weekColumns.length ||
    !dayRows.length ||
    !weekHeaderBand ||
    !Number.isFinite(weekHeaderBand.top) ||
    !Number.isFinite(weekHeaderBand.bottom)
  ) {
    return null;
  }

  const parseRegions = (value: unknown) =>
    Array.isArray(value) ? value.filter(isNormalizedBbox) : [];
  const annotationCountsCandidate = candidate.annotationCounts;
  const annotationCounts =
    annotationCountsCandidate && typeof annotationCountsCandidate === 'object'
      ? {
          WEEK_HEADER: Number((annotationCountsCandidate as Record<string, unknown>).WEEK_HEADER ?? 0),
          DAY_LABEL: Number((annotationCountsCandidate as Record<string, unknown>).DAY_LABEL ?? 0),
          SESSION_CELL: Number((annotationCountsCandidate as Record<string, unknown>).SESSION_CELL ?? 0),
          BLOCK_TITLE: Number((annotationCountsCandidate as Record<string, unknown>).BLOCK_TITLE ?? 0),
          IGNORE_REGION: Number((annotationCountsCandidate as Record<string, unknown>).IGNORE_REGION ?? 0),
          LEGEND: Number((annotationCountsCandidate as Record<string, unknown>).LEGEND ?? 0),
          NOTE: Number((annotationCountsCandidate as Record<string, unknown>).NOTE ?? 0),
        }
      : buildAnnotationCounts([]);

  return {
    version: 'weekly-grid-template-v1',
    familySlug: typeof candidate.familySlug === 'string' ? candidate.familySlug : 'weekly-grid',
    templateSourcePlanId: typeof candidate.templateSourcePlanId === 'string' ? candidate.templateSourcePlanId : '',
    compiledAt: typeof candidate.compiledAt === 'string' ? candidate.compiledAt : new Date(0).toISOString(),
    annotationCounts,
    pageTemplate: {
      weekColumns,
      dayRows,
      weekHeaderBand,
      blockTitleBand: isNormalizedBbox(pageTemplateRecord.blockTitleBand) ? pageTemplateRecord.blockTitleBand : null,
      ignoreRegions: parseRegions(pageTemplateRecord.ignoreRegions),
      legendRegions: parseRegions(pageTemplateRecord.legendRegions),
    },
  };
}

export function compileLayoutFamilyRules(params: {
  familySlug: string;
  planSourceId: string;
  annotations: LayoutRuleSourceAnnotation[];
}) {
  if (!WEEKLY_GRID_COMPATIBLE_FAMILIES.has(params.familySlug)) {
    return null;
  }

  const annotations = params.annotations.filter((annotation) => isNormalizedBbox(annotation.bboxJson))
    .map((annotation) => ({ ...annotation, bbox: annotation.bboxJson }));
  const weekHeaders = annotations.filter((annotation) => annotation.annotationType === 'WEEK_HEADER');
  const dayLabels = annotations.filter((annotation) => annotation.annotationType === 'DAY_LABEL');

  if (weekHeaders.length < 2 || dayLabels.length < 3) {
    return null;
  }

  const weekHeaderGroups = clusterAnnotations(weekHeaders, 'x', 0.08);
  const dayLabelGroups = clusterAnnotations(dayLabels, 'y', 0.05);

  if (weekHeaderGroups.length < 2 || dayLabelGroups.length < 3) {
    return null;
  }

  const weekHeaderBoxes = weekHeaderGroups.map((group) => averageBox(group.map((annotation) => annotation.bbox))).filter(isNonNullBox);
  const dayLabelBoxes = dayLabelGroups.map((group) => averageBox(group.map((annotation) => annotation.bbox))).filter(isNonNullBox);
  const sessionCells = annotations
    .filter((annotation) => annotation.annotationType === 'SESSION_CELL')
    .map((annotation) => annotation.bbox);

  const weekCenters = weekHeaderBoxes.map((box) => centerX(box));
  const dayCenters = dayLabelBoxes.map((box) => centerY(box));
  const typicalColumnGap = weekCenters.length > 1 ? average(weekCenters.slice(1).map((center, index) => center - weekCenters[index]!)) : 0.16;
  const typicalRowGap = dayCenters.length > 1 ? average(dayCenters.slice(1).map((center, index) => center - dayCenters[index]!)) : 0.11;

  const columnMin = sessionCells.length
    ? Math.max(0, Math.min(...sessionCells.map((box) => box.x)))
    : Math.max(0, Math.min(...weekCenters.map((center) => center - typicalColumnGap / 2)));
  const columnMax = sessionCells.length
    ? Math.min(1, Math.max(...sessionCells.map((box) => box.x + box.width)))
    : Math.min(1, Math.max(...weekCenters.map((center) => center + typicalColumnGap / 2)));
  const rowMin = sessionCells.length
    ? Math.max(0, Math.min(...sessionCells.map((box) => box.y)))
    : Math.max(
        Math.max(...weekHeaderBoxes.map((box) => box.y + box.height)) + 0.01,
        Math.min(...dayCenters.map((center) => center - typicalRowGap / 2))
      );
  const rowMax = sessionCells.length
    ? Math.min(1, Math.max(...sessionCells.map((box) => box.y + box.height)))
    : Math.min(1, Math.max(...dayCenters.map((center) => center + typicalRowGap / 2)));

  const columnBands = deriveBandsFromCenters(weekCenters, columnMin, columnMax);
  const rowBands = deriveBandsFromCenters(dayCenters, rowMin, rowMax);

  const dayOrderFallback = [1, 2, 3, 4, 5, 6, 0];
  const blockTitleBoxes = annotations
    .filter((annotation) => annotation.annotationType === 'BLOCK_TITLE')
    .map((annotation) => annotation.bbox);
  const ignoreRegions = annotations
    .filter((annotation) => annotation.annotationType === 'IGNORE_REGION')
    .map((annotation) => annotation.bbox);
  const legendRegions = annotations
    .filter((annotation) => annotation.annotationType === 'LEGEND')
    .map((annotation) => annotation.bbox);

  return {
    version: 'weekly-grid-template-v1',
    familySlug: params.familySlug,
    templateSourcePlanId: params.planSourceId,
    compiledAt: new Date().toISOString(),
    annotationCounts: buildAnnotationCounts(params.annotations),
    pageTemplate: {
      weekColumns: weekHeaderBoxes
        .map((box, index) => ({
          index,
          centerX: weekCenters[index]!,
          left: columnBands[index]!.left,
          right: columnBands[index]!.right,
          label: weekHeaderGroups[index]?.[0]?.label?.trim() || null,
        }))
        .sort((left, right) => left.centerX - right.centerX),
      dayRows: dayLabelBoxes
        .map((box, index) => ({
          index,
          dayOfWeek:
            parseDayOfWeek(dayLabelGroups[index]?.[0]?.label) ??
            dayOrderFallback[index] ??
            null,
          label: dayLabelGroups[index]?.[0]?.label?.trim() || null,
          centerY: dayCenters[index]!,
          top: rowBands[index]!.left,
          bottom: rowBands[index]!.right,
        }))
        .sort((left, right) => left.centerY - right.centerY),
      weekHeaderBand: {
        top: clamp(Math.min(...weekHeaderBoxes.map((box) => box.y)), 0, 1),
        bottom: clamp(Math.max(...weekHeaderBoxes.map((box) => box.y + box.height)), 0, 1),
      },
      blockTitleBand: averageBox(blockTitleBoxes),
      ignoreRegions,
      legendRegions,
    },
  } satisfies WeeklyGridLayoutRules;
}
