import type { PlanSourceAnnotationType } from '@prisma/client';

import {
  extractTextRunsFromPageRegion,
  type ExtractedPdfDocument,
  type ExtractedPdfPage,
  type NormalizedBbox,
  type PdfTextRun,
} from './pdf-layout';

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
    templatePageNumber: number | null;
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
    sampleSessionCell: NormalizedBbox | null;
    ignoreRegions: NormalizedBbox[];
    legendRegions: NormalizedBbox[];
  };
};

export type LayoutFamilyRules = WeeklyGridLayoutRules;

export type WeeklyGridPreviewCell = {
  pageNumber: number | null;
  columnIndex: number;
  rowIndex: number;
  weekIndex: number;
  dayOfWeek: number | null;
  label: string;
  bbox: NormalizedBbox;
};

export type LayoutFamilyTemplatePreview = {
  rules: LayoutFamilyRules | null;
  diagnostics: string[];
  pageNumber: number | null;
  cells: WeeklyGridPreviewCell[];
  weekCount: number;
  dayCount: number;
};

type AnchorCandidate = {
  label: string | null;
  bbox: NormalizedBbox;
};

const WEEKLY_GRID_COMPATIBLE_FAMILIES = new Set(['weekly-grid', 'mixed-editorial']);
const DAY_ORDER_FALLBACK = [1, 2, 3, 4, 5, 6, 0];

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

