import pdfParse from 'pdf-parse';

export type NormalizedBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  normalizedX: number;
  normalizedY: number;
  normalizedWidth: number;
  normalizedHeight: number;
};

export type PdfTextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  normalizedX: number;
  normalizedY: number;
  normalizedWidth: number;
  normalizedHeight: number;
};

export type ExtractedPdfPage = {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
  text: string;
};

export type ExtractedPdfDocument = {
  rawText: string;
  pages: ExtractedPdfPage[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function extractStructuredPdfDocument(buffer: Buffer): Promise<ExtractedPdfDocument> {
  const pages: ExtractedPdfPage[] = [];

  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const viewport = pageData.getViewport(1.0);
      const width = isFiniteNumber(viewport?.width) ? viewport.width : 1;
      const height = isFiniteNumber(viewport?.height) ? viewport.height : 1;
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true,
      });

      const items: PdfTextItem[] = Array.isArray(textContent?.items)
        ? textContent.items
            .map((item: any) => {
              const x = Number(item?.transform?.[4] ?? 0);
              const y = Number(item?.transform?.[5] ?? 0);
              const itemWidth = Number(item?.width ?? 0);
              const itemHeight = Number(item?.height ?? 0);
              const text = typeof item?.str === 'string' ? item.str : '';
              return {
                text,
                x,
                y,
                width: itemWidth,
                height: itemHeight,
                normalizedX: clamp(width ? x / width : 0, 0, 1),
                normalizedY: clamp(height ? 1 - y / height : 0, 0, 1),
                normalizedWidth: clamp(width ? itemWidth / width : 0, 0, 1),
                normalizedHeight: clamp(height ? itemHeight / height : 0, 0, 1),
              } satisfies PdfTextItem;
            })
            .filter((item: PdfTextItem) => item.text.length > 0)
        : [];

      const pageText = items.map((item) => item.text).join('');

      pages.push({
        pageNumber: pages.length + 1,
        width,
        height,
        items,
        text: pageText,
      });

      return pageText;
    },
  });

  return {
    rawText: parsed.text ?? '',
    pages,
  };
}

function itemBox(item: PdfTextItem): NormalizedBbox {
  return {
    x: item.normalizedX,
    y: item.normalizedY,
    width: Math.max(0.001, item.normalizedWidth),
    height: Math.max(0.001, item.normalizedHeight),
  };
}

function boxesIntersect(left: NormalizedBbox, right: NormalizedBbox) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function verticalAnchorInBox(item: PdfTextItem, box: NormalizedBbox) {
  return item.normalizedY >= box.y && item.normalizedY < box.y + box.height;
}

function horizontalOverlapRatio(itemBounds: NormalizedBbox, region: NormalizedBbox) {
  const overlapWidth = Math.max(
    0,
    Math.min(itemBounds.x + itemBounds.width, region.x + region.width) - Math.max(itemBounds.x, region.x)
  );
  return itemBounds.width > 0 ? overlapWidth / itemBounds.width : 0;
}

function hasMeaningfulOverlap(item: PdfTextItem, region: NormalizedBbox, minimumHorizontalOverlapRatio = 0.67) {
  const itemBounds = itemBox(item);
  if (!boxesIntersect(itemBounds, region)) return false;
  if (!verticalAnchorInBox(item, region)) return false;
  return horizontalOverlapRatio(itemBounds, region) >= minimumHorizontalOverlapRatio;
}

