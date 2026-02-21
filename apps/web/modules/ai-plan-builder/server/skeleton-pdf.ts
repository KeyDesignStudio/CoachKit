type SkeletonSessionRow = {
  weekIndex: number;
  dayOfWeek: number;
  discipline: string;
  type: string;
  durationMinutes: number;
  notes?: string | null;
};

const DAY_SHORTS_SUN0 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function daySortKey(dayOfWeek: number, weekStart: 'monday' | 'sunday') {
  const d = ((Number(dayOfWeek) % 7) + 7) % 7;
  return weekStart === 'sunday' ? d : (d + 6) % 7;
}

function toDdMmYyyy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function toLongDate(date: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function mondayStartForDate(date: Date): Date {
  const jsDay = date.getUTCDay();
  const diff = (jsDay - 1 + 7) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);
  return monday;
}

function sessionDateForWeek(params: {
  startDate: string;
  weekStart: 'monday' | 'sunday';
  weekIndex: number;
  dayOfWeek: number;
}): Date | null {
  const start = new Date(`${params.startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;

  const jsDay = start.getUTCDay();
  const startJsDay = params.weekStart === 'sunday' ? 0 : 1;
  const offsetToWeekStart = (jsDay - startJsDay + 7) % 7;
  const blockWeekStart = new Date(start);
  blockWeekStart.setUTCDate(start.getUTCDate() - offsetToWeekStart);

  const dayOffset = daySortKey(params.dayOfWeek, params.weekStart);
  const target = new Date(blockWeekStart);
  target.setUTCDate(blockWeekStart.getUTCDate() + params.weekIndex * 7 + dayOffset);
  return target;
}

function buildSkeletonLines(params: {
  athleteName: string;
  startDate: string;
  weekStart: 'monday' | 'sunday';
  sessions: SkeletonSessionRow[];
}): string[] {
  const lines: string[] = [];
  lines.push(`CoachKit draft weekly plan for ${params.athleteName}`);
  lines.push('');

  const byWeek = new Map<number, SkeletonSessionRow[]>();
  for (const s of params.sessions) {
    const wk = Number(s.weekIndex ?? 0);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(s);
  }

  const weekIndexes = Array.from(byWeek.keys()).sort((a, b) => a - b);
  for (const weekIndex of weekIndexes) {
    const rows = (byWeek.get(weekIndex) ?? [])
      .slice()
      .sort((a, b) => daySortKey(a.dayOfWeek, params.weekStart) - daySortKey(b.dayOfWeek, params.weekStart));

    const mondayBase = sessionDateForWeek({
      startDate: params.startDate,
      weekStart: params.weekStart,
      weekIndex,
      dayOfWeek: 1,
    });
    const monday = mondayBase ? mondayStartForDate(mondayBase) : null;
    lines.push(`Week ${weekIndex + 1}${monday ? ` (commencing ${toLongDate(monday)})` : ''}`);

    for (const row of rows) {
      const when = sessionDateForWeek({
        startDate: params.startDate,
        weekStart: params.weekStart,
        weekIndex,
        dayOfWeek: Number(row.dayOfWeek ?? 0),
      });
      const dayShort = DAY_SHORTS_SUN0[Number(row.dayOfWeek ?? 0)] ?? 'Day';
      const dateLabel = when ? ` (${toDdMmYyyy(when)})` : '';
      const discipline = String(row.discipline ?? '').toUpperCase();
      const type = String(row.type ?? '').toLowerCase();
      const mins = Math.max(0, Number(row.durationMinutes ?? 0));
      const notes = String(row.notes ?? '').trim();
      lines.push(`- ${dayShort}${dateLabel} ${discipline} - ${type} (${mins} min)${notes ? ` | ${notes}` : ''}`);
    }
    lines.push('');
  }

  lines.push('This draft is for review and feedback before final publish.');
  return lines;
}

function createPdfFromLines(title: string, lines: string[]): Buffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 40;
  const marginTop = 40;
  const lineHeight = 14;
  const titleFontSize = 14;
  const bodyFontSize = 10;

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObjId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageTextLinesPerPage = Math.floor((pageHeight - marginTop * 2) / lineHeight) - 2;
  const pages: Array<{ textLines: string[] }> = [];
  for (let i = 0; i < lines.length; i += pageTextLinesPerPage) {
    pages.push({ textLines: lines.slice(i, i + pageTextLinesPerPage) });
  }
  if (pages.length === 0) pages.push({ textLines: [''] });

  const pageObjIds: number[] = [];

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const contentLines: string[] = [];
    contentLines.push('BT');
    contentLines.push(`/F1 ${titleFontSize} Tf`);
    contentLines.push(`${marginLeft} ${pageHeight - marginTop} Td`);
    if (i === 0) {
      contentLines.push(`(${escapePdfText(title)}) Tj`);
      contentLines.push(`0 -${lineHeight + 4} Td`);
    } else {
      contentLines.push(`(${escapePdfText(`${title} (cont.)`)}) Tj`);
      contentLines.push(`0 -${lineHeight + 4} Td`);
    }
    contentLines.push(`/F1 ${bodyFontSize} Tf`);

    for (const line of page.textLines) {
      contentLines.push(`(${escapePdfText(line)}) Tj`);
      contentLines.push(`0 -${lineHeight} Td`);
    }
    contentLines.push('ET');

    const stream = contentLines.join('\n');
    const contentObjId = addObject(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageObjId = addObject(
      `<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    pageObjIds.push(pageObjId);
  }

  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  const pagesObjId = addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>`);

  // Replace placeholder parent ref with actual pages object id.
  for (let i = 0; i < objects.length; i += 1) {
    objects[i] = objects[i]!.replaceAll('PAGES_REF', `${pagesObjId} 0 R`);
  }

  const catalogObjId = addObject(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  let output = '%PDF-1.4\n';
  const xrefPositions: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    xrefPositions.push(Buffer.byteLength(output, 'utf8'));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, 'utf8');
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (let i = 1; i < xrefPositions.length; i += 1) {
    output += `${String(xrefPositions[i]).padStart(10, '0')} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, 'utf8');
}

export function buildSkeletonPdfBuffer(params: {
  athleteName: string;
  startDate: string;
  weekStart: 'monday' | 'sunday';
  sessions: SkeletonSessionRow[];
}): Buffer {
  const lines = buildSkeletonLines(params);
  return createPdfFromLines(`CoachKit Draft Plan (${params.athleteName})`, lines);
}
