import { describe, expect, it } from 'vitest';

import { extractFromStructuredPdfDocument } from '@/modules/plan-library/server/extract';
import { buildLayoutFamilyTemplatePreview, compileLayoutFamilyRules } from '@/modules/plan-library/server/layout-rules';
import { extractTextFromPageRegion, type ExtractedPdfDocument, type PdfTextItem } from '@/modules/plan-library/server/pdf-layout';

function makeItem(
  text: string,
  normalizedX: number,
  normalizedY: number,
  normalizedWidth = 0.08,
  normalizedHeight = 0.025
): PdfTextItem {
  return {
    text,
    x: normalizedX * 1000,
    y: (1 - normalizedY) * 1000,
    width: normalizedWidth * 1000,
    height: normalizedHeight * 1000,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight,
  };
}

describe('plan-library weekly-grid layout rules', () => {
  it('keeps session body text when a PDF text item overlaps a cell but starts slightly outside it', () => {
    const page: ExtractedPdfDocument['pages'][number] = {
      pageNumber: 1,
      width: 1000,
      height: 1000,
      text: '',
      items: [
        makeItem('SWIM', 0.15, 0.27, 0.06),
        makeItem('Easy swim, 30-40mins.', 0.15, 0.29, 0.16),
        makeItem('Use warm-up to work on technique then go longer.', 0.095, 0.31, 0.23),
      ],
    };

    const extracted = extractTextFromPageRegion({
      page,
      box: { x: 0.10, y: 0.24, width: 0.20, height: 0.10 },
    });

    expect(extracted.lines).toEqual([
      'SWIM',
      'Easy swim, 30-40mins.',
      'Use warm-up to work on technique then go longer.',
    ]);
  });

  it('compiles a reusable weekly-grid template from page annotations', () => {
    const rules = compileLayoutFamilyRules({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_123',
      annotations: [
        { pageNumber: 1, annotationType: 'BLOCK_TITLE', label: 'Block 1', note: null, bboxJson: { x: 0.28, y: 0.08, width: 0.34, height: 0.04 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 1', note: null, bboxJson: { x: 0.10, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 2', note: null, bboxJson: { x: 0.31, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 3', note: null, bboxJson: { x: 0.52, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 4', note: null, bboxJson: { x: 0.73, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Mon', note: null, bboxJson: { x: 0.02, y: 0.24, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Tue', note: null, bboxJson: { x: 0.02, y: 0.35, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Wed', note: null, bboxJson: { x: 0.02, y: 0.46, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Thu', note: null, bboxJson: { x: 0.02, y: 0.57, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Fri', note: null, bboxJson: { x: 0.02, y: 0.68, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sat', note: null, bboxJson: { x: 0.02, y: 0.79, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sun', note: null, bboxJson: { x: 0.02, y: 0.90, width: 0.06, height: 0.05 } },
      ],
    });

    expect(rules).toBeTruthy();
    expect(rules?.pageTemplate.weekColumns).toHaveLength(4);
    expect(rules?.pageTemplate.dayRows).toHaveLength(7);
    expect(rules?.pageTemplate.dayRows.map((row) => row.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('uses compiled weekly-grid rules to extract session cells from page coordinates', () => {
    const rules = compileLayoutFamilyRules({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_123',
      annotations: [
        { pageNumber: 1, annotationType: 'BLOCK_TITLE', label: 'Block 1', note: null, bboxJson: { x: 0.28, y: 0.08, width: 0.34, height: 0.04 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 1', note: null, bboxJson: { x: 0.10, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 2', note: null, bboxJson: { x: 0.31, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 3', note: null, bboxJson: { x: 0.52, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 4', note: null, bboxJson: { x: 0.73, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Mon', note: null, bboxJson: { x: 0.02, y: 0.24, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Tue', note: null, bboxJson: { x: 0.02, y: 0.35, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Wed', note: null, bboxJson: { x: 0.02, y: 0.46, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Thu', note: null, bboxJson: { x: 0.02, y: 0.57, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Fri', note: null, bboxJson: { x: 0.02, y: 0.68, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sat', note: null, bboxJson: { x: 0.02, y: 0.79, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sun', note: null, bboxJson: { x: 0.02, y: 0.90, width: 0.06, height: 0.05 } },
      ],
    });

    const document: ExtractedPdfDocument = {
      rawText: 'Block 1 Week 1 Week 2 Week 3 Week 4',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('Block 1 - Building basic fitness', 0.38, 0.10),
            makeItem('Week 1', 0.17, 0.16),
            makeItem('Week 2', 0.38, 0.16),
            makeItem('Week 3', 0.59, 0.16),
            makeItem('Week 4', 0.80, 0.16),
            makeItem('SWIM', 0.15, 0.27),
            makeItem('Easy swim, 30-40mins.', 0.15, 0.29),
            makeItem('Use warm-up then 4 x 100m steady.', 0.15, 0.31),
            makeItem('RUN', 0.36, 0.38),
            makeItem('Easy run, 30-40mins.', 0.36, 0.40),
            makeItem('3 x 5mins steady with 2mins easy.', 0.36, 0.42),
            makeItem('BIKE', 0.57, 0.49),
            makeItem('Steady bike, 60mins.', 0.57, 0.51),
            makeItem('4 x 6mins with 2mins recovery.', 0.57, 0.53),
          ],
        },
      ],
    };

    const extracted = extractFromStructuredPdfDocument({
      document,
      durationWeeks: 12,
      layoutRulesJson: rules,
    });

    expect(extracted.sessions).toHaveLength(3);
    expect(extracted.sessions[0]?.weekIndex).toBe(0);
    expect(extracted.sessions[0]?.dayOfWeek).toBe(1);
    expect(extracted.sessions[0]?.discipline).toBe('SWIM');
    expect(extracted.sessions[0]?.distanceKm).toBeGreaterThan(0.09);
    expect(extracted.sessions[1]?.weekIndex).toBe(1);
    expect(extracted.sessions[1]?.dayOfWeek).toBe(2);
    expect(extracted.sessions[1]?.discipline).toBe('RUN');
    expect(extracted.sessions[2]?.weekIndex).toBe(2);
    expect(extracted.sessions[2]?.dayOfWeek).toBe(3);
    expect(extracted.sessions[2]?.discipline).toBe('BIKE');
    expect(extracted.weeks.map((week) => week.weekIndex)).toEqual([0, 1, 2, 3]);
    expect((extracted.rawJson as any)?.pdfLayout?.mode).toBe('template');
  });

  it('extracts sessions when cell text has OCR token collisions', () => {
    const rules = compileLayoutFamilyRules({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_ocr',
      annotations: [
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 1', note: null, bboxJson: { x: 0.10, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 2', note: null, bboxJson: { x: 0.31, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Mon', note: null, bboxJson: { x: 0.02, y: 0.24, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Tue', note: null, bboxJson: { x: 0.02, y: 0.35, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Wed', note: null, bboxJson: { x: 0.02, y: 0.46, width: 0.06, height: 0.05 } },
      ],
    });

    const document: ExtractedPdfDocument = {
      rawText: 'Week 1 Week 2',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('Week 1', 0.17, 0.16, 0.08),
            makeItem('Week 2', 0.38, 0.16, 0.08),
            makeItem('8SWIMEasy swim, 30-40mins.', 0.15, 0.27, 0.16),
            makeItem('REST-DAYDay off', 0.15, 0.38, 0.16),
          ],
        },
      ],
    };

    const extracted = extractFromStructuredPdfDocument({
      document,
      durationWeeks: 2,
      layoutRulesJson: rules,
    });

    expect(extracted.sessions.length).toBeGreaterThanOrEqual(1);
    expect(extracted.sessions.some((session) => session.discipline === 'SWIM')).toBe(true);
    expect(extracted.sessions.some((session) => session.discipline === 'REST')).toBe(true);
  });

  it('derives a full 4x7 preview grid from one week-header band and one day rail annotation', () => {
    const document: ExtractedPdfDocument = {
      rawText: '12 week plan',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('WEEK', 0.18, 0.16, 0.05),
            makeItem('1', 0.24, 0.16, 0.02),
            makeItem('WEEK', 0.39, 0.16, 0.05),
            makeItem('2', 0.45, 0.16, 0.02),
            makeItem('WEEK', 0.60, 0.16, 0.05),
            makeItem('3', 0.66, 0.16, 0.02),
            makeItem('WEEK', 0.81, 0.16, 0.05),
            makeItem('4', 0.87, 0.16, 0.02),
            makeItem('MON', 0.05, 0.27, 0.04),
            makeItem('TUE', 0.05, 0.38, 0.04),
            makeItem('WED', 0.05, 0.49, 0.04),
            makeItem('THU', 0.05, 0.60, 0.04),
            makeItem('FRI', 0.05, 0.71, 0.04),
            makeItem('SAT', 0.05, 0.82, 0.04),
            makeItem('SUN', 0.05, 0.93, 0.04),
          ],
        },
      ],
    };

    const preview = buildLayoutFamilyTemplatePreview({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_123',
      annotations: [
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week Column', note: null, bboxJson: { x: 0.10, y: 0.12, width: 0.82, height: 0.08 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Days of the week', note: null, bboxJson: { x: 0.01, y: 0.22, width: 0.09, height: 0.76 } },
        { pageNumber: 1, annotationType: 'SESSION_CELL', label: 'Sample session cell', note: null, bboxJson: { x: 0.13, y: 0.24, width: 0.17, height: 0.09 } },
      ],
      document,
    });

    expect(preview.rules).toBeTruthy();
    expect(preview.weekCount).toBe(4);
    expect(preview.dayCount).toBe(7);
    expect(preview.cells).toHaveLength(28);
    expect(preview.diagnostics).toEqual([]);
    expect(preview.cells[0]?.label).toContain('W1');
    expect(preview.cells[0]?.dayOfWeek).toBe(1);
  });

  it('restores a missing Monday anchor from the day rail instead of dropping the first row', () => {
    const document: ExtractedPdfDocument = {
      rawText: '12 week plan',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('WEEK', 0.18, 0.16, 0.05),
            makeItem('1', 0.24, 0.16, 0.02),
            makeItem('WEEK', 0.39, 0.16, 0.05),
            makeItem('2', 0.45, 0.16, 0.02),
            makeItem('WEEK', 0.60, 0.16, 0.05),
            makeItem('3', 0.66, 0.16, 0.02),
            makeItem('WEEK', 0.81, 0.16, 0.05),
            makeItem('4', 0.87, 0.16, 0.02),
            makeItem('TUE', 0.05, 0.38, 0.04),
            makeItem('WED', 0.05, 0.49, 0.04),
            makeItem('THU', 0.05, 0.60, 0.04),
            makeItem('FRI', 0.05, 0.71, 0.04),
            makeItem('SAT', 0.05, 0.82, 0.04),
            makeItem('SUN', 0.05, 0.93, 0.04),
          ],
        },
      ],
    };

    const preview = buildLayoutFamilyTemplatePreview({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_123',
      annotations: [
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week Column', note: null, bboxJson: { x: 0.10, y: 0.12, width: 0.82, height: 0.08 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Days of the week', note: null, bboxJson: { x: 0.01, y: 0.22, width: 0.09, height: 0.76 } },
        { pageNumber: 1, annotationType: 'SESSION_CELL', label: 'Sample session cell', note: null, bboxJson: { x: 0.13, y: 0.24, width: 0.17, height: 0.09 } },
      ],
      document,
    });

    expect(preview.cells).toHaveLength(28);
    expect(preview.cells.filter((cell) => cell.dayOfWeek === 1)).toHaveLength(4);
    expect(preview.cells.filter((cell) => cell.dayOfWeek === 0)).toHaveLength(4);
    expect(preview.diagnostics.join(' ')).toContain('Recovered 6/7 day anchors');
  });

  it('falls back to weekly-grid preview when explicit week/day annotations exist on a non-grid family', () => {
    const document: ExtractedPdfDocument = {
      rawText: '12 week plan',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('Week 1', 0.18, 0.16, 0.08),
            makeItem('Week 2', 0.39, 0.16, 0.08),
            makeItem('Week 3', 0.60, 0.16, 0.08),
            makeItem('Week 4', 0.81, 0.16, 0.08),
            makeItem('Mon', 0.05, 0.27, 0.04),
            makeItem('Tue', 0.05, 0.38, 0.04),
            makeItem('Wed', 0.05, 0.49, 0.04),
            makeItem('Thu', 0.05, 0.60, 0.04),
            makeItem('Fri', 0.05, 0.71, 0.04),
            makeItem('Sat', 0.05, 0.82, 0.04),
            makeItem('Sun', 0.05, 0.93, 0.04),
          ],
        },
      ],
    };

    const preview = buildLayoutFamilyTemplatePreview({
      familySlug: 'single-column',
      planSourceId: 'plan_123',
      annotations: [
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 1', note: null, bboxJson: { x: 0.10, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 2', note: null, bboxJson: { x: 0.31, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 3', note: null, bboxJson: { x: 0.52, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'WEEK_HEADER', label: 'Week 4', note: null, bboxJson: { x: 0.73, y: 0.14, width: 0.14, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Mon', note: null, bboxJson: { x: 0.02, y: 0.24, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Tue', note: null, bboxJson: { x: 0.02, y: 0.35, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Wed', note: null, bboxJson: { x: 0.02, y: 0.46, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Thu', note: null, bboxJson: { x: 0.02, y: 0.57, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Fri', note: null, bboxJson: { x: 0.02, y: 0.68, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sat', note: null, bboxJson: { x: 0.02, y: 0.79, width: 0.06, height: 0.05 } },
        { pageNumber: 1, annotationType: 'DAY_LABEL', label: 'Sun', note: null, bboxJson: { x: 0.02, y: 0.90, width: 0.06, height: 0.05 } },
      ],
      document,
    });

    expect(preview.cells).toHaveLength(28);
    expect(preview.rules?.familySlug).toBe('weekly-grid');
    expect(preview.diagnostics.join(' ')).toContain('weekly-grid preview fallback');
  });

  it('infers a weekly-grid template from page text when no annotations exist', () => {
    const document: ExtractedPdfDocument = {
      rawText: '12 week plan',
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          text: '',
          items: [
            makeItem('WEEK', 0.18, 0.16, 0.05),
            makeItem('1', 0.24, 0.16, 0.02),
            makeItem('WEEK', 0.39, 0.16, 0.05),
            makeItem('2', 0.45, 0.16, 0.02),
            makeItem('WEEK', 0.60, 0.16, 0.05),
            makeItem('3', 0.66, 0.16, 0.02),
            makeItem('WEEK', 0.81, 0.16, 0.05),
            makeItem('4', 0.87, 0.16, 0.02),
            makeItem('MON', 0.05, 0.27, 0.04),
            makeItem('TUE', 0.05, 0.38, 0.04),
            makeItem('WED', 0.05, 0.49, 0.04),
            makeItem('THU', 0.05, 0.60, 0.04),
            makeItem('FRI', 0.05, 0.71, 0.04),
            makeItem('SAT', 0.05, 0.82, 0.04),
            makeItem('SUN', 0.05, 0.93, 0.04),
          ],
        },
      ],
    };

    const preview = buildLayoutFamilyTemplatePreview({
      familySlug: 'weekly-grid',
      planSourceId: 'plan_123',
      annotations: [],
      document,
    });

    expect(preview.rules).toBeTruthy();
    expect(preview.cells).toHaveLength(28);
    expect(preview.diagnostics.join(' ')).toContain('inferred week columns from page text');
    expect(preview.diagnostics.join(' ')).toContain('inferred day rail from page text');
  });
});
