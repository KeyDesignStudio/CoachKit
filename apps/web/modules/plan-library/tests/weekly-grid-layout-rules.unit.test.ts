import { describe, expect, it } from 'vitest';

import { extractFromStructuredPdfDocument } from '@/modules/plan-library/server/extract';
import { compileLayoutFamilyRules } from '@/modules/plan-library/server/layout-rules';
import type { ExtractedPdfDocument, PdfTextItem } from '@/modules/plan-library/server/pdf-layout';

function makeItem(text: string, normalizedX: number, normalizedY: number): PdfTextItem {
  return {
    text,
    x: normalizedX * 1000,
    y: (1 - normalizedY) * 1000,
    normalizedX,
    normalizedY,
  };
}

describe('plan-library weekly-grid layout rules', () => {
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
});