function normalizeToken(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function alphaToken(value: string | null | undefined) {
  return normalizeToken(value).toLowerCase().replace(/[^a-z]/g, '');
}

function parseDayOfWeek(label: string | null | undefined) {
  const normalized = alphaToken(label);
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

function parseWeekNumber(label: string | null | undefined) {
  const match = normalizeToken(label).match(/\b(?:week|wk)\s*([0-9]{1,2})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value - 1 : null;
}

function displayDayIndex(dayOfWeek: number | null | undefined) {
  if (dayOfWeek == null) return null;
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
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

function hasWeeklyGridAnnotationSignal(annotations: LayoutRuleSourceAnnotation[]) {
  const counts = buildAnnotationCounts(annotations);
  if (counts.WEEK_HEADER >= 2 && counts.DAY_LABEL >= 3) return true;
  if (counts.WEEK_HEADER >= 1 && counts.DAY_LABEL >= 1 && counts.SESSION_CELL >= 1) return true;
  return false;
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

function chooseTemplatePageNumber(annotations: Array<LayoutRuleSourceAnnotation & { bbox: NormalizedBbox }>) {
  const preferred =
    annotations.find((annotation) => annotation.annotationType === 'WEEK_HEADER') ??
    annotations.find((annotation) => annotation.annotationType === 'DAY_LABEL') ??
    annotations[0];
  return preferred?.pageNumber ?? null;
}

function findPage(document: ExtractedPdfDocument | undefined, pageNumber: number | null) {
  if (!document?.pages.length) return null;
  if (pageNumber != null) {
    const matched = document.pages.find((page) => page.pageNumber === pageNumber);
    if (matched) return matched;
  }
  return document.pages[0] ?? null;
}

function mergeRunBoxes(left: PdfTextRun, right: PdfTextRun, label: string): AnchorCandidate {
  const x = Math.min(left.normalizedX, right.normalizedX);
  const y = Math.min(left.normalizedY, right.normalizedY);
  const rightEdge = Math.max(
    left.normalizedX + left.normalizedWidth,
    right.normalizedX + right.normalizedWidth
  );
  const bottomEdge = Math.max(
    left.normalizedY + left.normalizedHeight,
    right.normalizedY + right.normalizedHeight
  );
  return {
    label,
    bbox: {
      x,
      y,
      width: rightEdge - x,
      height: bottomEdge - y,
    },
  };
}

function extractWeekAnchorsFromRuns(runs: PdfTextRun[]) {
  const candidates: AnchorCandidate[] = [];
  const sorted = [...runs].sort((left, right) => {
    const deltaY = left.normalizedY - right.normalizedY;
    if (Math.abs(deltaY) > 0.018) return deltaY;
    return left.normalizedX - right.normalizedX;
  });

  for (let index = 0; index < sorted.length; index += 1) {
    const run = sorted[index]!;
    const label = normalizeToken(run.text);
    if (!label) continue;

    if (/\b(?:week|wk)\s*[0-9]{1,2}\b/i.test(label)) {
      candidates.push({
        label,
        bbox: {
          x: run.normalizedX,
          y: run.normalizedY,
          width: run.normalizedWidth,
          height: run.normalizedHeight,
        },
      });
      continue;
    }

    if (/^(?:week|wk)$/i.test(label)) {
      const next = sorted[index + 1];
      if (
        next &&
        /^\d{1,2}$/.test(normalizeToken(next.text)) &&
        Math.abs(next.normalizedY - run.normalizedY) <= 0.02
      ) {
        candidates.push(mergeRunBoxes(run, next, `${label} ${normalizeToken(next.text)}`));
        index += 1;
      }
    }
  }

  return candidates;
}

function extractDayAnchorsFromRuns(runs: PdfTextRun[]) {
  const candidates = runs
    .map((run) => ({
      label: normalizeToken(run.text),
      bbox: {
        x: run.normalizedX,
        y: run.normalizedY,
        width: run.normalizedWidth,
        height: run.normalizedHeight,
      } satisfies NormalizedBbox,
    }))
    .filter((candidate) => parseDayOfWeek(candidate.label) != null)
    .sort((left, right) => centerY(left.bbox) - centerY(right.bbox));

  const deduped: AnchorCandidate[] = [];
  for (const candidate of candidates) {
    const existing = deduped[deduped.length - 1];
    if (existing && Math.abs(centerY(existing.bbox) - centerY(candidate.bbox)) <= 0.025) {
      if ((candidate.bbox.width * candidate.bbox.height) > (existing.bbox.width * existing.bbox.height)) {
        deduped[deduped.length - 1] = candidate;
      }
      continue;
    }
    deduped.push(candidate);
  }

  return deduped;
}

function averageAnchorSize(anchors: AnchorCandidate[]) {
  return {
    width: average(anchors.map((anchor) => anchor.bbox.width)),
    height: average(anchors.map((anchor) => anchor.bbox.height)),
    x: average(anchors.map((anchor) => anchor.bbox.x)),
  };
}

function estimateDayStep(anchors: AnchorCandidate[], sampleSessionCell: NormalizedBbox | null, container: NormalizedBbox | null) {
  const sorted = [...anchors].sort((left, right) => centerY(left.bbox) - centerY(right.bbox));
  const explicitGaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const leftDay = parseDayOfWeek(sorted[index - 1]?.label);
    const rightDay = parseDayOfWeek(sorted[index]?.label);
    const leftIndex = displayDayIndex(leftDay);
    const rightIndex = displayDayIndex(rightDay);
    if (leftIndex == null || rightIndex == null || rightIndex <= leftIndex) continue;
    explicitGaps.push((centerY(sorted[index]!.bbox) - centerY(sorted[index - 1]!.bbox)) / (rightIndex - leftIndex));
  }

  if (explicitGaps.length) return average(explicitGaps);
  if (sampleSessionCell) return sampleSessionCell.height;
  if (container) return container.height / 7;
  return 0.11;
}

function normalizeDayAnchors(params: {
  anchors: AnchorCandidate[];
  container: NormalizedBbox | null;
  sampleSessionCell: NormalizedBbox | null;
  diagnostics: string[];
}) {
  const recognized = params.anchors
    .map((anchor) => ({
      anchor,
      dayOfWeek: parseDayOfWeek(anchor.label),
      displayIndex: displayDayIndex(parseDayOfWeek(anchor.label)),
    }))
    .filter(
      (
        entry
      ): entry is { anchor: AnchorCandidate; dayOfWeek: number; displayIndex: number } =>
        entry.dayOfWeek != null && entry.displayIndex != null
    )
    .sort((left, right) => left.displayIndex - right.displayIndex || centerY(left.anchor.bbox) - centerY(right.anchor.bbox));

  if (!recognized.length) return params.anchors;

  const averageSize = averageAnchorSize(recognized.map((entry) => entry.anchor));
  const step = estimateDayStep(
    recognized.map((entry) => entry.anchor),
    params.sampleSessionCell,
    params.container
  );

  const baseCandidates = recognized.map((entry) => centerY(entry.anchor.bbox) - entry.displayIndex * step);
  let baseCenter = average(baseCandidates);
  if (params.container) {
    const halfHeight = averageSize.height / 2;
    const minBase = params.container.y + halfHeight;
    const maxBase = params.container.y + params.container.height - halfHeight - step * 6;
    if (Number.isFinite(maxBase) && maxBase >= minBase) {
      baseCenter = clamp(baseCenter, minBase, maxBase);
    }
  }

  const ordered: AnchorCandidate[] = [];
  for (let displayIndex = 0; displayIndex < 7; displayIndex += 1) {
    const matched = recognized.find((entry) => entry.displayIndex === displayIndex);
    if (matched) {
      ordered.push(matched.anchor);
      continue;
    }

    const center = baseCenter + displayIndex * step;
    ordered.push({
      label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][displayIndex] ?? `Day ${displayIndex + 1}`,
      bbox: {
        x: params.container?.x ?? averageSize.x,
        y: clamp(center - averageSize.height / 2, 0, 1),
        width: params.container?.width ?? averageSize.width,
        height: averageSize.height || Math.max(0.04, params.sampleSessionCell?.height ?? 0.05),
      },
    });
  }

  if (recognized.length !== 7) {
    params.diagnostics.push(
      `Recovered ${recognized.length}/7 day anchors from the label rail; missing days were inferred to keep a Mon-Sun grid.`
    );
  }

  return ordered;
}

function deriveAnchorsFromContainer(params: {
  page: ExtractedPdfPage | null;
  container: NormalizedBbox | null;
  type: 'week' | 'day';
  excludeBoxes: NormalizedBbox[];
}) {
  if (!params.page || !params.container) return [] as AnchorCandidate[];
  const runs = extractTextRunsFromPageRegion({
    page: params.page,
    box: params.container,
    excludeBoxes: params.excludeBoxes,
  });
  return params.type === 'week' ? extractWeekAnchorsFromRuns(runs) : extractDayAnchorsFromRuns(runs);
}

function deriveAnchorsFromPageHeuristics(params: {
  page: ExtractedPdfPage | null;
  type: 'week' | 'day';
  excludeBoxes: NormalizedBbox[];
}) {
  if (!params.page) return [] as AnchorCandidate[];
  if (params.type === 'week') {
    const runs = extractTextRunsFromPageRegion({
      page: params.page,
      box: { x: 0.08, y: 0.06, width: 0.86, height: 0.24 },
      excludeBoxes: params.excludeBoxes,
    });
    return extractWeekAnchorsFromRuns(runs);
  }

  const runs = extractTextRunsFromPageRegion({
    page: params.page,
    box: { x: 0, y: 0.18, width: 0.2, height: 0.8 },
    excludeBoxes: params.excludeBoxes,
  });
  return extractDayAnchorsFromRuns(runs);
}

function deriveGridBounds(params: {
  centers: number[];
  sampleBoxes: NormalizedBbox[];
  defaultGap: number;
  minFromAnchors: number;
  maxFromAnchors: number;
  minimumCellSize: number;
}) {
  const sampleSize = params.sampleBoxes.length
    ? average(params.sampleBoxes.map((box) => Math.max(params.minimumCellSize, box.width || box.height || params.defaultGap)))
    : params.defaultGap;

  if (params.sampleBoxes.length >= 2) {
    const minEdge = Math.min(...params.sampleBoxes.map((box) => box.x));
    const maxEdge = Math.max(...params.sampleBoxes.map((box) => box.x + box.width));
    return {
      min: clamp(Math.min(minEdge, params.minFromAnchors), 0, 1),
      max: clamp(Math.max(maxEdge, params.maxFromAnchors), 0, 1),
    };
  }

  if (params.centers.length) {
    return {
      min: clamp(Math.min(params.minFromAnchors, Math.min(...params.centers.map((center) => center - sampleSize / 2))), 0, 1),
      max: clamp(Math.max(params.maxFromAnchors, Math.max(...params.centers.map((center) => center + sampleSize / 2))), 0, 1),
    };
  }

  return {
    min: clamp(params.minFromAnchors, 0, 1),
    max: clamp(params.maxFromAnchors, 0, 1),
  };
}

function buildCellBox(column: { left: number; right: number }, row: { top: number; bottom: number }): NormalizedBbox {
  const width = Math.max(0.01, column.right - column.left);
  const height = Math.max(0.01, row.bottom - row.top);
  const insetX = Math.min(0.008, width * 0.06);
  const insetY = Math.min(0.008, height * 0.08);
  return {
    x: clamp(column.left + insetX, 0, 1),
    y: clamp(row.top + insetY, 0, 1),
    width: Math.max(0.008, width - insetX * 2),
    height: Math.max(0.008, height - insetY * 2),
  };
}

function compileWeeklyGridLayoutRulesDetailed(params: {
  familySlug: string;
  planSourceId: string;
  annotations: LayoutRuleSourceAnnotation[];
  document?: ExtractedPdfDocument;
}) {
  const diagnostics: string[] = [];
  const weeklyGridSignal = hasWeeklyGridAnnotationSignal(params.annotations);
  const effectiveFamilySlug = WEEKLY_GRID_COMPATIBLE_FAMILIES.has(params.familySlug)
    ? params.familySlug
    : weeklyGridSignal
      ? 'weekly-grid'
      : params.familySlug;

  if (!WEEKLY_GRID_COMPATIBLE_FAMILIES.has(effectiveFamilySlug)) {
    diagnostics.push('Selected layout family does not support weekly-grid template compilation.');
    return { rules: null, diagnostics };
  }

  if (effectiveFamilySlug !== params.familySlug) {
    diagnostics.push('Using weekly-grid preview fallback because the current annotations clearly describe a weekly grid.');
  }

  const annotations = params.annotations
    .filter((annotation) => isNormalizedBbox(annotation.bboxJson))
    .map((annotation) => ({ ...annotation, bbox: annotation.bboxJson }));
  const templatePageNumber = chooseTemplatePageNumber(annotations);
  const templatePage = findPage(params.document, templatePageNumber);

  const ignoreRegions = annotations
    .filter((annotation) => annotation.annotationType === 'IGNORE_REGION')
    .map((annotation) => annotation.bbox);
  const legendRegions = annotations
    .filter((annotation) => annotation.annotationType === 'LEGEND')
    .map((annotation) => annotation.bbox);
  const exclusionZones = [...ignoreRegions, ...legendRegions];

  const weekHeaders = annotations.filter((annotation) => annotation.annotationType === 'WEEK_HEADER');
  const dayLabels = annotations.filter((annotation) => annotation.annotationType === 'DAY_LABEL');
  const blockTitleBoxes = annotations
    .filter((annotation) => annotation.annotationType === 'BLOCK_TITLE')
    .map((annotation) => annotation.bbox);
  const sessionCells = annotations
    .filter((annotation) => annotation.annotationType === 'SESSION_CELL')
    .map((annotation) => annotation.bbox);

  let weekAnchors: AnchorCandidate[] = [];
  if (weekHeaders.length >= 2) {
    const groups = clusterAnnotations(weekHeaders, 'x', 0.08);
    weekAnchors = groups
      .map((group) => ({
        label: group[0]?.label?.trim() || null,
        bbox: averageBox(group.map((annotation) => annotation.bbox)),
      }))
      .filter((candidate): candidate is AnchorCandidate => candidate.bbox != null);
  } else if (weekHeaders.length === 1) {
    weekAnchors = deriveAnchorsFromContainer({
      page: templatePage,
      container: weekHeaders[0].bbox,
      type: 'week',
      excludeBoxes: exclusionZones,
    });
    if (weekAnchors.length < 2) {
      diagnostics.push('Week header annotation should cover all week labels so columns can be derived.');
    }
  } else {
    weekAnchors = deriveAnchorsFromPageHeuristics({
      page: templatePage,
      type: 'week',
      excludeBoxes: exclusionZones,
    });
    if (weekAnchors.length >= 2) {
      diagnostics.push('No WEEK_HEADER annotations found; inferred week columns from page text.');
    } else {
      diagnostics.push('Add a WEEK_HEADER annotation for the header row.');
    }
  }

  let dayAnchors: AnchorCandidate[] = [];
  const dayLabelContainer = dayLabels.length === 1 ? dayLabels[0]!.bbox : null;
  if (dayLabels.length >= 3) {
    const groups = clusterAnnotations(dayLabels, 'y', 0.05);
    dayAnchors = groups
      .map((group) => ({
        label: group[0]?.label?.trim() || null,
        bbox: averageBox(group.map((annotation) => annotation.bbox)),
      }))
      .filter((candidate): candidate is AnchorCandidate => candidate.bbox != null);
  } else if (dayLabels.length === 1) {
    dayAnchors = deriveAnchorsFromContainer({
      page: templatePage,
      container: dayLabels[0].bbox,
      type: 'day',
      excludeBoxes: exclusionZones,
    });
    if (dayAnchors.length < 3) {
      diagnostics.push('Day label annotation should cover the whole day rail so rows can be derived.');
    }
  } else {
    dayAnchors = deriveAnchorsFromPageHeuristics({
      page: templatePage,
      type: 'day',
      excludeBoxes: exclusionZones,
    });
    if (dayAnchors.length >= 3) {
      diagnostics.push('No DAY_LABEL annotations found; inferred day rail from page text.');
    } else {
      diagnostics.push('Add a DAY_LABEL annotation covering the day rail.');
    }
  }

  if (dayAnchors.length) {
    dayAnchors = normalizeDayAnchors({
      anchors: dayAnchors,
      container: dayLabelContainer,
      sampleSessionCell: sessionCells[0] ?? null,
      diagnostics,
    });
  }

  if (weekAnchors.length < 2 || dayAnchors.length < 3) {
    return { rules: null, diagnostics };
  }

  const sortedWeekAnchors = [...weekAnchors].sort((left, right) => centerX(left.bbox) - centerX(right.bbox));
  const sortedDayAnchors = [...dayAnchors].sort((left, right) => centerY(left.bbox) - centerY(right.bbox));

  const weekCenters = sortedWeekAnchors.map((anchor) => centerX(anchor.bbox));
  const dayCenters = sortedDayAnchors.map((anchor) => centerY(anchor.bbox));
  const typicalColumnGap =
    weekCenters.length > 1 ? average(weekCenters.slice(1).map((center, index) => center - weekCenters[index]!)) : 0.16;
  const typicalRowGap =
    dayCenters.length > 1 ? average(dayCenters.slice(1).map((center, index) => center - dayCenters[index]!)) : 0.11;

  const horizontalBounds = deriveGridBounds({
    centers: weekCenters,
    sampleBoxes: sessionCells.length ? sessionCells : sortedWeekAnchors.map((anchor) => anchor.bbox),
    defaultGap: typicalColumnGap || 0.16,
    minFromAnchors: Math.min(...sortedWeekAnchors.map((anchor) => anchor.bbox.x)),
    maxFromAnchors: Math.max(...sortedWeekAnchors.map((anchor) => anchor.bbox.x + anchor.bbox.width)),
    minimumCellSize: 0.08,
  });

  const minimumRowStart = Math.max(
    Math.max(...sortedWeekAnchors.map((anchor) => anchor.bbox.y + anchor.bbox.height)) + 0.01,
    Math.min(...sortedDayAnchors.map((anchor) => anchor.bbox.y))
  );
  const verticalBounds = deriveGridBounds({
    centers: dayCenters,
    sampleBoxes: sessionCells.length ? sessionCells.map((box) => ({ ...box, x: box.y, width: box.height })) : sortedDayAnchors.map((anchor) => ({ ...anchor.bbox, x: anchor.bbox.y, width: anchor.bbox.height })),
    defaultGap: typicalRowGap || 0.11,
    minFromAnchors: minimumRowStart,
    maxFromAnchors: Math.max(...sortedDayAnchors.map((anchor) => anchor.bbox.y + anchor.bbox.height)),
    minimumCellSize: 0.06,
  });

  const columnBands = deriveBandsFromCenters(weekCenters, horizontalBounds.min, horizontalBounds.max);
  const rowBands = deriveBandsFromCenters(dayCenters, verticalBounds.min, verticalBounds.max);

  const rules = {
    version: 'weekly-grid-template-v1',
    familySlug: effectiveFamilySlug,
    templateSourcePlanId: params.planSourceId,
    compiledAt: new Date().toISOString(),
    annotationCounts: buildAnnotationCounts(params.annotations),
    pageTemplate: {
      templatePageNumber,
      weekColumns: sortedWeekAnchors.map((anchor, index) => ({
        index,
        centerX: weekCenters[index]!,
        left: columnBands[index]!.left,
        right: columnBands[index]!.right,
        label: anchor.label,
      })),
      dayRows: sortedDayAnchors.map((anchor, index) => ({
        index,
        dayOfWeek: parseDayOfWeek(anchor.label) ?? DAY_ORDER_FALLBACK[index] ?? null,
        label: anchor.label,
        centerY: dayCenters[index]!,
        top: rowBands[index]!.left,
        bottom: rowBands[index]!.right,
      })),
      weekHeaderBand: {
        top: clamp(Math.min(...sortedWeekAnchors.map((anchor) => anchor.bbox.y)), 0, 1),
        bottom: clamp(Math.max(...sortedWeekAnchors.map((anchor) => anchor.bbox.y + anchor.bbox.height)), 0, 1),
      },
      blockTitleBand: averageBox(blockTitleBoxes),
      sampleSessionCell: sessionCells[0] ?? null,
      ignoreRegions,
      legendRegions,
    },
  } satisfies WeeklyGridLayoutRules;

  return { rules, diagnostics };
}

export function getWeeklyGridCellBox(
  column: { left: number; right: number },
  row: { top: number; bottom: number }
) {
  return buildCellBox(column, row);
}

export function deriveWeeklyGridPreviewCells(rulesJson: unknown) {
  const rules = parseLayoutFamilyRules(rulesJson);
  if (!rules) return [] as WeeklyGridPreviewCell[];

  return rules.pageTemplate.weekColumns.flatMap((column) =>
    rules.pageTemplate.dayRows.map((row) => ({
      pageNumber: rules.pageTemplate.templatePageNumber,
      columnIndex: column.index,
      rowIndex: row.index,
      weekIndex: parseWeekNumber(column.label) ?? column.index,
      dayOfWeek: row.dayOfWeek,
      label: `W${(parseWeekNumber(column.label) ?? column.index) + 1} ${row.label ?? `Row ${row.index + 1}`}`,
      bbox: buildCellBox(column, row),
    }))
  );
}

export function buildLayoutFamilyTemplatePreview(params: {
  familySlug: string;
  planSourceId: string;
  annotations: LayoutRuleSourceAnnotation[];
  document?: ExtractedPdfDocument;
  rulesJson?: unknown | null;
}) {
  if (params.annotations.length) {
    const compiled = compileWeeklyGridLayoutRulesDetailed(params);
    if (compiled.rules || compiled.diagnostics.length) {
      return {
        rules: compiled.rules,
        diagnostics: compiled.diagnostics,
        pageNumber: compiled.rules?.pageTemplate.templatePageNumber ?? null,
        cells: compiled.rules ? deriveWeeklyGridPreviewCells(compiled.rules) : [],
        weekCount: compiled.rules?.pageTemplate.weekColumns.length ?? 0,
        dayCount: compiled.rules?.pageTemplate.dayRows.length ?? 0,
      } satisfies LayoutFamilyTemplatePreview;
    }
  }

  const parsedExistingRules = parseLayoutFamilyRules(params.rulesJson ?? null);
  if (parsedExistingRules) {
    const cells = deriveWeeklyGridPreviewCells(parsedExistingRules);
    return {
      rules: parsedExistingRules,
      diagnostics: [] as string[],
      pageNumber: parsedExistingRules.pageTemplate.templatePageNumber,
      cells,
      weekCount: parsedExistingRules.pageTemplate.weekColumns.length,
      dayCount: parsedExistingRules.pageTemplate.dayRows.length,
    } satisfies LayoutFamilyTemplatePreview;
  }

  const compiled = compileWeeklyGridLayoutRulesDetailed(params);
  return {
    rules: compiled.rules,
    diagnostics: compiled.diagnostics,
    pageNumber: compiled.rules?.pageTemplate.templatePageNumber ?? null,
    cells: compiled.rules ? deriveWeeklyGridPreviewCells(compiled.rules) : [],
    weekCount: compiled.rules?.pageTemplate.weekColumns.length ?? 0,
    dayCount: compiled.rules?.pageTemplate.dayRows.length ?? 0,
  } satisfies LayoutFamilyTemplatePreview;
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
        .filter(
          (
            value
          ): value is { index: number; centerX: number; left: number; right: number; label: string | null } =>
            value != null
        )
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
            dayOfWeek:
              typeof record.dayOfWeek === 'number' && Number.isFinite(record.dayOfWeek)
                ? record.dayOfWeek
                : null,
            label: typeof record.label === 'string' ? record.label : null,
            centerY: center,
            top,
            bottom,
          };
        })
        .filter(
          (
            value
          ): value is {
            index: number;
            dayOfWeek: number | null;
            label: string | null;
            centerY: number;
            top: number;
            bottom: number;
          } => value != null
        )
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

  const parseRegions = (value: unknown) => (Array.isArray(value) ? value.filter(isNormalizedBbox) : []);
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
    templateSourcePlanId:
      typeof candidate.templateSourcePlanId === 'string' ? candidate.templateSourcePlanId : '',
    compiledAt:
      typeof candidate.compiledAt === 'string' ? candidate.compiledAt : new Date(0).toISOString(),
    annotationCounts,
    pageTemplate: {
      templatePageNumber:
        typeof pageTemplateRecord.templatePageNumber === 'number' &&
        Number.isFinite(pageTemplateRecord.templatePageNumber)
          ? pageTemplateRecord.templatePageNumber
          : null,
      weekColumns,
      dayRows,
      weekHeaderBand,
      blockTitleBand: isNormalizedBbox(pageTemplateRecord.blockTitleBand)
        ? pageTemplateRecord.blockTitleBand
        : null,
      sampleSessionCell: isNormalizedBbox(pageTemplateRecord.sampleSessionCell)
        ? pageTemplateRecord.sampleSessionCell
        : null,
      ignoreRegions: parseRegions(pageTemplateRecord.ignoreRegions),
      legendRegions: parseRegions(pageTemplateRecord.legendRegions),
    },
  };
}

export function compileLayoutFamilyRules(params: {
  familySlug: string;
  planSourceId: string;
  annotations: LayoutRuleSourceAnnotation[];
  document?: ExtractedPdfDocument;
}) {
  return compileWeeklyGridLayoutRulesDetailed(params).rules;
}
