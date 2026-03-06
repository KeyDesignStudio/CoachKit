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
  normalizedX: number;
  normalizedY: number;
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
        disableCombineTextItems: false,
      });

      const items: PdfTextItem[] = Array.isArray(textContent?.items)
        ? textContent.items
            .map((item: any) => {
              const x = Number(item?.transform?.[4] ?? 0);
              const y = Number(item?.transform?.[5] ?? 0);
              const text = typeof item?.str === 'string' ? item.str : '';
              return {
                text,
                x,
                y,
                normalizedX: clamp(width ? x / width : 0, 0, 1),
                normalizedY: clamp(height ? 1 - y / height : 0, 0, 1),
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

function pointInBox(point: { x: number; y: number }, box: NormalizedBbox) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function extractTextFromPageRegion(params: {
  page: ExtractedPdfPage;
  box: NormalizedBbox;
  excludeBoxes?: NormalizedBbox[];
  lineTolerance?: number;
}) {
  const lineTolerance = params.lineTolerance ?? 0.0125;
  const excludeBoxes = params.excludeBoxes ?? [];

  const items = params.page.items
    .filter((item) => pointInBox({ x: item.normalizedX, y: item.normalizedY }, params.box))
    .filter((item) => !excludeBoxes.some((box) => pointInBox({ x: item.normalizedX, y: item.normalizedY }, box)))
    .sort((a, b) => {
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