export function extractTextFromPageRegion(params: {
  page: ExtractedPdfPage;
  box: NormalizedBbox;
  excludeBoxes?: NormalizedBbox[];
  lineTolerance?: number;
  minimumHorizontalOverlapRatio?: number;
}) {
  const lineTolerance = params.lineTolerance ?? 0.0125;
  const items = extractPageItemsFromRegion(params).sort((a, b) => {
    const deltaY = a.normalizedY - b.normalizedY;
    if (Math.abs(deltaY) > lineTolerance) return deltaY;
    return a.normalizedX - b.normalizedX;
  });

  if (!items.length) {
    return {
      text: '',
      lines: [] as string[],
      itemCount: 0,
    };
  }

  const lines: Array<{ y: number; items: PdfTextItem[] }> = [];

  for (const item of items) {
    const currentLine = lines[lines.length - 1];
    if (!currentLine || Math.abs(currentLine.y - item.normalizedY) > lineTolerance) {
      lines.push({ y: item.normalizedY, items: [item] });
      continue;
    }
    currentLine.items.push(item);
  }

  const renderedLines = lines.map((line) =>
    line.items
      .sort((a, b) => a.normalizedX - b.normalizedX)
      .map((item) => item.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  ).filter(Boolean);

  return {
    text: renderedLines.join('\n'),
    lines: renderedLines,
    itemCount: items.length,
  };
}

type ExtractPageItemsParams = {
  page: ExtractedPdfPage;
  box: NormalizedBbox;
  excludeBoxes?: NormalizedBbox[];
  minimumHorizontalOverlapRatio?: number;
};

export function extractPageItemsFromRegion(params: ExtractPageItemsParams) {
  const excludeBoxes = params.excludeBoxes ?? [];
  const minimumHorizontalOverlapRatio = params.minimumHorizontalOverlapRatio ?? 0.67;
  return params.page.items
    .filter((item) => hasMeaningfulOverlap(item, params.box, minimumHorizontalOverlapRatio))
    .filter((item) => !excludeBoxes.some((box) => boxesIntersect(itemBox(item), box)));
}

function mergeItemTexts(left: string, right: string, gap: number) {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return `${left}${right}`;
  if (gap > 0.0085) return `${left} ${right}`;
  return `${left}${right}`;
}

export function extractTextRunsFromPageRegion(params: {
  page: ExtractedPdfPage;
  box: NormalizedBbox;
  excludeBoxes?: NormalizedBbox[];
  lineTolerance?: number;
  wordGapTolerance?: number;
  minimumHorizontalOverlapRatio?: number;
}) {
  const lineTolerance = params.lineTolerance ?? 0.0125;
  const wordGapTolerance = params.wordGapTolerance ?? 0.0125;
  const items = extractPageItemsFromRegion(params).sort((a, b) => {
    const deltaY = a.normalizedY - b.normalizedY;
    if (Math.abs(deltaY) > lineTolerance) return deltaY;
    return a.normalizedX - b.normalizedX;
  });

  const lineGroups: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of items) {
    const currentLine = lineGroups[lineGroups.length - 1];
    if (!currentLine || Math.abs(currentLine.y - item.normalizedY) > lineTolerance) {
      lineGroups.push({ y: item.normalizedY, items: [item] });
      continue;
    }
    currentLine.items.push(item);
  }

  const runs: PdfTextRun[] = [];
  for (const line of lineGroups) {
    const sortedLineItems = [...line.items].sort((a, b) => a.normalizedX - b.normalizedX);
    let current: PdfTextRun | null = null;

    for (const item of sortedLineItems) {
      if (!current) {
        current = {
          text: item.text,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          normalizedX: item.normalizedX,
          normalizedY: item.normalizedY,
          normalizedWidth: item.normalizedWidth,
          normalizedHeight: item.normalizedHeight,
        };
        continue;
      }

      const currentRight: number = current.normalizedX + current.normalizedWidth;
      const gap: number = item.normalizedX - currentRight;
      if (gap > wordGapTolerance) {
        runs.push(current);
        current = {
          text: item.text,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          normalizedX: item.normalizedX,
          normalizedY: item.normalizedY,
          normalizedWidth: item.normalizedWidth,
          normalizedHeight: item.normalizedHeight,
        };
        continue;
      }

      const nextLeft = Math.min(current.normalizedX, item.normalizedX);
      const nextTop = Math.min(current.normalizedY, item.normalizedY);
      const nextRight = Math.max(currentRight, item.normalizedX + item.normalizedWidth);
      const nextBottom = Math.max(
        current.normalizedY + current.normalizedHeight,
        item.normalizedY + item.normalizedHeight
      );

      current = {
        text: mergeItemTexts(current.text, item.text, gap),
        x: Math.min(current.x, item.x),
        y: Math.min(current.y, item.y),
        width: Math.max(current.x + current.width, item.x + item.width) - Math.min(current.x, item.x),
        height: Math.max(current.y + current.height, item.y + item.height) - Math.min(current.y, item.y),
        normalizedX: nextLeft,
        normalizedY: nextTop,
        normalizedWidth: nextRight - nextLeft,
        normalizedHeight: nextBottom - nextTop,
      };
    }

    if (current) runs.push(current);
  }

  return runs.filter((run) => run.text.trim().length > 0);
}
