import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function ensureTestOnly() {
  if (process.env.DISABLE_AUTH !== 'true') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  return null;
}

const HEADER =
  'title,description,level,goal,equipment,program_length,time_per_workout,week,day,number_of_exercises,exercise_name,sets,reps,intensity,created,last_edit\n';

function buildCsv(): Buffer {
  const title = 'Flaky Program';
  const longText = 'B'.repeat(300);

  const lines: string[] = [];
  lines.push(HEADER.trimEnd());
  const rowCount = 3000;
  for (let i = 1; i <= rowCount; i++) {
    const week = Math.floor((i - 1) / 7) + 1;
    const day = ((i - 1) % 7) + 1;
    const exercise = `Exercise ${i}`;
    const desc = `Row ${i} ${longText}`;
    lines.push(
      `${title},"${desc}",Beginner,Strength,"Dumbbells",12,45,${week},${day},1,${exercise},3,10,RPE 7,2024-01-01,2024-01-02`
    );
  }

  const csv = lines.join('\n') + '\n';
  return Buffer.from(csv, 'utf8');
}

let cached: Buffer | null = null;
function getCsv(): Buffer {
  if (!cached) cached = buildCsv();
  return cached;
}

function parseRangeHeader(range: string | null, total: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = /^bytes=(\d+)-(\d+)?$/.exec(range.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const endRaw = m[2];
  const end = endRaw ? Number(endRaw) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  if (start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

function getFlakyCounts(): Map<string, number> {
  const g = globalThis as any;
  if (!g.__kaggleFlakyCounts) g.__kaggleFlakyCounts = new Map<string, number>();
  return g.__kaggleFlakyCounts as Map<string, number>;
}

export async function HEAD() {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const csv = getCsv();
  return new NextResponse(null, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(csv.byteLength),
      'accept-ranges': 'bytes',
    },
  });
}

export async function GET(request: Request) {
  const guard = ensureTestOnly();
  if (guard) return guard;

  const url = new URL(request.url);
  const key = url.searchParams.get('run') ?? 'default';

  const csv = getCsv();
  const total = csv.byteLength;
  const rangeHeader = request.headers.get('range');
  const range = parseRangeHeader(rangeHeader, total);

  // Simulate a transient 502 on the first Range request per key.
  const counts = getFlakyCounts();
  const seen = counts.get(key) ?? 0;
  if (seen === 0 && rangeHeader) {
    counts.set(key, seen + 1);
    return new NextResponse('temporary upstream error', { status: 502 });
  }
  counts.set(key, seen + 1);

  if (!range) {
    return new NextResponse(new Uint8Array(csv), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-length': String(total),
        'accept-ranges': 'bytes',
      },
    });
  }

  const { start, end } = range;
  const chunk = csv.subarray(start, end + 1);
  return new NextResponse(new Uint8Array(chunk), {
    status: 206,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-length': String(chunk.byteLength),
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${total}`,
    },
  });
}
