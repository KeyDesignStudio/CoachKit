import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractFromStructuredPdfDocument } from '@/modules/plan-library/server/extract';
import { compileLayoutFamilyRules } from '@/modules/plan-library/server/layout-rules';
import { extractStructuredPdfDocument } from '@/modules/plan-library/server/pdf-layout';

const ENABLED = process.env.LOCAL_REALPDF === '1';

const REAL_PDFS = [
  '/Users/gordonprice/Downloads/12WkOlympicBeginner.pdf',
  '/Users/gordonprice/Downloads/PlanOlympic6week.pdf',
  '/Users/gordonprice/Downloads/PlanOlympic6mth.pdf',
  '/Users/gordonprice/Downloads/5k Run_ 45 Day Beginner Training Guide.pdf',
  '/Users/gordonprice/Downloads/Race_Your_First_703.pdf',
] as const;

function buildWeeklyGridAnnotations(pageNumbers: number[]) {
  return pageNumbers.flatMap((pageNumber) => [
    { pageNumber, annotationType: 'WEEK_HEADER', label: 'Week 1', note: null, bboxJson: { x: 0.1, y: 0.14, width: 0.14, height: 0.05 } },
    { pageNumber, annotationType: 'WEEK_HEADER', label: 'Week 2', note: null, bboxJson: { x: 0.31, y: 0.14, width: 0.14, height: 0.05 } },
    { pageNumber, annotationType: 'WEEK_HEADER', label: 'Week 3', note: null, bboxJson: { x: 0.52, y: 0.14, width: 0.14, height: 0.05 } },
    { pageNumber, annotationType: 'WEEK_HEADER', label: 'Week 4', note: null, bboxJson: { x: 0.73, y: 0.14, width: 0.14, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Mon', note: null, bboxJson: { x: 0.02, y: 0.24, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Tue', note: null, bboxJson: { x: 0.02, y: 0.35, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Wed', note: null, bboxJson: { x: 0.02, y: 0.46, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Thu', note: null, bboxJson: { x: 0.02, y: 0.57, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Fri', note: null, bboxJson: { x: 0.02, y: 0.68, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Sat', note: null, bboxJson: { x: 0.02, y: 0.79, width: 0.06, height: 0.05 } },
    { pageNumber, annotationType: 'DAY_LABEL', label: 'Sun', note: null, bboxJson: { x: 0.02, y: 0.9, width: 0.06, height: 0.05 } },
  ]);
}

const suite = ENABLED ? describe : describe.skip;

suite('plan-library real PDF local regression', () => {
  it('prints extraction metrics for all local PDFs', async () => {
    const report: Array<{
      file: string;
      pageCount: number;
      page1Items: number;
      mode: string | null;
      sessions: number;
      weeks: number;
      warningCount: number;
      warningSample: string[];
    }> = [];

    for (const filePath of REAL_PDFS) {
      if (!fs.existsSync(filePath)) continue;
      const buffer = fs.readFileSync(filePath);
      const document = await extractStructuredPdfDocument(buffer);

      const pageNumbers =
        path.basename(filePath) === '12WkOlympicBeginner.pdf'
          ? [1, 2, 3]
          : [1];
      const annotations = buildWeeklyGridAnnotations(pageNumbers);

      const rules = compileLayoutFamilyRules({
        familySlug: 'weekly-grid',
        planSourceId: `local-${path.basename(filePath)}`,
        annotations: annotations as any,
        document,
      });

      const extracted = extractFromStructuredPdfDocument({
        document,
        durationWeeks: 12,
        rawTextFallback: document.rawText,
        layoutRulesJson: rules,
        annotations: annotations as any,
      });

      report.push({
        file: path.basename(filePath),
        pageCount: document.pages.length,
        page1Items: document.pages[0]?.items.length ?? 0,
        mode: (extracted.rawJson as any)?.pdfLayout?.mode ?? null,
        sessions: extracted.sessions.length,
        weeks: extracted.weeks.length,
        warningCount: extracted.warnings.length,
        warningSample: extracted.warnings.slice(0, 4),
      });

    }

    console.log('\nReal PDF parser report');
    console.table(report);

    const olympic = report.find((entry) => entry.file === '12WkOlympicBeginner.pdf');
    expect(olympic).toBeTruthy();
    expect(olympic?.mode).toBe('template');
    expect(olympic?.weeks).toBe(12);
    expect((olympic?.sessions ?? 0) >= 56).toBe(true);
  });

  it('keeps the 6-week Olympic PDF free of merged REST-DAY noise in workout notes', async () => {
    const filePath = '/Users/gordonprice/Downloads/PlanOlympic6week.pdf';
    if (!fs.existsSync(filePath)) {
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const document = await extractStructuredPdfDocument(buffer);
    const extracted = extractFromStructuredPdfDocument({
      document,
      durationWeeks: 6,
      rawTextFallback: document.rawText,
    });

    const noisyWorkouts = extracted.sessions.filter(
      (session) => session.discipline !== 'REST' && /\bREST(?: |-)?DAY\b/i.test(String(session.notes ?? ''))
    );
    expect(noisyWorkouts).toHaveLength(0);
    expect(extracted.sessions.length).toBeGreaterThan(0);
  });
});
